import { sql } from 'drizzle-orm';
import { generateNKeysBetween } from 'fractional-indexing';
import { keyBetween } from '../../lib/positions';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Executor } from '@hub/db';
import {
  columnSchema,
  deleteColumnSchema,
  labelSchema,
  permissions,
  projectSchema,
  reorderColumnsSchema,
  updateColumnSchema,
  updateProjectSchema,
  uuid,
  type ColumnDto,
  type LabelDto,
  type ProjectDetailDto,
  type ProjectDto,
  type UserRef,
} from '@hub/shared';
import { one, rows } from '../../lib/sql';
import { asViewer } from '../../plugins/auth';
import { forbidden, notFound, unprocessable } from '../../plugins/errors';
import type { RequestViewer } from '../../plugins/auth';

const idParams = z.object({ id: uuid });

const PROJECT_COLUMNS = sql`
  p.id, p.department_id as "departmentId", d.name as "departmentName", d.color as "departmentColor",
  p.name, p.key, p.kind, p.description, p.start_date::text as "startDate", p.end_date::text as "endDate",
  app.iso(p.archived_at) as "archivedAt",
  (select count(*)::int from tasks t join board_columns c on c.id = t.column_id
    where t.project_id = p.id and t.deleted_at is null and t.parent_task_id is null
      and c.status_category <> 'done') as "openTaskCount"`;

async function getProject(tx: Executor, where: ReturnType<typeof sql>) {
  return one<ProjectDto>(
    tx,
    sql`select ${PROJECT_COLUMNS} from projects p join departments d on d.id = p.department_id where ${where}`,
  );
}

export async function projectDetail(tx: Executor, viewer: RequestViewer, project: ProjectDto): Promise<ProjectDetailDto> {
  const [columns, labels, members] = await Promise.all([
    rows<ColumnDto>(
      tx,
      sql`select id, name, position, status_category as "statusCategory", wip_limit as "wipLimit",
            ticket_stage as "ticketStage"
          from board_columns where project_id = ${project.id} order by position`,
    ),
    rows<LabelDto>(tx, sql`select id, name, color from labels where project_id = ${project.id} order by name`),
    rows<UserRef>(
      tx,
      sql`select u.id, u.name, u.avatar_url as "avatarUrl" from users u
          where u.is_active and (
            exists (select 1 from project_members pm where pm.project_id = ${project.id} and pm.user_id = u.id)
            or exists (select 1 from department_members m where m.department_id = ${project.departmentId} and m.user_id = u.id))
          order by u.name`,
    ),
  ]);
  return {
    ...project,
    columns,
    labels,
    members,
    canManage: permissions.manageProjects(viewer, project.departmentId),
    canEdit: permissions.editTasks(viewer, project.departmentId),
  };
}

async function columnProject(tx: Executor, columnId: string) {
  return one<{ projectId: string; departmentId: string; ticketStage: string | null }>(
    tx,
    sql`select c.project_id as "projectId", p.department_id as "departmentId", c.ticket_stage as "ticketStage"
        from board_columns c join projects p on p.id = c.project_id where c.id = ${columnId}`,
  );
}

export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/projects',
    {
      schema: {
        querystring: z.object({
          departmentId: uuid.optional(),
          includeArchived: z.coerce.boolean().default(false),
        }),
      },
    },
    (request) =>
      asViewer(request, (tx) =>
        rows<ProjectDto>(
          tx,
          sql`select ${PROJECT_COLUMNS} from projects p join departments d on d.id = p.department_id
              where (app.sees_all() or app.is_member(p.department_id))
                and (${request.query.departmentId ?? null}::uuid is null or p.department_id = ${request.query.departmentId ?? null}::uuid)
                and (${request.query.includeArchived} or p.archived_at is null)
              order by d.name, p.kind desc, p.name`,
        ),
      ),
  );

  app.get('/projects/by-key/:key', { schema: { params: z.object({ key: z.string().max(30) }) } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const project = await getProject(tx, sql`p.key = ${request.params.key.toUpperCase()}`);
      if (!project || !(viewer.seesAllDepartments || viewer.departmentIds.includes(project.departmentId))) {
        throw notFound('Projeto não encontrado.');
      }
      return projectDetail(tx, viewer, project);
    }),
  );

  // RF-5.2: gestor cria projeto com as colunas padrão (RF-5.5).
  app.post('/projects', { schema: { body: projectSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      const b = request.body;
      if (!permissions.manageProjects(viewer, b.departmentId)) throw forbidden();
      if (b.startDate && b.endDate && b.endDate < b.startDate) {
        throw unprocessable('A data de fim não pode ser antes do início.');
      }
      const created = await one<{ id: string }>(
        tx,
        sql`insert into projects (department_id, name, key, description, start_date, end_date)
            values (${b.departmentId}, ${b.name}, ${b.key}, ${b.description ?? null}, ${b.startDate ?? null}, ${b.endDate ?? null})
            returning id`,
      );
      if (!created) throw new Error('Falha ao criar projeto');
      const defaults: [string, string][] = [
        ['A fazer', 'todo'],
        ['Em andamento', 'doing'],
        ['Em revisão', 'doing'],
        ['Concluído', 'done'],
      ];
      const keys = generateNKeysBetween(null, null, defaults.length);
      for (const [i, [name, category]] of defaults.entries()) {
        await tx.execute(sql`insert into board_columns (project_id, name, position, status_category)
                             values (${created.id}, ${name}, ${keys[i] ?? 'a0'}, ${category})`);
      }
      for (const userId of b.memberIds) {
        await tx.execute(sql`insert into project_members (project_id, user_id) values (${created.id}, ${userId}) on conflict do nothing`);
      }
      const project = await getProject(tx, sql`p.id = ${created.id}`);
      if (!project) throw new Error('Falha ao criar projeto');
      return reply.status(201).send(await projectDetail(tx, viewer, project));
    }),
  );

  app.patch('/projects/:id', { schema: { params: idParams, body: updateProjectSchema } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const project = await getProject(tx, sql`p.id = ${request.params.id}`);
      if (!project) throw notFound('Projeto não encontrado.');
      if (!permissions.manageProjects(viewer, project.departmentId)) throw forbidden();
      const b = request.body;
      await tx.execute(sql`
        update projects set
          name = coalesce(${b.name ?? null}, name),
          description = case when ${b.description !== undefined} then ${b.description ?? null} else description end,
          start_date = case when ${b.startDate !== undefined} then ${b.startDate ?? null}::date else start_date end,
          end_date = case when ${b.endDate !== undefined} then ${b.endDate ?? null}::date else end_date end
        where id = ${project.id}`);
      if (b.memberIds) {
        await tx.execute(sql`delete from project_members where project_id = ${project.id}`);
        for (const userId of b.memberIds) {
          await tx.execute(sql`insert into project_members (project_id, user_id) values (${project.id}, ${userId})`);
        }
      }
      const updated = await getProject(tx, sql`p.id = ${project.id}`);
      if (!updated) throw notFound();
      return projectDetail(tx, viewer, updated);
    }),
  );

  // RF-5.4: arquivar (some das listas, continua consultável).
  app.post(
    '/projects/:id/archive',
    { schema: { params: idParams, body: z.object({ archived: z.boolean() }) } },
    (request) =>
      asViewer(request, async (tx, viewer) => {
        const project = await getProject(tx, sql`p.id = ${request.params.id}`);
        if (!project) throw notFound('Projeto não encontrado.');
        if (!permissions.manageProjects(viewer, project.departmentId)) throw forbidden();
        if (project.kind === 'tickets') throw unprocessable('O quadro de chamados não pode ser arquivado.');
        await tx.execute(sql`update projects set archived_at = case when ${request.body.archived} then now() end where id = ${project.id}`);
        return { ok: true };
      }),
  );

  // Colunas (RF-5.6). O quadro de chamados tem colunas fixas (etapas do fluxo).
  app.post('/projects/:id/columns', { schema: { params: idParams, body: columnSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      const project = await getProject(tx, sql`p.id = ${request.params.id}`);
      if (!project) throw notFound('Projeto não encontrado.');
      if (!permissions.configureColumns(viewer, project.departmentId)) throw forbidden();
      if (project.kind === 'tickets') throw unprocessable('As colunas do quadro de chamados são fixas.');
      const last = await one<{ position: string | null }>(
        tx,
        sql`select max(position) as position from board_columns where project_id = ${project.id}`,
      );
      const b = request.body;
      const created = await one<ColumnDto>(
        tx,
        sql`insert into board_columns (project_id, name, position, status_category, wip_limit)
            values (${project.id}, ${b.name}, ${keyBetween(last?.position ?? null, null)}, ${b.statusCategory}, ${b.wipLimit ?? null})
            returning id, name, position, status_category as "statusCategory", wip_limit as "wipLimit", ticket_stage as "ticketStage"`,
      );
      return reply.status(201).send(created);
    }),
  );

  app.patch('/columns/:id', { schema: { params: idParams, body: updateColumnSchema } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const col = await columnProject(tx, request.params.id);
      if (!col) throw notFound('Coluna não encontrada.');
      if (!permissions.configureColumns(viewer, col.departmentId) || col.ticketStage) throw forbidden();
      const b = request.body;
      return one<ColumnDto>(
        tx,
        sql`update board_columns set
              name = coalesce(${b.name ?? null}, name),
              status_category = coalesce(${b.statusCategory ?? null}::status_category, status_category),
              wip_limit = case when ${b.wipLimit !== undefined} then ${b.wipLimit ?? null}::int else wip_limit end
            where id = ${request.params.id}
            returning id, name, position, status_category as "statusCategory", wip_limit as "wipLimit", ticket_stage as "ticketStage"`,
      );
    }),
  );

  app.put('/projects/:id/columns/order', { schema: { params: idParams, body: reorderColumnsSchema } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const project = await getProject(tx, sql`p.id = ${request.params.id}`);
      if (!project) throw notFound('Projeto não encontrado.');
      if (!permissions.configureColumns(viewer, project.departmentId) || project.kind === 'tickets') throw forbidden();
      const ids = request.body.columnIds;
      const keys = generateNKeysBetween(null, null, ids.length);
      for (const [i, id] of ids.entries()) {
        await tx.execute(sql`update board_columns set position = ${keys[i] ?? 'a0'} where id = ${id} and project_id = ${project.id}`);
      }
      return { ok: true };
    }),
  );

  // Excluir coluna: os cartões vão para outra coluna do mesmo projeto.
  app.delete(
    '/columns/:id',
    { schema: { params: idParams, querystring: deleteColumnSchema } },
    (request) =>
      asViewer(request, async (tx, viewer) => {
        const col = await columnProject(tx, request.params.id);
        if (!col) throw notFound('Coluna não encontrada.');
        if (!permissions.configureColumns(viewer, col.departmentId) || col.ticketStage) throw forbidden();
        const count = await one<{ n: number }>(
          tx,
          sql`select count(*)::int as n from board_columns where project_id = ${col.projectId}`,
        );
        if ((count?.n ?? 0) <= 1) throw unprocessable('O quadro precisa ter pelo menos uma coluna.');
        const hasTasks = await one<{ n: number }>(
          tx,
          sql`select count(*)::int as n from tasks where column_id = ${request.params.id}`,
        );
        if ((hasTasks?.n ?? 0) > 0) {
          const target = request.query.moveTasksTo;
          if (!target) throw unprocessable('Escolha para qual coluna os cartões vão.');
          const dest = await columnProject(tx, target);
          if (dest?.projectId !== col.projectId || target === request.params.id) {
            throw unprocessable('Coluna de destino inválida.');
          }
          const moving = await rows<{ id: string }>(
            tx,
            sql`select id from tasks where column_id = ${request.params.id} order by position`,
          );
          const last = await one<{ position: string | null }>(
            tx,
            sql`select max(position) as position from tasks where column_id = ${target}`,
          );
          const keys = generateNKeysBetween(last?.position ?? null, null, moving.length);
          for (const [i, t] of moving.entries()) {
            await tx.execute(sql`update tasks set column_id = ${target}, position = ${keys[i] ?? 'a0'} where id = ${t.id}`);
          }
        }
        await tx.execute(sql`delete from board_columns where id = ${request.params.id}`);
        return { ok: true };
      }),
  );

  app.post('/projects/:id/labels', { schema: { params: idParams, body: labelSchema } }, (request, reply) =>
    asViewer(request, async (tx) => {
      const created = await one<LabelDto>(
        tx,
        sql`insert into labels (project_id, name, color) values (${request.params.id}, ${request.body.name}, ${request.body.color})
            returning id, name, color`,
      );
      return reply.status(201).send(created);
    }),
  );

  app.delete('/labels/:id', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx) => {
      const deleted = await rows<{ id: string }>(tx, sql`delete from labels where id = ${request.params.id} returning id`);
      if (!deleted.length) throw forbidden();
      return { ok: true };
    }),
  );
};
