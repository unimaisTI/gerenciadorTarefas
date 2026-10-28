import { sql } from 'drizzle-orm';
import { keyBetween } from '../../lib/positions';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Transaction } from '@hub/db';
import {
  automationRuleSchema,
  bulkTaskSchema,
  epicSchema,
  permissions,
  recurrenceSchema,
  sanitizeRichDoc,
  savedFilterSchema,
  taskLinkSchema,
  taskTemplateSchema,
  todayIso,
  uuid,
  type AutomationRuleDto,
  type EpicDto,
  type RecurrenceDto,
  type SavedFilterDto,
  type TaskTemplateDto,
} from '@hub/shared';
import { one, rows } from '../../lib/sql';
import { asViewer, type RequestViewer } from '../../plugins/auth';
import { forbidden, notFound, unprocessable } from '../../plugins/errors';
import { resolveTaskId, taskDepartment, userRef } from '../tasks/queries';
import { notifyTask } from '../tasks/routes';

const idParams = z.object({ id: uuid });

async function projectDepartment(tx: Transaction, projectId: string) {
  const row = await one<{ departmentId: string; kind: string }>(
    tx,
    sql`select department_id as "departmentId", kind from projects where id = ${projectId}`,
  );
  if (!row) throw notFound('Projeto não encontrado.');
  return row;
}

async function requireEditor(tx: Transaction, viewer: RequestViewer, projectId: string) {
  const p = await projectDepartment(tx, projectId);
  if (!permissions.editTasks(viewer, p.departmentId)) throw forbidden();
  return p;
}

const EPIC_COLUMNS = sql`
  e.id, e.project_id as "projectId", e.name, e.description, e.color, e.status,
  (select count(*)::int from tasks t where t.epic_id = e.id and t.deleted_at is null) as "taskCount",
  (select count(*)::int from tasks t join board_columns c on c.id = t.column_id
    where t.epic_id = e.id and t.deleted_at is null and c.status_category = 'done') as "doneCount"`;

const TEMPLATE_COLUMNS = sql`id, project_id as "projectId", name, title, description, priority`;

const RECURRENCE_COLUMNS = sql`
  r.id, r.project_id as "projectId", r.title, r.description, r.priority, ${userRef('a')} as assignee,
  r.frequency, r.weekday, r.month_day as "monthDay", r.due_offset_days as "dueOffsetDays",
  r.next_run_on::text as "nextRunOn", r.last_run_on::text as "lastRunOn", r.is_active as "isActive"`;

const RULE_COLUMNS = sql`
  r.id, r.project_id as "projectId", r.name, r.trigger, r.column_id as "columnId",
  r.trigger_priority as "triggerPriority", r.action, ${userRef('a')} as "actionUser",
  r.action_priority as "actionPriority", r.is_active as "isActive"`;

export const planningRoutes: FastifyPluginAsyncZod = async (app) => {
  // Ações em massa: mesma mudança em vários cartões, cada uma sob RLS e com as travas do banco.
  app.post('/tasks/bulk', { schema: { body: bulkTaskSchema } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const b = request.body;
      let updated = 0;
      for (const id of b.taskIds) {
        const info = await taskDepartment(tx, id);
        if (!info || !permissions.editTasks(viewer, info.departmentId)) continue;
        if (b.delete) {
          if (info.isTicket || !permissions.deleteTask(viewer, info.departmentId, info.reporterId)) continue;
          await tx.execute(sql`update tasks set deleted_at = now() where id = ${id}`);
          updated += 1;
          continue;
        }
        if (info.isTicket && (b.inBacklog || b.columnId)) continue;
        if (b.columnId) {
          const last = await one<{ position: string | null }>(
            tx,
            sql`select max(position) as position from tasks where column_id = ${b.columnId}`,
          );
          await tx.execute(sql`
            update tasks set column_id = ${b.columnId},
              position = ${keyBetween(last?.position ?? null, null)}, in_backlog = false
            where id = ${id} and column_id <> ${b.columnId}`);
        }
        await tx.execute(sql`
          update tasks set
            assignee_id = case when ${b.assigneeId !== undefined} then ${b.assigneeId ?? null}::uuid else assignee_id end,
            priority = coalesce(${b.priority ?? null}::priority, priority),
            epic_id = case when ${b.epicId !== undefined} then ${b.epicId ?? null}::uuid else epic_id end,
            -- Escolher uma coluna é "enviar ao quadro", mesmo que a tarefa já esteja nela.
            in_backlog = case when ${b.columnId !== undefined} then false
                              else coalesce(${b.inBacklog ?? null}::boolean, in_backlog) end
          where id = ${id}`);
        if (b.assigneeId && b.assigneeId !== info.assigneeId && b.assigneeId !== viewer.id) {
          await notifyTask(tx, id, 'task_assigned', [b.assigneeId]);
        }
        updated += 1;
      }
      return { updated, skipped: b.taskIds.length - updated };
    }),
  );

  // Vínculos entre tarefas (RF-6.6).
  app.post('/tasks/:id/links', { schema: { params: idParams, body: taskLinkSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      const info = await taskDepartment(tx, request.params.id);
      if (!info || !permissions.editTasks(viewer, info.departmentId)) throw forbidden();
      const targetId = await resolveTaskId(tx, request.body.targetCode);
      if (!targetId) throw unprocessable('Tarefa de destino não encontrada ou sem acesso.');
      if (targetId === request.params.id) throw unprocessable('Uma tarefa não se vincula a ela mesma.');
      const created = await one<{ id: string }>(
        tx,
        sql`insert into task_links (source_task_id, target_task_id, kind, created_by)
            values (${request.params.id}, ${targetId}, ${request.body.kind}, ${viewer.id})
            on conflict do nothing returning id`,
      );
      if (!created) throw unprocessable('Esse vínculo já existe.');
      return reply.status(201).send(created);
    }),
  );

  app.delete('/task-links/:id', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx) => {
      const deleted = await rows<{ id: string }>(tx, sql`delete from task_links where id = ${request.params.id} returning id`);
      if (!deleted.length) throw forbidden();
      return { ok: true };
    }),
  );

  // Épicos: agrupam tarefas de um projeto.
  app.get('/projects/:id/epics', { schema: { params: idParams } }, (request) =>
    asViewer(request, (tx) =>
      rows<EpicDto>(tx, sql`select ${EPIC_COLUMNS} from epics e where e.project_id = ${request.params.id} order by e.status, e.name`),
    ),
  );

  app.post('/projects/:id/epics', { schema: { params: idParams, body: epicSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      await requireEditor(tx, viewer, request.params.id);
      const b = request.body;
      const created = await one<{ id: string }>(
        tx,
        sql`insert into epics (project_id, name, description, color, status, created_by)
            values (${request.params.id}, ${b.name}, ${b.description ?? null}, ${b.color}, ${b.status}, ${viewer.id})
            returning id`,
      );
      return reply.status(201).send(await one<EpicDto>(tx, sql`select ${EPIC_COLUMNS} from epics e where e.id = ${created?.id ?? ''}`));
    }),
  );

  app.patch('/epics/:id', { schema: { params: idParams, body: epicSchema.partial() } }, (request) =>
    asViewer(request, async (tx) => {
      const b = request.body;
      const updated = await rows<{ id: string }>(
        tx,
        sql`update epics set
              name = coalesce(${b.name ?? null}, name),
              description = case when ${b.description !== undefined} then ${b.description ?? null} else description end,
              color = coalesce(${b.color ?? null}::department_color, color),
              status = coalesce(${b.status ?? null}::epic_status, status)
            where id = ${request.params.id} returning id`,
      );
      if (!updated.length) throw forbidden();
      return one<EpicDto>(tx, sql`select ${EPIC_COLUMNS} from epics e where e.id = ${request.params.id}`);
    }),
  );

  app.delete('/epics/:id', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx) => {
      const deleted = await rows<{ id: string }>(tx, sql`delete from epics where id = ${request.params.id} returning id`);
      if (!deleted.length) throw forbidden();
      return { ok: true };
    }),
  );

  // Filtros salvos (pessoais ou compartilhados com o departamento).
  app.get(
    '/saved-filters',
    { schema: { querystring: z.object({ projectId: uuid.optional() }) } },
    (request) =>
      asViewer(request, async (tx, viewer) => {
        const list = await rows<SavedFilterDto & { userId: string }>(
          tx,
          sql`select id, project_id as "projectId", name, filters, is_shared as "isShared", user_id as "userId"
              from saved_filters
              where ${request.query.projectId ?? null}::uuid is null or project_id = ${request.query.projectId ?? null}::uuid
              order by name`,
        );
        return list.map(({ userId, ...f }) => ({ ...f, isMine: userId === viewer.id }));
      }),
  );

  app.post('/saved-filters', { schema: { body: savedFilterSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      const b = request.body;
      const created = await one<{ id: string }>(
        tx,
        sql`insert into saved_filters (user_id, project_id, name, filters, is_shared)
            values (${viewer.id}, ${b.projectId ?? null}, ${b.name}, ${JSON.stringify(b.filters)}::jsonb, ${b.isShared})
            returning id`,
      );
      return reply.status(201).send(created);
    }),
  );

  app.delete('/saved-filters/:id', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx) => {
      const deleted = await rows<{ id: string }>(tx, sql`delete from saved_filters where id = ${request.params.id} returning id`);
      if (!deleted.length) throw forbidden('Só quem criou exclui o filtro.');
      return { ok: true };
    }),
  );

  // Modelos de tarefa (RF-6.8).
  app.get('/projects/:id/templates', { schema: { params: idParams } }, (request) =>
    asViewer(request, (tx) =>
      rows<TaskTemplateDto>(tx, sql`select ${TEMPLATE_COLUMNS} from task_templates where project_id = ${request.params.id} order by name`),
    ),
  );

  app.post('/projects/:id/templates', { schema: { params: idParams, body: taskTemplateSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      await requireEditor(tx, viewer, request.params.id);
      const b = request.body;
      const description = b.description ? sanitizeRichDoc(b.description) : null;
      const created = await one<TaskTemplateDto>(
        tx,
        sql`insert into task_templates (project_id, name, title, description, priority, created_by)
            values (${request.params.id}, ${b.name}, ${b.title}, ${description ? JSON.stringify(description) : null}::jsonb,
                    ${b.priority}, ${viewer.id})
            returning ${TEMPLATE_COLUMNS}`,
      );
      return reply.status(201).send(created);
    }),
  );

  app.delete('/templates/:id', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx) => {
      const deleted = await rows<{ id: string }>(tx, sql`delete from task_templates where id = ${request.params.id} returning id`);
      if (!deleted.length) throw forbidden();
      return { ok: true };
    }),
  );

  // Tarefas recorrentes (RF-6.7): o worker cria a tarefa em cada data.
  app.get('/projects/:id/recurrences', { schema: { params: idParams } }, (request) =>
    asViewer(request, (tx) =>
      rows<RecurrenceDto>(
        tx,
        sql`select ${RECURRENCE_COLUMNS} from task_recurrences r left join users a on a.id = r.assignee_id
            where r.project_id = ${request.params.id} order by r.is_active desc, r.next_run_on`,
      ),
    ),
  );

  app.post('/projects/:id/recurrences', { schema: { params: idParams, body: recurrenceSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      const p = await requireEditor(tx, viewer, request.params.id);
      if (p.kind === 'tickets') throw unprocessable('O quadro de chamados não tem tarefas recorrentes.');
      const b = request.body;
      const description = b.description ? sanitizeRichDoc(b.description) : null;
      const yesterday = todayIso(new Date(Date.now() - 86_400_000));
      const created = await one<{ id: string }>(
        tx,
        sql`insert into task_recurrences (project_id, title, description, priority, assignee_id, frequency, weekday,
                                          month_day, due_offset_days, is_active, created_by, next_run_on)
            values (${request.params.id}, ${b.title}, ${description ? JSON.stringify(description) : null}::jsonb,
                    ${b.priority}, ${b.assigneeId ?? null}, ${b.frequency}, ${b.weekday ?? null}, ${b.monthDay ?? null},
                    ${b.dueOffsetDays}, ${b.isActive}, ${viewer.id},
                    app.next_recurrence(${b.frequency}::recurrence_frequency, ${b.weekday ?? null}::int, ${b.monthDay ?? null}::int, ${yesterday}::date))
            returning id`,
      );
      return reply.status(201).send(
        await one<RecurrenceDto>(
          tx,
          sql`select ${RECURRENCE_COLUMNS} from task_recurrences r left join users a on a.id = r.assignee_id where r.id = ${created?.id ?? ''}`,
        ),
      );
    }),
  );

  app.patch(
    '/recurrences/:id',
    { schema: { params: idParams, body: z.object({ isActive: z.boolean() }) } },
    (request) =>
      asViewer(request, async (tx) => {
        const updated = await rows<{ id: string }>(
          tx,
          sql`update task_recurrences set is_active = ${request.body.isActive} where id = ${request.params.id} returning id`,
        );
        if (!updated.length) throw forbidden();
        return { ok: true };
      }),
  );

  app.delete('/recurrences/:id', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx) => {
      const deleted = await rows<{ id: string }>(tx, sql`delete from task_recurrences where id = ${request.params.id} returning id`);
      if (!deleted.length) throw forbidden();
      return { ok: true };
    }),
  );

  // Automações (só gestor do departamento configura; o banco executa).
  app.get('/projects/:id/automations', { schema: { params: idParams } }, (request) =>
    asViewer(request, (tx) =>
      rows<AutomationRuleDto>(
        tx,
        sql`select ${RULE_COLUMNS} from automation_rules r left join users a on a.id = r.action_user_id
            where r.project_id = ${request.params.id} order by r.created_at`,
      ),
    ),
  );

  app.post('/projects/:id/automations', { schema: { params: idParams, body: automationRuleSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      const p = await projectDepartment(tx, request.params.id);
      if (!permissions.manageProjects(viewer, p.departmentId)) throw forbidden('Só o gestor configura automações.');
      const b = request.body;
      if (b.columnId) {
        const col = await one<{ id: string }>(
          tx,
          sql`select id from board_columns where id = ${b.columnId} and project_id = ${request.params.id}`,
        );
        if (!col) throw unprocessable('A coluna não é deste projeto.');
      }
      const created = await one<{ id: string }>(
        tx,
        sql`insert into automation_rules (project_id, name, trigger, column_id, trigger_priority, action, action_user_id,
                                          action_priority, is_active, created_by)
            values (${request.params.id}, ${b.name}, ${b.trigger}, ${b.columnId ?? null}, ${b.triggerPriority ?? null},
                    ${b.action}, ${b.actionUserId ?? null}, ${b.actionPriority ?? null}, ${b.isActive}, ${viewer.id})
            returning id`,
      );
      return reply.status(201).send(
        await one<AutomationRuleDto>(
          tx,
          sql`select ${RULE_COLUMNS} from automation_rules r left join users a on a.id = r.action_user_id where r.id = ${created?.id ?? ''}`,
        ),
      );
    }),
  );

  app.patch(
    '/automations/:id',
    { schema: { params: idParams, body: z.object({ isActive: z.boolean() }) } },
    (request) =>
      asViewer(request, async (tx) => {
        const updated = await rows<{ id: string }>(
          tx,
          sql`update automation_rules set is_active = ${request.body.isActive} where id = ${request.params.id} returning id`,
        );
        if (!updated.length) throw forbidden('Só o gestor configura automações.');
        return { ok: true };
      }),
  );

  app.delete('/automations/:id', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx) => {
      const deleted = await rows<{ id: string }>(tx, sql`delete from automation_rules where id = ${request.params.id} returning id`);
      if (!deleted.length) throw forbidden('Só o gestor configura automações.');
      return { ok: true };
    }),
  );
};
