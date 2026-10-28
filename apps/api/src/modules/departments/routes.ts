import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  addMemberSchema,
  departmentSchema,
  permissions,
  ticketTypeSchema,
  updateDepartmentSchema,
  uuid,
  type DepartmentDto,
  type DepartmentMemberDto,
  type TicketTypeDto,
} from '@hub/shared';
import type { Executor } from '@hub/db';
import { audit } from '../../lib/audit';
import { one, rows } from '../../lib/sql';
import { asViewer } from '../../plugins/auth';
import { forbidden, notFound, unprocessable } from '../../plugins/errors';

const idParams = z.object({ id: uuid });

const DEPT_COLUMNS = sql`
  d.id, d.name, d.acronym, d.color, d.description, d.accepts_tickets as "acceptsTickets",
  app.iso(d.archived_at) as "archivedAt",
  coalesce((select json_agg(json_build_object('id', u.id, 'name', u.name, 'avatarUrl', u.avatar_url) order by u.name)
    from department_members m join users u on u.id = m.user_id
    where m.department_id = d.id and m.is_manager and u.is_active), '[]') as managers,
  (select count(*)::int from department_members m join users u on u.id = m.user_id
    where m.department_id = d.id and u.is_active) as "memberCount"`;

function getDepartment(tx: Executor, id: string) {
  return one<DepartmentDto>(tx, sql`select ${DEPT_COLUMNS} from departments d where d.id = ${id}`);
}

const TYPE_COLUMNS = sql`id, department_id as "departmentId", name, description,
  default_due_days as "defaultDueDays", sla_hours as "slaHours", is_active as "isActive"`;

export const departmentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/departments',
    { schema: { querystring: z.object({ includeArchived: z.coerce.boolean().default(false) }) } },
    (request) =>
      asViewer(request, (tx) =>
        rows<DepartmentDto>(
          tx,
          sql`select ${DEPT_COLUMNS} from departments d
              where ${request.query.includeArchived} or d.archived_at is null
              order by d.name`,
        ),
      ),
  );

  app.get('/departments/:id', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx) => {
      const dept = await getDepartment(tx, request.params.id);
      if (!dept) throw notFound('Departamento não encontrado.');
      return dept;
    }),
  );

  // RF-4.8 (o trigger cria o projeto, o quadro de chamados e o tipo padrão: RF-5.1).
  app.post('/departments', { schema: { body: departmentSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      if (!permissions.manageDepartments(viewer)) throw forbidden();
      const b = request.body;
      const created = await one<{ id: string }>(
        tx,
        sql`insert into departments (name, acronym, color, description, accepts_tickets)
            values (${b.name}, ${b.acronym}, ${b.color}, ${b.description ?? null}, ${b.acceptsTickets})
            returning id`,
      );
      if (!created) throw new Error('Falha ao criar departamento');
      await audit(tx, request, 'department_created', b.acronym);
      return reply.status(201).send(await getDepartment(tx, created.id));
    }),
  );

  app.patch('/departments/:id', { schema: { params: idParams, body: updateDepartmentSchema } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      if (!permissions.manageDepartments(viewer)) throw forbidden();
      const b = request.body;
      await tx.execute(sql`
        update departments set
          name = coalesce(${b.name ?? null}, name),
          acronym = coalesce(${b.acronym ?? null}, acronym),
          color = coalesce(${b.color ?? null}::department_color, color),
          description = case when ${b.description !== undefined} then ${b.description ?? null} else description end,
          accepts_tickets = coalesce(${b.acceptsTickets ?? null}::boolean, accepts_tickets)
        where id = ${request.params.id}`);
      await audit(tx, request, 'department_updated', request.params.id, { fields: Object.keys(b) });
      return getDepartment(tx, request.params.id);
    }),
  );

  app.post(
    '/departments/:id/archive',
    { schema: { params: idParams, body: z.object({ archived: z.boolean() }) } },
    (request) =>
      asViewer(request, async (tx, viewer) => {
        if (!permissions.manageDepartments(viewer)) throw forbidden();
        await tx.execute(sql`
          update departments set archived_at = case when ${request.body.archived} then now() end
          where id = ${request.params.id}`);
        await audit(tx, request, request.body.archived ? 'department_archived' : 'department_restored', request.params.id);
        return getDepartment(tx, request.params.id);
      }),
  );

  app.get('/departments/:id/members', { schema: { params: idParams } }, (request) =>
    asViewer(request, (tx) =>
      rows<DepartmentMemberDto>(
        tx,
        sql`select u.id, u.name, u.avatar_url as "avatarUrl", u.email, u.role,
              m.is_manager as "isManager", m.is_primary as "isPrimary", u.is_active as "isActive"
            from department_members m join users u on u.id = m.user_id
            where m.department_id = ${request.params.id}
            order by m.is_manager desc, u.name`,
      ),
    ),
  );

  // Gestor adiciona membros ao próprio departamento; só o admin define gestores (RLS confirma).
  app.post('/departments/:id/members', { schema: { params: idParams, body: addMemberSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      const deptId = request.params.id;
      const b = request.body;
      if (!permissions.addMembers(viewer, deptId)) throw forbidden();
      if (b.isManager && viewer.role !== 'admin') throw forbidden('Só o administrador define gestores.');
      if (b.isManager) {
        const target = await one<{ role: string }>(tx, sql`select role from users where id = ${b.userId}`);
        if (!target || !['admin', 'gestor'].includes(target.role)) {
          throw unprocessable('Só usuários com perfil Gestor podem ser gestores de departamento.');
        }
      }
      await tx.execute(sql`
        insert into department_members (user_id, department_id, is_manager, is_primary)
        values (${b.userId}, ${deptId}, ${b.isManager},
                ${b.isPrimary} or not exists (select 1 from department_members where user_id = ${b.userId} and is_primary))
        on conflict (user_id, department_id) do update set is_manager = excluded.is_manager`);
      await audit(tx, request, 'member_added', deptId, { userId: b.userId, isManager: b.isManager });
      return reply.status(201).send({ ok: true });
    }),
  );

  app.delete(
    '/departments/:id/members/:userId',
    { schema: { params: z.object({ id: uuid, userId: uuid }) } },
    (request) =>
      asViewer(request, async (tx, viewer) => {
        if (!permissions.addMembers(viewer, request.params.id)) throw forbidden();
        const result = await rows<{ id: string }>(
          tx,
          sql`delete from department_members
              where department_id = ${request.params.id} and user_id = ${request.params.userId}
              returning id`,
        );
        if (!result.length) throw forbidden('Não foi possível remover este membro.');
        await audit(tx, request, 'member_removed', request.params.id, { userId: request.params.userId });
        return { ok: true };
      }),
  );

  // Tipos de chamado (RF-4.10): parametrizáveis sem mudar código.
  app.get(
    '/departments/:id/ticket-types',
    { schema: { params: idParams, querystring: z.object({ all: z.coerce.boolean().default(false) }) } },
    (request) =>
      asViewer(request, (tx) =>
        rows<TicketTypeDto>(
          tx,
          sql`select ${TYPE_COLUMNS} from ticket_types
              where department_id = ${request.params.id} and (${request.query.all} or is_active)
              order by name`,
        ),
      ),
  );

  app.post('/departments/:id/ticket-types', { schema: { params: idParams, body: ticketTypeSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      if (!permissions.manageProjects(viewer, request.params.id)) throw forbidden();
      const b = request.body;
      const created = await one<TicketTypeDto>(
        tx,
        sql`insert into ticket_types (department_id, name, description, default_due_days, sla_hours, is_active)
            values (${request.params.id}, ${b.name}, ${b.description ?? null}, ${b.defaultDueDays ?? null}, ${b.slaHours ?? null}, ${b.isActive})
            returning ${TYPE_COLUMNS}`,
      );
      return reply.status(201).send(created);
    }),
  );

  app.patch('/ticket-types/:id', { schema: { params: idParams, body: ticketTypeSchema.partial() } }, (request) =>
    asViewer(request, async (tx) => {
      const b = request.body;
      const updated = await one<TicketTypeDto>(
        tx,
        sql`update ticket_types set
              name = coalesce(${b.name ?? null}, name),
              description = case when ${b.description !== undefined} then ${b.description ?? null} else description end,
              default_due_days = case when ${b.defaultDueDays !== undefined} then ${b.defaultDueDays ?? null}::int else default_due_days end,
              sla_hours = case when ${b.slaHours !== undefined} then ${b.slaHours ?? null}::int else sla_hours end,
              is_active = coalesce(${b.isActive ?? null}::boolean, is_active)
            where id = ${request.params.id}
            returning ${TYPE_COLUMNS}`,
      );
      if (!updated) throw forbidden();
      return updated;
    }),
  );
};
