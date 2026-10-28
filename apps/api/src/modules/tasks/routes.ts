import { and, sql, type SQL } from 'drizzle-orm';
import { keyBetween } from '../../lib/positions';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Transaction } from '@hub/db';
import {
  addDays,
  boardFiltersQuery,
  createTaskSchema,
  moveTaskSchema,
  moveTaskToProjectSchema,
  permissions,
  richDocToText,
  sanitizeRichDoc,
  searchQuery,
  todayIso,
  updateTaskSchema,
  uuid,
  type SearchResultDto,
  type TrashItemDto,
} from '@hub/shared';
import { one, rows } from '../../lib/sql';
import { asViewer, type RequestViewer } from '../../plugins/auth';
import { forbidden, notFound, unprocessable } from '../../plugins/errors';
import {
  getCards,
  getHistory,
  getMyTaskCards,
  getTaskDetail,
  resolveTaskId,
  taskDepartment,
  userRef,
} from './queries';

const idParams = z.object({ id: uuid });

async function lastPosition(tx: Transaction, columnId: string) {
  const row = await one<{ position: string | null }>(
    tx,
    sql`select max(position) as position from tasks where column_id = ${columnId}`,
  );
  return row?.position ?? null;
}

async function requireTask(tx: Transaction, viewer: RequestViewer, taskId: string, write = true) {
  const info = await taskDepartment(tx, taskId);
  if (!info) throw notFound('Tarefa não encontrada.');
  if (write && !permissions.editTasks(viewer, info.departmentId)) throw forbidden();
  return info;
}

async function setLabels(tx: Transaction, taskId: string, labelIds: string[]) {
  await tx.execute(sql`delete from task_labels where task_id = ${taskId}`);
  for (const labelId of labelIds) {
    await tx.execute(sql`
      insert into task_labels (task_id, label_id)
      select ${taskId}, l.id from labels l join tasks t on t.project_id = l.project_id
      where l.id = ${labelId} and t.id = ${taskId}`);
  }
}

async function addWatchers(tx: Transaction, taskId: string, userIds: (string | null | undefined)[]) {
  for (const userId of new Set(userIds.filter((u): u is string => Boolean(u)))) {
    await tx.execute(sql`insert into task_watchers (task_id, user_id) values (${taskId}, ${userId}) on conflict do nothing`);
  }
}

export async function notifyTask(tx: Transaction, taskId: string, type: string, recipients: string[], payload: Record<string, unknown> = {}) {
  if (!recipients.length) return;
  await tx.execute(
    sql`select app.notify_task(${taskId}, ${type}, ${`{${recipients.join(',')}}`}::uuid[], ${JSON.stringify(payload)}::jsonb)`,
  );
}

function boardWhere(projectId: string, viewer: RequestViewer, f: z.infer<typeof boardFiltersQuery>): SQL {
  const today = todayIso();
  const parts: SQL[] = [
    sql`t.project_id = ${projectId}`,
    sql`t.parent_task_id is null`,
    sql`t.deleted_at is null`,
    sql`t.in_backlog = ${f.backlog ?? false}`,
  ];
  if (f.epicId) parts.push(sql`t.epic_id = ${f.epicId}`);
  if (f.assigneeId) parts.push(sql`t.assignee_id = ${f.assigneeId}`);
  if (f.mine) parts.push(sql`t.assignee_id = ${viewer.id}`);
  if (f.priority) parts.push(sql`t.priority = ${f.priority}`);
  if (f.labelId) parts.push(sql`exists (select 1 from task_labels tl where tl.task_id = t.id and tl.label_id = ${f.labelId})`);
  if (f.due === 'overdue') parts.push(sql`t.due_date < ${today}::date and c.status_category <> 'done'`);
  if (f.due === 'this_week') parts.push(sql`t.due_date between ${today}::date and ${addDays(today, 7)}::date`);
  if (f.q) {
    parts.push(sql`(t.title ilike ${`%${f.q}%`} or t.description_text ilike ${`%${f.q}%`}
                    or (p.key || '-' || t.number) ilike ${`%${f.q}%`} or k.code ilike ${`%${f.q}%`})`);
  }
  return and(...parts) ?? sql`true`;
}

export const taskRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/projects/:id/tasks',
    { schema: { params: idParams, querystring: boardFiltersQuery } },
    (request) =>
      asViewer(request, (tx, viewer) =>
        getCards(tx, boardWhere(request.params.id, viewer, request.query), sql`c.position, t.position`),
      ),
  );

  app.get('/tasks/:code', { schema: { params: z.object({ code: z.string().max(40) }) } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const id = await resolveTaskId(tx, request.params.code);
      const detail = id ? await getTaskDetail(tx, viewer, id) : undefined;
      if (!detail) throw notFound('Tarefa não encontrada ou sem acesso.');
      return detail;
    }),
  );

  app.get('/tasks/:id/history', { schema: { params: idParams } }, (request) =>
    asViewer(request, (tx) => getHistory(tx, request.params.id)),
  );

  // RF-6.1: criação rápida (só título) ou completa.
  app.post('/tasks', { schema: { body: createTaskSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      const b = request.body;
      const project = await one<{ departmentId: string; kind: string; archived: boolean }>(
        tx,
        sql`select department_id as "departmentId", kind, archived_at is not null as archived from projects where id = ${b.projectId}`,
      );
      if (!project) throw notFound('Projeto não encontrado.');
      if (!permissions.editTasks(viewer, project.departmentId)) throw forbidden();
      if (project.kind === 'tickets' && !b.parentTaskId) {
        throw unprocessable('No quadro de chamados só entram chamados abertos por outros departamentos.');
      }

      let columnId = b.columnId;
      if (!columnId) {
        const first = await one<{ id: string }>(
          tx,
          sql`select id from board_columns where project_id = ${b.projectId} order by position limit 1`,
        );
        columnId = first?.id;
      }
      if (!columnId) throw unprocessable('O projeto não tem colunas.');

      const description = b.description ? sanitizeRichDoc(b.description) : null;
      const created = await one<{ id: string }>(
        tx,
        sql`insert into tasks (project_id, column_id, title, description, description_text, priority, assignee_id,
                               reporter_id, due_date, due_time, start_date, estimate, position, parent_task_id,
                               epic_id, in_backlog)
            values (${b.projectId}, ${columnId}, ${b.title}, ${description ? JSON.stringify(description) : null}::jsonb,
                    ${richDocToText(description)}, ${b.priority}, ${b.assigneeId ?? null}, ${viewer.id},
                    ${b.dueDate ?? null}, ${b.dueTime ?? null}, ${b.startDate ?? null}, ${b.estimate ?? null},
                    ${keyBetween(await lastPosition(tx, columnId), null)}, ${b.parentTaskId ?? null},
                    ${b.epicId ?? null}, ${b.inBacklog ?? false})
            returning id`,
      );
      if (!created) throw new Error('Falha ao criar tarefa');
      if (b.labelIds?.length) await setLabels(tx, created.id, b.labelIds);
      await addWatchers(tx, created.id, [viewer.id, b.assigneeId, ...(b.watcherIds ?? [])]);
      if (b.assigneeId && b.assigneeId !== viewer.id) {
        await notifyTask(tx, created.id, 'task_assigned', [b.assigneeId]);
      }
      return reply.status(201).send(await getTaskDetail(tx, viewer, created.id));
    }),
  );

  app.patch('/tasks/:id', { schema: { params: idParams, body: updateTaskSchema } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const id = request.params.id;
      const info = await requireTask(tx, viewer, id);
      const b = request.body;

      if (info.isTicket && b.inBacklog) throw unprocessable('Chamados não vão para o backlog.');

      // RF-14.7: prazo de chamado recebido muda pela ação do gestor, com motivo.
      if (info.isTicket && b.dueDate !== undefined) {
        const ticket = await one<{ id: string }>(tx, sql`select id from tickets where task_id = ${id}`);
        await tx.execute(sql`select app.ticket_set_due(${ticket?.id ?? null}, ${b.dueDate ?? null}::date, ${b.dueChangeReason ?? null})`);
      }

      const description = b.description === undefined ? undefined : b.description ? sanitizeRichDoc(b.description) : null;
      await tx.execute(sql`
        update tasks set
          title = coalesce(${b.title ?? null}, title),
          description = case when ${description !== undefined} then ${description ? JSON.stringify(description) : null}::jsonb else description end,
          description_text = case when ${description !== undefined} then ${richDocToText(description ?? null)} else description_text end,
          priority = coalesce(${b.priority ?? null}::priority, priority),
          assignee_id = case when ${b.assigneeId !== undefined} then ${b.assigneeId ?? null}::uuid else assignee_id end,
          due_date = case when ${b.dueDate !== undefined && !info.isTicket} then ${b.dueDate ?? null}::date else due_date end,
          due_time = case when ${b.dueTime !== undefined} then ${b.dueTime ?? null}::time else due_time end,
          start_date = case when ${b.startDate !== undefined} then ${b.startDate ?? null}::date else start_date end,
          estimate = case when ${b.estimate !== undefined} then ${b.estimate ?? null}::numeric else estimate end,
          epic_id = case when ${b.epicId !== undefined} then ${b.epicId ?? null}::uuid else epic_id end,
          in_backlog = coalesce(${b.inBacklog ?? null}::boolean, in_backlog)
        where id = ${id}`);

      if (b.columnId) {
        await tx.execute(sql`
          update tasks set column_id = ${b.columnId}, position = ${keyBetween(await lastPosition(tx, b.columnId), null)}
          where id = ${id} and column_id <> ${b.columnId}`);
      }
      if (b.labelIds) await setLabels(tx, id, b.labelIds);
      if (b.watcherIds) {
        await tx.execute(sql`delete from task_watchers where task_id = ${id}`);
        await addWatchers(tx, id, b.watcherIds);
      }
      if (b.assigneeId && b.assigneeId !== info.assigneeId && b.assigneeId !== viewer.id) {
        await addWatchers(tx, id, [b.assigneeId]);
        await notifyTask(tx, id, 'task_assigned', [b.assigneeId]);
      }
      return getTaskDetail(tx, viewer, id);
    }),
  );

  // RF-5.7: arrastar entre colunas e reordenar dentro da coluna (posição fracionária).
  app.post('/tasks/:id/move', { schema: { params: idParams, body: moveTaskSchema } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const id = request.params.id;
      await requireTask(tx, viewer, id);
      const b = request.body;
      const neighbours = await rows<{ id: string; position: string }>(
        tx,
        sql`select id, position from tasks
            where id = any(${`{${[b.beforeTaskId, b.afterTaskId].filter(Boolean).join(',')}}`}::uuid[])
              and column_id = ${b.columnId}`,
      );
      const before = neighbours.find((n) => n.id === b.beforeTaskId)?.position ?? null;
      const after = neighbours.find((n) => n.id === b.afterTaskId)?.position ?? null;
      let position: string;
      if (before && after && before >= after) {
        position = keyBetween(before, null);
      } else if (!before && !after) {
        position = keyBetween(await lastPosition(tx, b.columnId), null);
      } else {
        position = keyBetween(before, after);
      }
      await tx.execute(sql`update tasks set column_id = ${b.columnId}, position = ${position} where id = ${id}`);
      return { id, columnId: b.columnId, position };
    }),
  );

  // RF-11.3: exclusão vai para a lixeira.
  app.delete('/tasks/:id', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const info = await requireTask(tx, viewer, request.params.id, false);
      if (!permissions.deleteTask(viewer, info.departmentId, info.reporterId)) {
        throw forbidden('Você só pode excluir tarefas que criou.');
      }
      await tx.execute(sql`update tasks set deleted_at = now() where id = ${request.params.id}`);
      return { ok: true };
    }),
  );

  app.post('/tasks/:id/restore', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const info = await requireTask(tx, viewer, request.params.id, false);
      if (!permissions.restoreTask(viewer, info.departmentId)) throw forbidden();
      await tx.execute(sql`update tasks set deleted_at = null where id = ${request.params.id}`);
      return { ok: true };
    }),
  );

  app.get('/departments/:id/trash', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      if (!permissions.restoreTask(viewer, request.params.id)) throw forbidden();
      return rows<TrashItemDto>(
        tx,
        sql`select t.id, p.key || '-' || t.number as code, t.title, p.name as "projectName",
              app.iso(t.deleted_at) as "deletedAt", ${userRef('u')} as "deletedBy"
            from tasks t join projects p on p.id = t.project_id left join users u on u.id = t.deleted_by
            where p.department_id = ${request.params.id} and t.deleted_at is not null
            order by t.deleted_at desc`,
      );
    }),
  );

  // RF-6.9: duplicar e mover para outro projeto do mesmo departamento.
  app.post('/tasks/:id/duplicate', { schema: { params: idParams } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      const info = await requireTask(tx, viewer, request.params.id);
      if (info.isTicket) throw unprocessable('Chamados não podem ser duplicados.');
      const src = await one<{ columnId: string }>(tx, sql`select column_id as "columnId" from tasks where id = ${request.params.id}`);
      if (!src) throw notFound();
      const created = await one<{ id: string }>(
        tx,
        sql`insert into tasks (project_id, column_id, title, description, description_text, priority, assignee_id,
                               reporter_id, due_date, due_time, start_date, estimate, position, parent_task_id)
            select project_id, column_id, left(title || ' (cópia)', 200), description, description_text, priority,
                   assignee_id, ${viewer.id}, due_date, due_time, start_date, estimate,
                   ${keyBetween(await lastPosition(tx, src.columnId), null)}, parent_task_id
            from tasks where id = ${request.params.id}
            returning id`,
      );
      if (!created) throw new Error('Falha ao duplicar');
      await tx.execute(sql`insert into task_labels (task_id, label_id) select ${created.id}, label_id from task_labels where task_id = ${request.params.id}`);
      await addWatchers(tx, created.id, [viewer.id]);
      return reply.status(201).send(await getTaskDetail(tx, viewer, created.id));
    }),
  );

  app.post('/tasks/:id/move-project', { schema: { params: idParams, body: moveTaskToProjectSchema } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      await requireTask(tx, viewer, request.params.id);
      const first = await one<{ id: string }>(
        tx,
        sql`select id from board_columns where project_id = ${request.body.projectId} order by position limit 1`,
      );
      if (!first) throw notFound('Projeto de destino não encontrado.');
      await tx.execute(sql`
        update tasks set project_id = ${request.body.projectId}, column_id = ${first.id},
          position = ${keyBetween(await lastPosition(tx, first.id), null)}
        where id = ${request.params.id}`);
      await tx.execute(sql`delete from task_labels where task_id = ${request.params.id}`);
      return getTaskDetail(tx, viewer, request.params.id);
    }),
  );

  app.post('/tasks/:id/watch', { schema: { params: idParams, body: z.object({ watching: z.boolean() }) } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      if (request.body.watching) {
        await tx.execute(sql`insert into task_watchers (task_id, user_id) values (${request.params.id}, ${viewer.id}) on conflict do nothing`);
      } else {
        await tx.execute(sql`delete from task_watchers where task_id = ${request.params.id} and user_id = ${viewer.id}`);
      }
      return { ok: true };
    }),
  );

  // RF-5.14: tudo atribuído a mim, de todos os projetos.
  app.get('/my-tasks', (request) =>
    asViewer(request, (tx, viewer) =>
      getMyTaskCards(tx, sql`t.assignee_id = ${viewer.id} and t.deleted_at is null and c.status_category <> 'done'`),
    ),
  );

  // RF-6.10: busca global por código, título e descrição (só no que o usuário vê, via RLS).
  app.get('/search', { schema: { querystring: searchQuery } }, (request) =>
    asViewer(request, (tx) => {
      const q = request.query.q;
      const like = `%${q}%`;
      return rows<SearchResultDto>(
        tx,
        sql`select t.id, coalesce(k.code, p.key || '-' || t.number) as code, t.title, p.name as "projectName",
              left(nullif(t.description_text, ''), 140) as snippet
            from tasks t join projects p on p.id = t.project_id left join tickets k on k.task_id = t.id
            where t.deleted_at is null and (
              (p.key || '-' || t.number) ilike ${like} or k.code ilike ${like} or t.title ilike ${like}
              or to_tsvector('portuguese'::regconfig, t.title || ' ' || t.description_text)
                 @@ plainto_tsquery('portuguese'::regconfig, ${q}))
            order by (upper(p.key || '-' || t.number) = upper(${q}) or upper(k.code) = upper(${q})) desc,
                     t.updated_at desc
            limit 20`,
      );
    }),
  );
};
