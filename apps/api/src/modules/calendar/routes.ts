import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  calendarEventSchema,
  calendarQuery,
  isManagerOf,
  permissions,
  todayIso,
  uuid,
  type CalendarEventDto,
  type CalendarItemDto,
} from '@hub/shared';
import { one, rows } from '../../lib/sql';
import { asViewer } from '../../plugins/auth';
import { forbidden, notFound } from '../../plugins/errors';

type Row = Omit<CalendarItemDto, 'canDrag' | 'overdue'> & { executorDepartmentId: string | null };

/**
 * Seção 14: tarefas (prazo, ou barra do início ao prazo), chamados recebidos (prazo combinado),
 * chamados enviados (prazo desejado, contorno tracejado) e eventos institucionais.
 * Sem departmentId = calendário geral (tudo o que o usuário pode ver, RF-14.9).
 */
export const calendarRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/calendar', { schema: { querystring: calendarQuery } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const { from, to, departmentId } = request.query;
      const dept = departmentId ?? null;
      const list = await rows<Row>(
        tx,
        sql`
        select t.id::text, case when k.id is null then 'task' else 'ticket_received' end as kind,
          t.title, coalesce(k.code, p.key || '-' || t.number) as code,
          case when k.id is null then coalesce(t.start_date, t.due_date) else t.due_date end::text as start,
          case when k.id is null and t.start_date is not null then t.due_date::text end as "end",
          d.id as "departmentId", d.color as "departmentColor", d.acronym as "departmentAcronym",
          p.id as "projectId", t.assignee_id as "assigneeId", t.priority, null::text as "eventKind",
          (c.status_category = 'done' or k.status in ('approved', 'rejected', 'cancelled')) as done,
          d.id as "executorDepartmentId"
        from tasks t
        join projects p on p.id = t.project_id
        join departments d on d.id = p.department_id
        join board_columns c on c.id = t.column_id
        left join tickets k on k.task_id = t.id
        where t.deleted_at is null and t.parent_task_id is null and t.due_date is not null
          and coalesce(t.start_date, t.due_date) <= ${to}::date and t.due_date >= ${from}::date
          and (app.sees_all() or app.is_member(d.id))
          and (${dept}::uuid is null or d.id = ${dept}::uuid)
        union all
        select t.id::text, 'ticket_sent', t.title, k.code, k.desired_due_date::text, null,
          rd.id, rd.color, rd.acronym, null, t.assignee_id, t.priority, null,
          k.status in ('approved', 'rejected', 'cancelled'), k.target_department_id
        from tickets k
        join tasks t on t.id = k.task_id
        join departments rd on rd.id = k.requester_department_id
        where k.desired_due_date between ${from}::date and ${to}::date
          and not (app.is_member(k.target_department_id) and (${dept}::uuid is null or k.target_department_id = ${dept}::uuid))
          and (${dept}::uuid is null or k.requester_department_id = ${dept}::uuid)
        union all
        select e.id::text, 'event', e.title, null, e.start_date::text,
          case when e.end_date > e.start_date then e.end_date::text end,
          e.department_id, d.color, d.acronym, null, null, null, e.kind::text, false, null
        from calendar_events e left join departments d on d.id = e.department_id
        where e.start_date <= ${to}::date and e.end_date >= ${from}::date
          and (e.department_id is null or ${dept}::uuid is null or e.department_id = ${dept}::uuid)
        order by start`,
      );
      const today = todayIso();
      return list.map(({ executorDepartmentId, ...item }): CalendarItemDto => {
        const deadline = item.end ?? item.start;
        let canDrag = false;
        if (item.kind === 'task' && item.departmentId) canDrag = permissions.editTasks(viewer, item.departmentId);
        if (item.kind === 'ticket_received' && executorDepartmentId) canDrag = isManagerOf(viewer, executorDepartmentId);
        return { ...item, overdue: item.kind !== 'event' && !item.done && deadline < today, canDrag: canDrag && !item.done };
      });
    }),
  );

  app.get(
    '/calendar-events',
    { schema: { querystring: z.object({ departmentId: uuid.optional() }) } },
    (request) =>
      asViewer(request, (tx) =>
        rows<CalendarEventDto>(
          tx,
          sql`select id, title, description, department_id as "departmentId", start_date::text as "startDate",
                end_date::text as "endDate", kind
              from calendar_events
              where ${request.query.departmentId ?? null}::uuid is null or department_id = ${request.query.departmentId ?? null}::uuid
              order by start_date desc limit 500`,
        ),
      ),
  );

  // RF-14.13: admin cadastra eventos gerais; gestor, do próprio departamento.
  app.post('/calendar-events', { schema: { body: calendarEventSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      const b = request.body;
      const allowed = b.departmentId
        ? permissions.manageDepartmentEvents(viewer, b.departmentId)
        : permissions.manageGeneralEvents(viewer);
      if (!allowed) throw forbidden();
      const created = await one<CalendarEventDto>(
        tx,
        sql`insert into calendar_events (title, description, department_id, start_date, end_date, kind, created_by)
            values (${b.title}, ${b.description ?? null}, ${b.departmentId ?? null}, ${b.startDate}, ${b.endDate}, ${b.kind}, ${viewer.id})
            returning id, title, description, department_id as "departmentId", start_date::text as "startDate",
              end_date::text as "endDate", kind`,
      );
      return reply.status(201).send(created);
    }),
  );

  app.delete('/calendar-events/:id', { schema: { params: z.object({ id: uuid }) } }, (request) =>
    asViewer(request, async (tx) => {
      const deleted = await rows<{ id: string }>(tx, sql`delete from calendar_events where id = ${request.params.id} returning id`);
      if (!deleted.length) throw notFound('Evento não encontrado ou sem permissão.');
      return { ok: true };
    }),
  );

  /** RF-14.15: a data cai em feriado? (o aviso de fim de semana é calculado no navegador). */
  app.get('/calendar/holiday', { schema: { querystring: z.object({ date: z.iso.date() }) } }, (request) =>
    asViewer(request, async (tx) => {
      const row = await one<{ title: string }>(
        tx,
        sql`select title from calendar_events
            where kind in ('holiday', 'recess') and ${request.query.date}::date between start_date and end_date
            limit 1`,
      );
      return { holiday: row?.title ?? null };
    }),
  );
};
