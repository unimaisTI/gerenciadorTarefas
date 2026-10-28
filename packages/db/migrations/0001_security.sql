-- =============================================================================
-- Segurança e regras de negócio no banco (seção 2, seção 7, RNF-01).
--
-- Papéis:
--   dono das tabelas (postgres): migrations e seed. Funções SECURITY DEFINER rodam como ele.
--   hub_app: usado pela API. Não é dono, não ignora RLS, não lê credenciais.
-- O usuário da requisição chega em current_setting('app.user_id'), definido por withUser().
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'hub_app') then
    create role hub_app nologin nobypassrls;
  end if;
end $$;

create schema if not exists app;

-- Ordenação fracionária precisa comparar byte a byte, em qualquer locale do servidor.
alter table tasks alter column position type text collate "C";
alter table board_columns alter column position type text collate "C";

alter table tasks
  add constraint tasks_parent_task_id_fk foreign key (parent_task_id) references tasks(id);
alter table tickets
  add constraint tickets_rating_range check (rating is null or rating between 1 and 5);

create sequence if not exists ticket_code_seq;

-- -----------------------------------------------------------------------------
-- Contexto do usuário e helpers de permissão.
-- As variantes *_as(uid, ...) servem para checar o acesso de OUTRO usuário (destinatário
-- de notificação); as sem sufixo usam o usuário da requisição.
-- -----------------------------------------------------------------------------

/** Instante em ISO 8601 (UTC) para as respostas da API. */
create function app.iso(p_value timestamptz) returns text
language sql immutable as $$
  select to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

create function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create function app.role_of(p_user uuid) returns user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from users where id = p_user and is_active
$$;

create function app.is_admin_as(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.role_of(p_user) = 'admin', false)
$$;

create function app.sees_all_as(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from users
    where id = p_user and is_active and (role = 'admin' or sees_all_departments)
  )
$$;

create function app.is_member_as(p_user uuid, p_dept uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_admin_as(p_user) or exists (
    select 1 from department_members m join users u on u.id = m.user_id
    where m.user_id = p_user and m.department_id = p_dept and u.is_active
  )
$$;

create function app.is_manager_as(p_user uuid, p_dept uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_admin_as(p_user) or exists (
    select 1 from department_members m join users u on u.id = m.user_id
    where m.user_id = p_user and m.department_id = p_dept and m.is_manager and u.is_active
  )
$$;

create function app.is_admin() returns boolean
language sql stable as $$ select app.is_admin_as(app.current_user_id()) $$;

create function app.sees_all() returns boolean
language sql stable as $$ select app.sees_all_as(app.current_user_id()) $$;

create function app.is_member(p_dept uuid) returns boolean
language sql stable as $$ select app.is_member_as(app.current_user_id(), p_dept) $$;

create function app.is_manager(p_dept uuid) returns boolean
language sql stable as $$ select app.is_manager_as(app.current_user_id(), p_dept) $$;

/** Observador é somente leitura. */
create function app.can_write() returns boolean
language sql stable as $$
  select coalesce(app.role_of(app.current_user_id()) in ('admin', 'gestor', 'colaborador'), false)
$$;

create function app.task_department(p_task uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select p.department_id from tasks t join projects p on p.id = t.project_id where t.id = p_task
$$;

create function app.project_department(p_project uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select department_id from projects where id = p_project
$$;

/** Solicitante, aprovador indicado ou gestor do departamento solicitante (RF-2.2, RF-7.6). */
create function app.is_ticket_requester_side_as(p_user uuid, p_task uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from tickets k
    where k.task_id = p_task
      and (k.requester_id = p_user or k.approver_id = p_user
           or app.is_manager_as(p_user, k.requester_department_id))
  )
$$;

/**
 * Pode ver a tarefa: membro do departamento do projeto, admin/observador autorizado,
 * ou participante do chamado (só a tarefa principal; subtarefas internas não, RF-7.11).
 */
create function app.can_view_task_as(p_user uuid, p_task uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from tasks t join projects p on p.id = t.project_id
    where t.id = p_task
      and (
        app.sees_all_as(p_user)
        or app.is_member_as(p_user, p.department_id)
        or (t.parent_task_id is null and app.is_ticket_requester_side_as(p_user, t.id))
      )
  )
$$;

create function app.can_view_task(p_task uuid) returns boolean
language sql stable as $$ select app.can_view_task_as(app.current_user_id(), p_task) $$;

create function app.can_edit_task(p_task uuid) returns boolean
language sql stable as $$
  select app.can_write() and app.is_member(app.task_department(p_task))
$$;

create function app.task_code(p_task uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select p.key || '-' || t.number from tasks t join projects p on p.id = t.project_id where t.id = p_task
$$;

/** Posição no fim da coluna. Chave válida para fractional-indexing: maior chave + 'V'. */
create function app.position_after_last(p_column uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(max(position) || 'V', 'a0') from tasks where column_id = p_column and deleted_at is null
$$;

-- -----------------------------------------------------------------------------
-- updated_at
-- -----------------------------------------------------------------------------

create function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare r record;
begin
  for r in
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
    where c.table_schema = 'public' and c.column_name = 'updated_at' and t.table_type = 'BASE TABLE'
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function app.touch_updated_at()',
      r.table_name || '_touch_updated_at', r.table_name
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Tempo real: eventos pequenos (só ids) no canal hub_events; a API repassa por SSE e o
-- navegador busca os dados de novo pela API, sob RLS.
-- -----------------------------------------------------------------------------

create function app.emit(p_payload jsonb) returns void
language sql as $$ select pg_notify('hub_events', p_payload::text) $$;

-- -----------------------------------------------------------------------------
-- Notificações (RF-8.5 a RF-8.8). Inserção só por estas funções; hub_app não insere direto.
-- -----------------------------------------------------------------------------

create function app.notify(p_recipient uuid, p_type text, p_task uuid, p_payload jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := app.current_user_id();
  v_email text;
  v_name text;
  v_payload jsonb;
begin
  if p_recipient is null or p_recipient = v_actor then
    return;
  end if;
  select email, name into v_email, v_name from users where id = p_recipient and is_active;
  if not found then
    return;
  end if;

  select coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
    'taskCode', app.task_code(p_task),
    'taskTitle', (select title from tasks where id = p_task),
    'ticketCode', (select code from tickets where task_id = p_task),
    'actorName', (select name from users where id = v_actor)
  ) into v_payload;

  insert into notifications (user_id, type, task_id, actor_id, payload)
  values (p_recipient, p_type, p_task, v_actor, v_payload);

  if p_type in ('ticket_opened', 'ticket_awaiting_approval', 'ticket_returned',
                'ticket_approved', 'task_assigned', 'mentioned')
     and coalesce((select email_enabled from notification_prefs
                   where user_id = p_recipient and event_type = p_type), true)
  then
    insert into email_outbox (to_email, subject, template, payload)
    values (v_email, p_type, p_type, v_payload || jsonb_build_object('recipientName', v_name));
  end if;

  perform app.emit(jsonb_build_object('t', 'notif', 'u', p_recipient));
end $$;

/**
 * Notificação disparada pela API (atribuição, menção, comentário). Só entrega a quem pode ver
 * a tarefa; comentário interno só a membros do departamento executor (RF-8.3).
 */
create function app.notify_task(p_task uuid, p_type text, p_recipients uuid[], p_payload jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
  v_internal boolean := coalesce((p_payload ->> 'internal')::boolean, false);
  v_dept uuid := app.task_department(p_task);
begin
  if not (app.can_write() and app.can_view_task(p_task)) then
    raise exception 'Sem acesso a esta tarefa.' using errcode = 'insufficient_privilege';
  end if;
  if p_type not in ('task_assigned', 'mentioned', 'task_commented') then
    raise exception 'Tipo de notificação inválido.' using errcode = 'check_violation';
  end if;
  foreach v_user in array coalesce(p_recipients, '{}') loop
    if app.can_view_task_as(v_user, p_task)
       and (not v_internal or app.is_member_as(v_user, v_dept)) then
      perform app.notify(v_user, p_type, p_task, p_payload);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Departamentos: projeto "Atividades de <sigla>", quadro "Chamados recebidos" e o tipo
-- "Solicitação geral" criados junto (RF-5.1, RF-4.10).
-- -----------------------------------------------------------------------------

create function app.provision_department() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project uuid;
  v_tickets uuid;
begin
  insert into projects (department_id, name, key, kind)
  values (new.id, 'Atividades de ' || new.acronym, new.acronym, 'regular')
  returning id into v_project;

  insert into board_columns (project_id, name, position, status_category) values
    (v_project, 'A fazer', 'a0', 'todo'),
    (v_project, 'Em andamento', 'a1', 'doing'),
    (v_project, 'Em revisão', 'a2', 'doing'),
    (v_project, 'Concluído', 'a3', 'done');

  insert into projects (department_id, name, key, kind)
  values (new.id, 'Chamados recebidos', new.acronym || '-CH', 'tickets')
  returning id into v_tickets;

  insert into board_columns (project_id, name, position, status_category, ticket_stage) values
    (v_tickets, 'Novos', 'a0', 'todo', 'new'),
    (v_tickets, 'Em triagem', 'a1', 'todo', 'triage'),
    (v_tickets, 'Em execução', 'a2', 'doing', 'execution'),
    (v_tickets, 'Aguardando aprovação', 'a3', 'doing', 'approval'),
    (v_tickets, 'Encerrados', 'a4', 'done', 'closed');

  insert into ticket_types (department_id, name, description)
  values (new.id, 'Solicitação geral', 'Tipo genérico da fase de testes.');

  return new;
end $$;

create trigger departments_provision after insert on departments
for each row execute function app.provision_department();

-- -----------------------------------------------------------------------------
-- Usuários: só o admin muda perfil, e-mail, situação e dados cadastrais.
-- Desativar encerra as sessões abertas (RF-3.6).
-- -----------------------------------------------------------------------------

create function app.users_before_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null and not app.is_admin() then
    if new.role <> old.role or new.email <> old.email or new.is_active <> old.is_active
       or new.sees_all_departments <> old.sees_all_departments or new.name <> old.name
       or new.job_title is distinct from old.job_title then
      raise exception 'Só o administrador altera esses dados.' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if old.is_active and not new.is_active then
    delete from sessions where user_id = old.id;
  end if;
  return new;
end $$;

create trigger users_guard before update on users
for each row execute function app.users_before_update();

-- -----------------------------------------------------------------------------
-- Tarefas
-- -----------------------------------------------------------------------------

create function app.tasks_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_category status_category;
begin
  update projects set next_task_number = next_task_number + 1
  where id = new.project_id and archived_at is null
  returning next_task_number - 1 into new.number;
  if new.number is null then
    raise exception 'Projeto inexistente ou arquivado.' using errcode = 'check_violation';
  end if;

  select status_category into v_category from board_columns
  where id = new.column_id and project_id = new.project_id;
  if not found then
    raise exception 'A coluna não pertence ao projeto.' using errcode = 'check_violation';
  end if;
  new.completed_at := case when v_category = 'done' then coalesce(new.completed_at, now()) end;

  if new.parent_task_id is not null and not exists (
    select 1 from tasks where id = new.parent_task_id and project_id = new.project_id
      and parent_task_id is null
  ) then
    raise exception 'A subtarefa precisa ficar no mesmo projeto da tarefa principal.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger tasks_before_insert before insert on tasks
for each row execute function app.tasks_before_insert();

create function app.tasks_before_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := app.current_user_id();
  v_dept uuid;
  v_new_dept uuid;
  v_kind project_kind;
  v_is_ticket boolean;
  -- coalesce: sem o setting, current_setting devolve NULL e "not NULL" desligaria a trava.
  v_in_flow boolean := coalesce(current_setting('app.in_ticket_transition', true), '') = 'on';
  v_category status_category;
begin
  if new.reporter_id <> old.reporter_id then
    raise exception 'O autor da tarefa não muda.' using errcode = 'check_violation';
  end if;

  select department_id, kind into v_dept, v_kind from projects where id = old.project_id;
  v_is_ticket := old.parent_task_id is null and exists (select 1 from tickets where task_id = old.id);

  -- Lixeira (RF-11.3): colaborador só exclui o que criou; restaurar é do gestor.
  if old.deleted_at is null and new.deleted_at is not null then
    if v_is_ticket then
      raise exception 'Chamados não são excluídos: use Cancelar ou Recusar.' using errcode = 'check_violation';
    end if;
    if v_me is not null and not (app.is_manager(v_dept) or (old.reporter_id = v_me and app.can_write())) then
      raise exception 'Você só pode excluir tarefas que criou.' using errcode = 'insufficient_privilege';
    end if;
    new.deleted_by := v_me;
  elsif old.deleted_at is not null and new.deleted_at is null then
    if v_me is not null and not app.is_manager(v_dept) then
      raise exception 'Só o gestor restaura tarefas da lixeira.' using errcode = 'insufficient_privilege';
    end if;
    new.deleted_by := null;
  end if;

  -- Mover para outro projeto do mesmo departamento (RF-6.9): ganha código novo.
  if new.project_id <> old.project_id then
    select department_id into v_new_dept from projects
    where id = new.project_id and kind = 'regular' and archived_at is null;
    if v_new_dept is distinct from v_dept or v_kind = 'tickets'
       or (old.parent_task_id is not null
           and coalesce(current_setting('app.moving_parent', true), '') <> 'on') then
      raise exception 'A tarefa só pode ir para outro projeto do mesmo departamento.'
        using errcode = 'check_violation';
    end if;
    update projects set next_task_number = next_task_number + 1
    where id = new.project_id returning next_task_number - 1 into new.number;
    if old.parent_task_id is null then
      -- As subtarefas acompanham a tarefa principal.
      perform set_config('app.moving_parent', 'on', true);
      update tasks set project_id = new.project_id,
        column_id = (select id from board_columns where project_id = new.project_id order by position limit 1)
      where parent_task_id = old.id;
      perform set_config('app.moving_parent', 'off', true);
    end if;
  end if;

  if new.column_id <> old.column_id then
    -- Status do chamado só pela máquina de estados (seção 7).
    if v_is_ticket and not v_in_flow then
      raise exception 'O status do chamado só muda pelas ações do chamado.' using errcode = 'check_violation';
    end if;
    select status_category into v_category from board_columns
    where id = new.column_id and project_id = new.project_id;
    if not found then
      raise exception 'A coluna não pertence ao projeto.' using errcode = 'check_violation';
    end if;
    new.completed_at := case when v_category = 'done' then coalesce(old.completed_at, now()) end;
  end if;

  -- RF-14.7: prazo de chamado recebido só pela ação do gestor, com motivo.
  if v_is_ticket and new.due_date is distinct from old.due_date and not v_in_flow and v_me is not null then
    raise exception 'O prazo do chamado muda pela ação "Alterar prazo", com motivo.'
      using errcode = 'check_violation';
  end if;

  if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time then
    new.due_notified_at := null;
    new.overdue_notified_at := null;
  end if;
  return new;
end $$;

create trigger tasks_before_update before update on tasks
for each row execute function app.tasks_before_update();

/** Histórico (RF-11.1): campo, antes, depois, quem e quando. */
create function app.tasks_after_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ch jsonb := '{}'::jsonb;
  v_action text := 'updated';
begin
  if tg_op = 'INSERT' then
    insert into activity_log (entity_type, entity_id, actor_id, action, changes)
    values ('task', new.id, app.current_user_id(), 'created', '{}'::jsonb);
  else
    if new.title is distinct from old.title then
      ch := ch || jsonb_build_object('title', jsonb_build_object('from', old.title, 'to', new.title));
    end if;
    if new.description_text is distinct from old.description_text then
      ch := ch || jsonb_build_object('description', jsonb_build_object('from', null, 'to', null));
    end if;
    if new.column_id is distinct from old.column_id then
      ch := ch || jsonb_build_object('column', jsonb_build_object(
        'from', (select name from board_columns where id = old.column_id),
        'to', (select name from board_columns where id = new.column_id)));
    end if;
    if new.assignee_id is distinct from old.assignee_id then
      ch := ch || jsonb_build_object('assignee', jsonb_build_object(
        'from', (select name from users where id = old.assignee_id),
        'to', (select name from users where id = new.assignee_id)));
    end if;
    if new.priority is distinct from old.priority then
      ch := ch || jsonb_build_object('priority', jsonb_build_object('from', old.priority, 'to', new.priority));
    end if;
    if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time then
      ch := ch || jsonb_build_object('dueDate', jsonb_build_object(
        'from', old.due_date, 'to', new.due_date));
    end if;
    if new.start_date is distinct from old.start_date then
      ch := ch || jsonb_build_object('startDate', jsonb_build_object('from', old.start_date, 'to', new.start_date));
    end if;
    if new.estimate is distinct from old.estimate then
      ch := ch || jsonb_build_object('estimate', jsonb_build_object('from', old.estimate, 'to', new.estimate));
    end if;
    if new.project_id is distinct from old.project_id then
      ch := ch || jsonb_build_object('project', jsonb_build_object(
        'from', (select name from projects where id = old.project_id),
        'to', (select name from projects where id = new.project_id)));
    end if;
    if old.deleted_at is null and new.deleted_at is not null then
      v_action := 'deleted';
    elsif old.deleted_at is not null and new.deleted_at is null then
      v_action := 'restored';
    end if;
    if v_action <> 'updated' or ch <> '{}'::jsonb then
      insert into activity_log (entity_type, entity_id, actor_id, action, changes)
      values ('task', new.id, app.current_user_id(), v_action, ch);
    end if;
    if new.project_id <> old.project_id then
      perform app.emit(jsonb_build_object('t', 'task', 'p', old.project_id, 'id', new.id));
    end if;
  end if;
  perform app.emit(jsonb_build_object('t', 'task', 'p', new.project_id, 'id', new.id));
  return null;
end $$;

create trigger tasks_after_write after insert or update on tasks
for each row execute function app.tasks_after_write();

create function app.comments_after_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.emit(jsonb_build_object(
    't', 'task', 'p', (select project_id from tasks where id = new.task_id), 'id', new.task_id));
  return null;
end $$;

create trigger comments_after_write after insert or update on comments
for each row execute function app.comments_after_write();

-- -----------------------------------------------------------------------------
-- Chamados: máquina de estados (seção 7). Única forma de mudar tickets.status.
-- As regras ficam numa tabela; packages/shared/src/tickets.ts é o espelho para a interface,
-- e o teste tickets.sql.test.ts confere que os dois são idênticos.
-- -----------------------------------------------------------------------------

create table app.ticket_transition_rules (
  from_status ticket_status not null,
  to_status ticket_status not null,
  actors text[] not null,
  requires_note boolean not null,
  requires_assignee boolean not null default false,
  only_to_previous boolean not null default false,
  primary key (from_status, to_status)
);

-- RULES:BEGIN
insert into app.ticket_transition_rules values
  ('open', 'triage', '{executor_manager}', false, false, false),
  ('open', 'in_progress', '{executor_manager}', false, true, false),
  ('triage', 'in_progress', '{executor_manager}', false, true, false),
  ('open', 'rejected', '{executor_manager}', true, false, false),
  ('triage', 'rejected', '{executor_manager}', true, false, false),
  ('triage', 'awaiting_info', '{executor_manager,assignee}', true, false, false),
  ('in_progress', 'awaiting_info', '{executor_manager,assignee}', true, false, false),
  ('awaiting_info', 'triage', '{requester_side}', true, false, true),
  ('awaiting_info', 'in_progress', '{requester_side}', true, false, true),
  ('in_progress', 'awaiting_approval', '{assignee,executor_manager}', true, false, false),
  ('returned', 'awaiting_approval', '{assignee,executor_manager}', true, false, false),
  ('returned', 'in_progress', '{assignee,executor_manager}', false, false, false),
  ('awaiting_approval', 'approved', '{requester_side}', false, false, false),
  ('awaiting_approval', 'returned', '{requester_side}', true, false, false),
  ('open', 'cancelled', '{requester_side}', false, false, false),
  ('triage', 'cancelled', '{requester_side}', false, false, false),
  ('awaiting_info', 'cancelled', '{requester_side}', false, false, false),
  ('in_progress', 'cancelled', '{requester_side}', false, false, false),
  ('returned', 'cancelled', '{requester_side}', false, false, false);
-- RULES:END

create function app.ticket_stage_for(p_status ticket_status, p_previous ticket_status)
returns ticket_stage
language sql immutable as $$
  select case p_status
    when 'open' then 'new'
    when 'triage' then 'triage'
    when 'awaiting_info' then case when p_previous = 'in_progress' then 'execution' else 'triage' end
    when 'in_progress' then 'execution'
    when 'returned' then 'execution'
    when 'awaiting_approval' then 'approval'
    else 'closed'
  end::ticket_stage
$$;

create function app.tickets_guard_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.in_ticket_transition', true), '') <> 'on' then
    raise exception 'O status do chamado só muda pela máquina de estados.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger tickets_guard_status before update on tickets
for each row execute function app.tickets_guard_status();

/** Move o cartão do chamado para a coluna da etapa, dentro do fluxo autorizado. */
create function app.ticket_move_card(p_task uuid, p_status ticket_status, p_previous ticket_status)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_task tasks%rowtype;
  v_column uuid;
begin
  select * into v_task from tasks where id = p_task;
  select id into v_column from board_columns
  where project_id = v_task.project_id and ticket_stage = app.ticket_stage_for(p_status, p_previous)
  order by position limit 1;
  if v_column is not null and v_column <> v_task.column_id then
    update tasks set column_id = v_column, position = app.position_after_last(v_column)
    where id = p_task;
  end if;
end $$;

create function app.ticket_notify(p_ticket uuid, p_to ticket_status, p_note text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k tickets%rowtype;
  v_assignee uuid;
  v_user uuid;
  v_payload jsonb;
  v_type text;
begin
  select * into k from tickets where id = p_ticket;
  select assignee_id into v_assignee from tasks where id = k.task_id;
  v_payload := jsonb_build_object('status', p_to, 'note', p_note);

  if p_to in ('approved', 'returned', 'cancelled')
     or (p_to in ('triage', 'in_progress') and k.previous_status = 'awaiting_info') then
    -- Ação do solicitante: avisa o executor (responsável e gestores do departamento).
    v_type := case p_to when 'approved' then 'ticket_approved'
                        when 'returned' then 'ticket_returned'
                        else 'ticket_status_changed' end;
    perform app.notify(v_assignee, v_type, k.task_id, v_payload);
    for v_user in
      select user_id from department_members
      where department_id = k.target_department_id and is_manager and user_id is distinct from v_assignee
    loop
      perform app.notify(v_user, v_type, k.task_id, v_payload);
    end loop;
  else
    -- Ação do executor: avisa o solicitante e o aprovador indicado.
    v_type := case when p_to = 'awaiting_approval' then 'ticket_awaiting_approval'
                   else 'ticket_status_changed' end;
    perform app.notify(k.requester_id, v_type, k.task_id, v_payload);
    if k.approver_id is distinct from k.requester_id then
      perform app.notify(k.approver_id, v_type, k.task_id, v_payload);
    end if;
  end if;
end $$;

create function app.ticket_transition(p_ticket uuid, p_to ticket_status, p_note text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := app.current_user_id();
  k tickets%rowtype;
  v_task tasks%rowtype;
  r app.ticket_transition_rules%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_now timestamptz := now();
  v_paused integer := 0;
begin
  if v_me is null or not app.can_write() then
    raise exception 'Sem permissão.' using errcode = 'insufficient_privilege';
  end if;

  select * into k from tickets where id = p_ticket for update;
  if not found or not app.can_view_task((select task_id from tickets where id = p_ticket)) then
    raise exception 'Chamado não encontrado.' using errcode = 'no_data_found';
  end if;
  select * into v_task from tasks where id = k.task_id;

  select * into r from app.ticket_transition_rules where from_status = k.status and to_status = p_to;
  if not found then
    raise exception 'Ação não permitida no status atual do chamado.' using errcode = 'check_violation';
  end if;
  if r.only_to_previous and p_to is distinct from k.previous_status then
    raise exception 'O chamado volta para o status em que estava.' using errcode = 'check_violation';
  end if;
  if not (
    app.is_admin()
    or ('executor_manager' = any(r.actors) and app.is_manager(k.target_department_id))
    -- coalesce: sem responsável a comparação dá NULL, e "not (... NULL ...)" pularia a recusa.
    or ('assignee' = any(r.actors) and coalesce(v_task.assignee_id = v_me, false))
    or ('requester_side' = any(r.actors) and app.is_ticket_requester_side_as(v_me, k.task_id))
  ) then
    raise exception 'Você não pode executar esta ação neste chamado.' using errcode = 'insufficient_privilege';
  end if;
  if r.requires_note and v_note is null then
    raise exception 'Escreva o motivo ou o comentário desta ação.' using errcode = 'check_violation';
  end if;
  if r.requires_assignee and v_task.assignee_id is null then
    raise exception 'Atribua um responsável antes de iniciar a execução.' using errcode = 'check_violation';
  end if;

  if k.status = 'awaiting_info' then
    select coalesce(extract(epoch from v_now - max(created_at))::integer, 0) into v_paused
    from ticket_events where ticket_id = k.id and to_status = 'awaiting_info';
  end if;

  perform set_config('app.in_ticket_transition', 'on', true);

  update tickets set
    status = p_to,
    previous_status = k.status,
    revision_count = revision_count + case when p_to = 'returned' then 1 else 0 end,
    delivered_at = case when p_to = 'awaiting_approval' then v_now else delivered_at end,
    approved_at = case when p_to = 'approved' then v_now else approved_at end,
    closed_at = case when p_to in ('approved', 'rejected', 'cancelled') then v_now else closed_at end,
    paused_seconds = paused_seconds + v_paused
  where id = k.id;

  perform app.ticket_move_card(k.task_id, p_to, k.status);

  perform set_config('app.in_ticket_transition', 'off', true);

  insert into ticket_events (ticket_id, actor_id, from_status, to_status, note)
  values (k.id, v_me, k.status, p_to, v_note);

  perform app.ticket_notify(k.id, p_to, v_note);
end $$;

/** RF-7.1: abre o chamado como tarefa no quadro "Chamados recebidos" do executor. */
create function app.ticket_open(
  p_target uuid,
  p_type uuid,
  p_title text,
  p_description jsonb,
  p_description_text text,
  p_priority priority,
  p_desired date,
  p_approver uuid
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := app.current_user_id();
  v_requester_dept uuid;
  v_project uuid;
  v_column uuid;
  v_task uuid;
  v_ticket uuid;
  v_user uuid;
begin
  if v_me is null or not app.can_write() then
    raise exception 'Sem permissão para abrir chamados.' using errcode = 'insufficient_privilege';
  end if;

  select department_id into v_requester_dept from department_members
  where user_id = v_me order by is_primary desc, created_at limit 1;
  if v_requester_dept is null then
    raise exception 'Você precisa pertencer a um departamento para abrir chamados.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from department_members where user_id = v_me and department_id = p_target) then
    raise exception 'Para o seu próprio departamento, crie uma tarefa no quadro.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from departments where id = p_target and accepts_tickets and archived_at is null) then
    raise exception 'Este departamento não recebe chamados.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from ticket_types where id = p_type and department_id = p_target and is_active) then
    raise exception 'Tipo de chamado inválido para este departamento.' using errcode = 'check_violation';
  end if;
  if p_approver is not null and not exists (select 1 from users where id = p_approver and is_active) then
    raise exception 'Aprovador inválido.' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_title, ''))) = 0 or length(p_title) > 200 then
    raise exception 'Título obrigatório (até 200 caracteres).' using errcode = 'check_violation';
  end if;

  select id into v_project from projects where department_id = p_target and kind = 'tickets';
  select id into v_column from board_columns
  where project_id = v_project and ticket_stage = 'new' order by position limit 1;

  insert into tasks (project_id, column_id, title, description, description_text, priority,
                     reporter_id, due_date, position)
  values (v_project, v_column, btrim(p_title), p_description, coalesce(p_description_text, ''),
          coalesce(p_priority, 'medium'), v_me, p_desired, app.position_after_last(v_column))
  returning id into v_task;

  insert into tickets (code, task_id, ticket_type_id, requester_id, requester_department_id,
                       target_department_id, approver_id, desired_due_date)
  values ('CH-' || nextval('ticket_code_seq'), v_task, p_type, v_me, v_requester_dept,
          p_target, p_approver, p_desired)
  returning id into v_ticket;

  insert into ticket_events (ticket_id, actor_id, from_status, to_status)
  values (v_ticket, v_me, null, 'open');

  insert into task_watchers (task_id, user_id) values (v_task, v_me) on conflict do nothing;

  -- RF-7.3: gestores do departamento de destino são avisados.
  for v_user in
    select user_id from department_members where department_id = p_target and is_manager
  loop
    perform app.notify(v_user, 'ticket_opened', v_task, '{}'::jsonb);
  end loop;

  return v_ticket;
end $$;

/** RF-7.4: só o gestor do executor (ou admin) atribui o responsável. */
create function app.ticket_assign(p_ticket uuid, p_assignee uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k tickets%rowtype;
  v_name text;
begin
  select * into k from tickets where id = p_ticket;
  if not found then
    raise exception 'Chamado não encontrado.' using errcode = 'no_data_found';
  end if;
  if not app.is_manager(k.target_department_id) then
    raise exception 'Só o gestor do departamento executor atribui o responsável.' using errcode = 'insufficient_privilege';
  end if;
  if k.status in ('approved', 'rejected', 'cancelled') then
    raise exception 'Chamado encerrado.' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from department_members m join users u on u.id = m.user_id
    where m.user_id = p_assignee and m.department_id = k.target_department_id
      and u.is_active and u.role <> 'observador'
  ) then
    raise exception 'O responsável precisa ser membro ativo do departamento executor.' using errcode = 'check_violation';
  end if;

  update tasks set assignee_id = p_assignee where id = k.task_id;
  select name into v_name from users where id = p_assignee;
  insert into ticket_events (ticket_id, actor_id, from_status, to_status, note)
  values (k.id, app.current_user_id(), k.status, k.status, 'Responsável: ' || v_name);
  perform app.notify(p_assignee, 'task_assigned', k.task_id, '{}'::jsonb);
end $$;

/** RF-14.7: gestor do executor altera o prazo combinado, com motivo; o solicitante é avisado. */
create function app.ticket_set_due(p_ticket uuid, p_due date, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k tickets%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into k from tickets where id = p_ticket;
  if not found then
    raise exception 'Chamado não encontrado.' using errcode = 'no_data_found';
  end if;
  if not app.is_manager(k.target_department_id) then
    raise exception 'Só o gestor do departamento executor altera o prazo do chamado.' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null then
    raise exception 'Informe o motivo da mudança de prazo.' using errcode = 'check_violation';
  end if;

  perform set_config('app.in_ticket_transition', 'on', true);
  update tasks set due_date = p_due where id = k.task_id;
  perform set_config('app.in_ticket_transition', 'off', true);

  insert into ticket_events (ticket_id, actor_id, from_status, to_status, note)
  values (k.id, app.current_user_id(), k.status, k.status,
          'Prazo alterado para ' || coalesce(to_char(p_due, 'DD/MM/YYYY'), 'sem prazo') || '. Motivo: ' || v_reason);
  perform app.notify(k.requester_id, 'ticket_due_changed', k.task_id,
                     jsonb_build_object('dueDate', p_due, 'note', v_reason));
end $$;

-- -----------------------------------------------------------------------------
-- Autenticação (seção 3). Credenciais, sessões e tokens não são legíveis pelo hub_app;
-- a API usa estas funções. Tokens chegam já como hash SHA-256.
-- -----------------------------------------------------------------------------

create function app.auth_lockout_until(p_email text) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select locked_until from auth_lockouts where email = lower(p_email) and locked_until > now()
$$;

create function app.auth_get_login(p_email text)
returns table (user_id uuid, password_hash text, is_active boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, c.password_hash, u.is_active
  from users u left join user_credentials c on c.user_id = u.id
  where u.email = lower(p_email)
$$;

/** RF-3.7: 5 erros seguidos bloqueiam por 15 minutos. Devolve o fim do bloqueio, se houver. */
create function app.auth_login_failed(p_email text, p_ip inet, p_user_agent text)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_until timestamptz;
begin
  insert into auth_lockouts (email, failed_count, updated_at)
  values (lower(p_email), 1, now())
  on conflict (email) do update set
    failed_count = case when auth_lockouts.locked_until is not null and auth_lockouts.locked_until <= now()
                        then 1 else auth_lockouts.failed_count + 1 end,
    locked_until = case when auth_lockouts.locked_until is not null and auth_lockouts.locked_until <= now()
                        then null else auth_lockouts.locked_until end,
    updated_at = now();

  update auth_lockouts set locked_until = now() + interval '15 minutes', failed_count = 0
  where email = lower(p_email) and failed_count >= 5
  returning locked_until into v_until;

  insert into audit_log (actor_id, action, target, ip, user_agent, details)
  values ((select id from users where email = lower(p_email)), 'login_failed', lower(p_email),
          p_ip, p_user_agent, jsonb_build_object('locked', v_until is not null));
  return v_until;
end $$;

create function app.auth_login_succeeded(
  p_user uuid, p_token_hash text, p_remember boolean, p_ip inet, p_user_agent text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from auth_lockouts where email = (select email from users where id = p_user);
  insert into sessions (token_hash, user_id, remember, expires_at, ip, user_agent)
  values (p_token_hash, p_user, p_remember, now() + interval '30 days', p_ip, p_user_agent);
  update users set last_login_at = now() where id = p_user;
  insert into audit_log (actor_id, action, target, ip, user_agent)
  values (p_user, 'login', (select email from users where id = p_user), p_ip, p_user_agent);
end $$;

/**
 * RF-3.8: a sessão expira após 12 h sem uso; com "manter conectado", após 30 dias.
 * Usuário desativado não tem sessão válida (RF-3.6).
 */
create function app.session_resolve(p_token_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s sessions%rowtype;
begin
  select * into s from sessions where token_hash = p_token_hash;
  if not found then
    return null;
  end if;
  if s.expires_at < now()
     or s.last_seen_at < now() - (case when s.remember then interval '30 days' else interval '12 hours' end)
     or not exists (select 1 from users where id = s.user_id and is_active) then
    delete from sessions where id = s.id;
    return null;
  end if;
  if s.last_seen_at < now() - interval '1 minute' then
    update sessions set last_seen_at = now() where id = s.id;
  end if;
  return s.user_id;
end $$;

create function app.session_delete(p_token_hash text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from sessions where token_hash = p_token_hash
$$;

/** Convite de primeiro acesso (7 dias) ou redefinição de senha (2 horas). */
create function app.auth_issue_token(p_user uuid, p_kind auth_token_kind, p_token_hash text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update auth_tokens set used_at = now() where user_id = p_user and used_at is null;
  insert into auth_tokens (user_id, token_hash, kind, expires_at)
  values (p_user, p_token_hash, p_kind,
          now() + case when p_kind = 'invite' then interval '7 days' else interval '2 hours' end);
end $$;

/** RF-4.5: só o admin reenvia convite ou força redefinição. */
create function app.admin_issue_token(p_user uuid, p_kind auth_token_kind, p_token_hash text)
returns table (email text, name text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_admin() then
    raise exception 'Só o administrador envia convites.' using errcode = 'insufficient_privilege';
  end if;
  perform app.auth_issue_token(p_user, p_kind, p_token_hash);
  if p_kind = 'reset' then
    update user_credentials set password_hash = null where user_id = p_user;
    delete from sessions where user_id = p_user;
  end if;
  return query select u.email, u.name from users u where u.id = p_user;
end $$;

/** "Esqueci minha senha": devolve o nome se o e-mail existe e está ativo (a API responde igual nos dois casos). */
create function app.auth_request_reset(p_email text, p_token_hash text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
  v_name text;
begin
  select id, name into v_user, v_name from users where email = lower(p_email) and is_active;
  if v_user is null then
    return null;
  end if;
  perform app.auth_issue_token(v_user, 'reset', p_token_hash);
  return v_name;
end $$;

create function app.auth_peek_token(p_token_hash text)
returns table (kind auth_token_kind, name text, email text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.kind, u.name, u.email from auth_tokens t join users u on u.id = t.user_id
  where t.token_hash = p_token_hash and t.used_at is null and t.expires_at > now() and u.is_active
$$;

/** Define a senha pelo link (RF-3.3, RF-3.4). Encerra as sessões antigas. */
create function app.auth_consume_token(p_token_hash text, p_password_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t auth_tokens%rowtype;
begin
  select * into t from auth_tokens
  where token_hash = p_token_hash and used_at is null and expires_at > now()
  for update;
  if not found or not exists (select 1 from users where id = t.user_id and is_active) then
    return null;
  end if;
  update auth_tokens set used_at = now() where id = t.id;
  insert into user_credentials (user_id, password_hash, password_changed_at)
  values (t.user_id, p_password_hash, now())
  on conflict (user_id) do update set password_hash = excluded.password_hash,
    password_changed_at = now(), failed_login_count = 0, locked_until = null;
  delete from sessions where user_id = t.user_id;
  delete from auth_lockouts where email = (select email from users where id = t.user_id);
  insert into audit_log (actor_id, action, target)
  values (t.user_id, case t.kind when 'invite' then 'password_set' else 'password_reset' end,
          (select email from users where id = t.user_id));
  return t.user_id;
end $$;

create function app.auth_my_password_hash() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select password_hash from user_credentials where user_id = app.current_user_id()
$$;

/** Troca de senha em "Meu perfil"; mantém só a sessão atual. */
create function app.auth_change_password(p_password_hash text, p_keep_token_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := app.current_user_id();
begin
  if v_me is null then
    raise exception 'Sessão inválida.' using errcode = 'insufficient_privilege';
  end if;
  update user_credentials set password_hash = p_password_hash, password_changed_at = now()
  where user_id = v_me;
  delete from sessions where user_id = v_me and token_hash <> p_keep_token_hash;
  insert into audit_log (actor_id, action, target)
  values (v_me, 'password_changed', (select email from users where id = v_me));
end $$;

-- -----------------------------------------------------------------------------
-- Jobs do worker (sem usuário na sessão).
-- -----------------------------------------------------------------------------

/** RF-8.6: prazo vencendo em 24 h e tarefa atrasada (uma vez por prazo). */
create function app.job_due_notifications() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  n integer := 0;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  for r in
    select t.id, t.assignee_id from tasks t
    where t.deleted_at is null and t.completed_at is null and t.assignee_id is not null
      and t.due_date is not null and t.due_notified_at is null
      and ((t.due_date + coalesce(t.due_time, time '23:59')) at time zone 'America/Sao_Paulo')
          between now() and now() + interval '24 hours'
  loop
    perform app.notify(r.assignee_id, 'task_due_soon', r.id, '{}'::jsonb);
    update tasks set due_notified_at = now() where id = r.id;
    n := n + 1;
  end loop;

  for r in
    select t.id, t.assignee_id from tasks t
    where t.deleted_at is null and t.completed_at is null and t.assignee_id is not null
      and t.due_date < v_today and t.overdue_notified_at is null
  loop
    perform app.notify(r.assignee_id, 'task_overdue', r.id, '{}'::jsonb);
    update tasks set overdue_notified_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

/** RF-8.12 e limpeza de sessões e tokens vencidos. */
create function app.job_cleanup() returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from notifications where read_at < now() - interval '90 days';
  delete from sessions where expires_at < now()
    or (not remember and last_seen_at < now() - interval '12 hours')
    or (remember and last_seen_at < now() - interval '30 days');
  delete from auth_tokens where (used_at is not null or expires_at < now())
    and created_at < now() - interval '30 days';
$$;

create function app.job_claim_emails(p_limit integer)
returns setof email_outbox
language sql security definer set search_path = public, pg_temp as $$
  update email_outbox o set attempts = attempts + 1,
    next_attempt_at = now() + (interval '1 minute' * power(2, least(attempts, 8)))
  where o.id in (
    select id from email_outbox
    where sent_at is null and next_attempt_at <= now() and attempts < 10
    order by created_at limit p_limit
    for update skip locked
  )
  returning o.*
$$;

create function app.job_email_result(p_id uuid, p_error text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update email_outbox set
    sent_at = case when p_error is null then now() end,
    last_error = p_error
  where id = p_id
$$;

/** Quem recebe eventos de tempo real de um projeto (para o SSE filtrar). */
create function app.project_audience(p_project uuid) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.user_id from department_members m join projects p on p.department_id = m.department_id
  where p.id = p_project
  union
  select id from users where is_active and (role = 'admin' or sees_all_departments)
  union
  select k.requester_id from tickets k join tasks t on t.id = k.task_id where t.project_id = p_project
  union
  select k.approver_id from tickets k join tasks t on t.id = k.task_id
  where t.project_id = p_project and k.approver_id is not null
$$;

-- -----------------------------------------------------------------------------
-- RLS em todas as tabelas (RNF-01). hub_app só enxerga o que as políticas liberam.
-- -----------------------------------------------------------------------------

do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', r.tablename);
  end loop;
end $$;

-- Usuários: diretório visível a quem está logado (menções e seletores de pessoas).
create policy users_select on users for select to hub_app
  using (app.current_user_id() is not null);
create policy users_insert on users for insert to hub_app with check (app.is_admin());
create policy users_update on users for update to hub_app
  using (app.is_admin() or id = app.current_user_id())
  with check (app.is_admin() or id = app.current_user_id());

create policy departments_select on departments for select to hub_app
  using (app.current_user_id() is not null);
create policy departments_insert on departments for insert to hub_app with check (app.is_admin());
create policy departments_update on departments for update to hub_app
  using (app.is_admin()) with check (app.is_admin());

-- Gestor adiciona membros ao próprio departamento; só o admin define gestores.
create policy members_select on department_members for select to hub_app
  using (app.current_user_id() is not null);
create policy members_insert on department_members for insert to hub_app
  with check (app.is_admin() or (app.is_manager(department_id) and not is_manager));
create policy members_update on department_members for update to hub_app
  using (app.is_admin() or app.is_manager(department_id))
  with check (app.is_admin() or (app.is_manager(department_id) and not is_manager));
create policy members_delete on department_members for delete to hub_app
  using (app.is_admin() or (app.is_manager(department_id) and not is_manager));

create policy ticket_types_select on ticket_types for select to hub_app
  using (app.current_user_id() is not null);
create policy ticket_types_write on ticket_types for all to hub_app
  using (app.is_manager(department_id)) with check (app.is_manager(department_id));

create policy projects_select on projects for select to hub_app
  using (app.current_user_id() is not null);
create policy projects_insert on projects for insert to hub_app
  with check (app.is_manager(department_id) and kind = 'regular');
create policy projects_update on projects for update to hub_app
  using (app.is_manager(department_id)) with check (app.is_manager(department_id));

create policy project_members_select on project_members for select to hub_app
  using (app.current_user_id() is not null);
create policy project_members_write on project_members for all to hub_app
  using (app.is_manager(app.project_department(project_id)))
  with check (app.is_manager(app.project_department(project_id)));

create policy columns_select on board_columns for select to hub_app
  using (app.current_user_id() is not null);
create policy columns_write on board_columns for all to hub_app
  using (app.is_manager(app.project_department(project_id)) and ticket_stage is null)
  with check (app.is_manager(app.project_department(project_id)) and ticket_stage is null);

create policy labels_select on labels for select to hub_app
  using (app.current_user_id() is not null);
create policy labels_write on labels for all to hub_app
  using (app.can_write() and app.is_member(app.project_department(project_id)))
  with check (app.can_write() and app.is_member(app.project_department(project_id)));

-- Tarefas: lixeira visível só ao gestor, por 30 dias (RF-11.3).
-- Usa as colunas da própria linha, não app.can_view_task(id): num INSERT ... RETURNING a linha
-- nova ainda não é visível para a função, e a política de leitura também vale para ela.
create policy tasks_select on tasks for select to hub_app
  using (
    (deleted_at is null and (
      app.sees_all()
      or app.is_member(app.project_department(project_id))
      or (parent_task_id is null and app.is_ticket_requester_side_as(app.current_user_id(), id))
    ))
    or (deleted_at > now() - interval '30 days' and app.is_manager(app.project_department(project_id)))
  );
create policy tasks_insert on tasks for insert to hub_app
  with check (
    app.can_write() and reporter_id = app.current_user_id()
    and app.is_member(app.project_department(project_id))
    and not exists (select 1 from projects p where p.id = project_id and p.kind = 'tickets' and parent_task_id is null)
  );
create policy tasks_update on tasks for update to hub_app
  using (
    app.can_edit_task(id)
    or (deleted_at is not null and app.is_manager(app.project_department(project_id)))
  )
  with check (app.can_write() and app.is_member(app.project_department(project_id)));

create policy task_watchers_select on task_watchers for select to hub_app
  using (app.can_view_task(task_id));
create policy task_watchers_write on task_watchers for all to hub_app
  using (app.can_edit_task(task_id) or (user_id = app.current_user_id() and app.can_view_task(task_id)))
  with check (app.can_edit_task(task_id) or (user_id = app.current_user_id() and app.can_view_task(task_id)));

create policy task_labels_select on task_labels for select to hub_app
  using (app.can_view_task(task_id));
create policy task_labels_write on task_labels for all to hub_app
  using (app.can_edit_task(task_id)) with check (app.can_edit_task(task_id));

-- Chamados: escrita só pelas funções da máquina de estados.
create policy tickets_select on tickets for select to hub_app
  using (
    app.sees_all() or app.is_member(target_department_id)
    or requester_id = app.current_user_id() or approver_id = app.current_user_id()
    or app.is_manager(requester_department_id)
  );

create policy ticket_events_select on ticket_events for select to hub_app
  using (exists (select 1 from tickets k where k.id = ticket_id));

-- Comentários internos só para o departamento executor (RF-8.3).
create policy comments_select on comments for select to hub_app
  using (
    deleted_at is null and app.can_view_task(task_id)
    and (visibility = 'public' or app.sees_all() or app.is_member(app.task_department(task_id)))
  );
create policy comments_insert on comments for insert to hub_app
  with check (
    author_id = app.current_user_id() and app.can_write() and app.can_view_task(task_id)
    and (visibility = 'public' or app.is_member(app.task_department(task_id)))
  );
create policy comments_update on comments for update to hub_app
  using (author_id = app.current_user_id()) with check (author_id = app.current_user_id());

create policy attachments_select on attachments for select to hub_app
  using (
    (task_id is not null and app.can_view_task(task_id))
    or (comment_id is not null and exists (select 1 from comments c where c.id = comment_id))
  );
create policy attachments_insert on attachments for insert to hub_app
  with check (
    added_by = app.current_user_id() and app.can_write()
    and (
      (task_id is not null and app.can_view_task(task_id))
      or (comment_id is not null and exists (
            select 1 from comments c where c.id = comment_id and c.author_id = app.current_user_id()))
    )
  );
create policy attachments_delete on attachments for delete to hub_app
  using (added_by = app.current_user_id() or (task_id is not null and app.can_edit_task(task_id)));

create policy notifications_select on notifications for select to hub_app
  using (user_id = app.current_user_id());
create policy notifications_update on notifications for update to hub_app
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

create policy notification_prefs_all on notification_prefs for all to hub_app
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

create policy activity_select on activity_log for select to hub_app
  using (entity_type = 'task' and app.can_view_task(entity_id));

create policy audit_select on audit_log for select to hub_app using (app.is_admin());
create policy audit_insert on audit_log for insert to hub_app
  with check (actor_id = app.current_user_id());

create policy calendar_events_select on calendar_events for select to hub_app
  using (
    app.current_user_id() is not null
    and (department_id is null or app.sees_all() or app.is_member(department_id))
  );
create policy calendar_events_write on calendar_events for all to hub_app
  using ((department_id is null and app.is_admin()) or (department_id is not null and app.is_manager(department_id)))
  with check ((department_id is null and app.is_admin()) or (department_id is not null and app.is_manager(department_id)));

-- user_credentials, sessions, auth_tokens, auth_lockouts, email_outbox: sem políticas e sem
-- grants; só as funções acima tocam nelas.

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

grant usage on schema public, app to hub_app;
grant select, insert, update on all tables in schema public to hub_app;
grant delete on department_members, project_members, board_columns, labels, task_labels,
  task_watchers, attachments, ticket_types, calendar_events, notification_prefs to hub_app;
revoke all on user_credentials, sessions, auth_tokens, auth_lockouts, email_outbox from hub_app;
revoke insert, update on tickets, ticket_events, activity_log, notifications from hub_app;
grant update (read_at) on notifications to hub_app;
grant usage, select on all sequences in schema public to hub_app;
grant select on app.ticket_transition_rules to hub_app;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to hub_app;
-- Internas: só chamadas por outras funções SECURITY DEFINER.
revoke execute on function app.notify(uuid, text, uuid, jsonb) from hub_app;
revoke execute on function app.auth_issue_token(uuid, auth_token_kind, text) from hub_app;
revoke execute on function app.ticket_move_card(uuid, ticket_status, ticket_status) from hub_app;
revoke execute on function app.ticket_notify(uuid, ticket_status, text) from hub_app;
