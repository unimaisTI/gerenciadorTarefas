-- =============================================================================
-- Regras dos recursos pós-MVP: épicos, vínculos, filtros salvos, modelos, recorrência,
-- automações, imagens enviadas e SLA. Mesmo modelo de segurança de 0001_security.sql.
-- =============================================================================

alter table tasks
  add constraint tasks_epic_id_fk foreign key (epic_id) references epics(id) on delete set null;
alter table attachments
  add constraint attachments_file_id_fk foreign key (file_id) references files(id);
create index tasks_epic_idx on tasks (epic_id);
create index tasks_backlog_idx on tasks (project_id, in_backlog);

alter table task_recurrences
  add constraint task_recurrences_weekday check (weekday is null or weekday between 1 and 7),
  add constraint task_recurrences_month_day check (month_day is null or month_day between 1 and 28),
  add constraint task_recurrences_offset check (due_offset_days between 0 and 365);
alter table ticket_types
  add constraint ticket_types_sla check (sla_hours is null or sla_hours between 1 and 2000);
alter table files
  add constraint files_size check (size_bytes between 1 and 5242880),
  add constraint files_mime check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp'));

do $$
declare r record;
begin
  for r in select unnest(array['epics', 'task_templates', 'task_recurrences', 'automation_rules']) as t loop
    execute format(
      'create trigger %I before update on %I for each row execute function app.touch_updated_at()',
      r.t || '_touch_updated_at', r.t
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Épico precisa ser do mesmo projeto; ao mudar de projeto, a tarefa sai do épico.
-- -----------------------------------------------------------------------------

create function app.tasks_epic_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.epic_id is not null
     and not exists (select 1 from epics where id = new.epic_id and project_id = new.project_id) then
    if tg_op = 'UPDATE' and new.project_id <> old.project_id then
      new.epic_id := null;
    else
      raise exception 'O épico precisa ser do mesmo projeto da tarefa.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger tasks_epic_guard before insert or update of epic_id, project_id on tasks
for each row execute function app.tasks_epic_guard();

-- -----------------------------------------------------------------------------
-- Automações: "quando a tarefa entrar na coluna X" ou "quando for criada (com prioridade Y)",
-- então avisar alguém, atribuir ou mudar a prioridade. Rodam no banco, para valer em qualquer
-- caminho (quadro, painel, calendário, recorrência).
-- -----------------------------------------------------------------------------

create function app.run_automations(p_task uuid, p_trigger automation_trigger) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t tasks%rowtype;
  r automation_rules%rowtype;
  v_user uuid;
  v_payload jsonb;
begin
  select * into t from tasks where id = p_task;
  if not found or t.deleted_at is not null then
    return;
  end if;
  for r in
    select * from automation_rules
    where project_id = t.project_id and is_active and trigger = p_trigger
      and (p_trigger <> 'task_moved' or column_id = t.column_id)
      and (p_trigger <> 'task_created' or trigger_priority is null or trigger_priority = t.priority)
    order by created_at
  loop
    v_payload := jsonb_build_object('rule', r.name);
    case r.action
      when 'notify_user' then
        perform app.notify(r.action_user_id, 'automation', t.id, v_payload);
      when 'notify_reporter' then
        perform app.notify(t.reporter_id, 'automation', t.id, v_payload);
      when 'notify_watchers' then
        for v_user in select user_id from task_watchers where task_id = t.id loop
          perform app.notify(v_user, 'automation', t.id, v_payload);
        end loop;
      when 'assign_user' then
        if r.action_user_id is not null
           and app.is_member_as(r.action_user_id, (select department_id from projects where id = t.project_id)) then
          update tasks set assignee_id = r.action_user_id where id = t.id;
          insert into task_watchers (task_id, user_id) values (t.id, r.action_user_id) on conflict do nothing;
          perform app.notify(r.action_user_id, 'task_assigned', t.id, v_payload);
        end if;
      when 'set_priority' then
        if r.action_priority is not null then
          update tasks set priority = r.action_priority where id = t.id;
        end if;
    end case;
  end loop;
end $$;

create function app.tasks_automation_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Só no comando de origem: o update feito por uma automação não dispara outras.
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform app.run_automations(new.id, 'task_created');
  elsif new.column_id is distinct from old.column_id then
    perform app.run_automations(new.id, 'task_moved');
  end if;
  return null;
end $$;

create trigger tasks_automations after insert or update of column_id on tasks
for each row execute function app.tasks_automation_trigger();

-- -----------------------------------------------------------------------------
-- Recorrência (RF-6.7): próxima data e job que cria as tarefas.
-- -----------------------------------------------------------------------------

/** Próxima ocorrência estritamente depois de p_after. */
create function app.next_recurrence(
  p_frequency recurrence_frequency, p_weekday integer, p_month_day integer, p_after date
) returns date
language plpgsql immutable as $$
declare
  v_candidate date;
begin
  if p_frequency = 'daily' then
    return p_after + 1;
  elsif p_frequency = 'weekly' then
    return p_after + ((coalesce(p_weekday, 1) - extract(isodow from p_after)::integer + 6) % 7) + 1;
  else
    v_candidate := (date_trunc('month', p_after) + make_interval(days => coalesce(p_month_day, 1) - 1))::date;
    if v_candidate <= p_after then
      v_candidate := (date_trunc('month', p_after) + interval '1 month'
                      + make_interval(days => coalesce(p_month_day, 1) - 1))::date;
    end if;
    return v_candidate;
  end if;
end $$;

create function app.job_recurrences() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r task_recurrences%rowtype;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_column uuid;
  v_task uuid;
  n integer := 0;
begin
  for r in
    select * from task_recurrences where is_active and next_run_on <= v_today
    for update skip locked
  loop
    select c.id into v_column from board_columns c join projects p on p.id = c.project_id
    where c.project_id = r.project_id and p.archived_at is null
    order by (c.status_category <> 'todo'), c.position limit 1;

    if v_column is not null then
      insert into tasks (project_id, column_id, title, description, description_text, priority,
                         assignee_id, reporter_id, due_date, position)
      values (r.project_id, v_column, r.title, r.description, '', r.priority, r.assignee_id,
              r.created_by, v_today + r.due_offset_days, app.position_after_last(v_column))
      returning id into v_task;
      insert into task_watchers (task_id, user_id)
      select v_task, u from unnest(array[r.created_by, r.assignee_id]) u where u is not null
      on conflict do nothing;
      perform app.notify(r.assignee_id, 'task_assigned', v_task, jsonb_build_object('recurring', true));
      n := n + 1;
    end if;

    -- Pula datas perdidas (worker parado): uma tarefa por execução, nunca uma enxurrada.
    update task_recurrences
    set last_run_on = v_today,
        next_run_on = app.next_recurrence(r.frequency, r.weekday, r.month_day, v_today)
    where id = r.id;
  end loop;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- SLA dos chamados (RF-10.19 a RF-10.21): prazo = abertura + horas do tipo; o tempo em
-- "Aguardando informações" empurra o prazo; aviso aos 80% e ao estourar.
-- -----------------------------------------------------------------------------

create function app.tickets_sla() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    select new.submitted_at + make_interval(hours => sla_hours) into new.sla_due_at
    from ticket_types where id = new.ticket_type_id and sla_hours is not null;
  elsif new.sla_due_at is not null and new.paused_seconds > old.paused_seconds then
    new.sla_due_at := old.sla_due_at + make_interval(secs => new.paused_seconds - old.paused_seconds);
  end if;
  return new;
end $$;

create trigger tickets_sla before insert or update of paused_seconds on tickets
for each row execute function app.tickets_sla();

create function app.job_sla() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k record;
  v_user uuid;
  v_type text;
  n integer := 0;
begin
  for k in
    select tk.*, t.assignee_id from tickets tk join tasks t on t.id = tk.task_id
    where tk.sla_due_at is not null
      and tk.status in ('open', 'triage', 'in_progress', 'returned')
      and (
        (tk.sla_breached_at is null and now() > tk.sla_due_at)
        or (tk.sla_warned_at is null
            and now() >= tk.sla_due_at - (tk.sla_due_at - tk.submitted_at) * 0.2)
      )
  loop
    v_type := case when now() > k.sla_due_at then 'ticket_sla_breached' else 'ticket_sla_warning' end;
    perform app.notify(k.assignee_id, v_type, k.task_id, jsonb_build_object('slaDueAt', k.sla_due_at));
    for v_user in
      select user_id from department_members
      where department_id = k.target_department_id and is_manager and user_id is distinct from k.assignee_id
    loop
      perform app.notify(v_user, v_type, k.task_id, jsonb_build_object('slaDueAt', k.sla_due_at));
    end loop;
    if v_type = 'ticket_sla_breached' then
      update tickets set sla_breached_at = now(), sla_warned_at = coalesce(sla_warned_at, now()) where id = k.id;
    else
      update tickets set sla_warned_at = now() where id = k.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- RLS das tabelas novas
-- -----------------------------------------------------------------------------

alter table epics enable row level security;
alter table task_links enable row level security;
alter table saved_filters enable row level security;
alter table task_templates enable row level security;
alter table task_recurrences enable row level security;
alter table automation_rules enable row level security;
alter table files enable row level security;

create policy epics_select on epics for select to hub_app
  using (app.sees_all() or app.is_member(app.project_department(project_id)));
create policy epics_write on epics for all to hub_app
  using (app.can_write() and app.is_member(app.project_department(project_id)))
  with check (app.can_write() and app.is_member(app.project_department(project_id)));

-- Vínculo só entre tarefas que o usuário vê; criar exige poder editar a tarefa de origem.
create policy task_links_select on task_links for select to hub_app
  using (app.can_view_task(source_task_id) and app.can_view_task(target_task_id));
create policy task_links_insert on task_links for insert to hub_app
  with check (created_by = app.current_user_id() and app.can_edit_task(source_task_id)
              and app.can_view_task(target_task_id));
create policy task_links_delete on task_links for delete to hub_app
  using (app.can_edit_task(source_task_id) or app.can_edit_task(target_task_id));

-- Filtro salvo é pessoal; compartilhado fica visível ao departamento do projeto.
create policy saved_filters_select on saved_filters for select to hub_app
  using (user_id = app.current_user_id()
         or (is_shared and project_id is not null and app.is_member(app.project_department(project_id))));
create policy saved_filters_write on saved_filters for all to hub_app
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

create policy task_templates_select on task_templates for select to hub_app
  using (app.sees_all() or app.is_member(app.project_department(project_id)));
create policy task_templates_write on task_templates for all to hub_app
  using (app.can_write() and app.is_member(app.project_department(project_id)))
  with check (app.can_write() and app.is_member(app.project_department(project_id)));

create policy task_recurrences_select on task_recurrences for select to hub_app
  using (app.sees_all() or app.is_member(app.project_department(project_id)));
create policy task_recurrences_write on task_recurrences for all to hub_app
  using (app.can_write() and app.is_member(app.project_department(project_id)))
  with check (app.can_write() and app.is_member(app.project_department(project_id))
              and created_by = app.current_user_id());

-- Automações mexem em tarefas de todos: só o gestor do departamento configura.
create policy automation_rules_select on automation_rules for select to hub_app
  using (app.sees_all() or app.is_member(app.project_department(project_id)));
create policy automation_rules_write on automation_rules for all to hub_app
  using (app.is_manager(app.project_department(project_id)))
  with check (app.is_manager(app.project_department(project_id)));

-- Imagem segue a visibilidade da tarefa em que foi enviada.
create policy files_select on files for select to hub_app
  using (app.can_view_task(task_id));
create policy files_insert on files for insert to hub_app
  with check (uploaded_by = app.current_user_id() and app.can_write() and app.can_view_task(task_id));

grant select, insert, update, delete on epics, task_links, saved_filters, task_templates,
  task_recurrences, automation_rules to hub_app;
grant select, insert on files to hub_app;

revoke execute on all functions in schema app from public;
grant execute on function app.next_recurrence(recurrence_frequency, integer, integer, date) to hub_app;
grant execute on function app.job_recurrences() to hub_app;
grant execute on function app.job_sla() to hub_app;
