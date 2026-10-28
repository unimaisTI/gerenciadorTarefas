import { sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  STATUS_CATEGORY_LABELS,
  TICKET_STATUS_LABELS,
  addDays,
  drilldownQuery,
  periodQuery,
  permissions,
  todayIso,
  type DashboardDto,
  type DrilldownItemDto,
  type FlowDashboardDto,
  type HomeDashboardDto,
  type MetricDto,
  type StatusCategory,
  type TicketStatus,
} from '@hub/shared';
import type { Executor } from '@hub/db';
import { one, rows } from '../../lib/sql';
import { asViewer, type RequestViewer } from '../../plugins/auth';
import { forbidden } from '../../plugins/errors';
import { listNotifications } from '../notifications/queries';
import { getMyTaskCards } from '../tasks/queries';
import { awaitingMyApproval, listTickets } from '../tickets/routes';

interface Period {
  from: string;
  to: string;
  departmentId?: string | undefined;
  projectId?: string | undefined;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** Período anterior de mesmo tamanho (RF-10.10). */
function previousPeriod(p: Period): Period {
  const len = daysBetween(p.from, p.to) + 1;
  return { ...p, from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

// Filtros: chamados contam para o departamento executor; tarefas, pelo projeto.
const ticketScope = (p: Period): SQL => sql`
  (${p.departmentId ?? null}::uuid is null or k.target_department_id = ${p.departmentId ?? null}::uuid)
  and (${p.projectId ?? null}::uuid is null or t.project_id = ${p.projectId ?? null}::uuid)`;

const taskScope = (p: Period): SQL => sql`
  t.deleted_at is null and t.parent_task_id is null
  and (${p.departmentId ?? null}::uuid is null or pr.department_id = ${p.departmentId ?? null}::uuid)
  and (${p.projectId ?? null}::uuid is null or t.project_id = ${p.projectId ?? null}::uuid)`;

const inPeriod = (col: SQL, p: Period) =>
  sql`(${col} at time zone 'America/Sao_Paulo')::date between ${p.from}::date and ${p.to}::date`;

/** Dias úteis de abertura → aprovação, sem o tempo em "Aguardando informações". */
const RESOLUTION_DAYS = sql`greatest(0,
  (select count(*) from generate_series(k.submitted_at::date, k.approved_at::date - 1, interval '1 day') g
   where extract(isodow from g) < 6) - k.paused_seconds / 86400.0)`;

async function ticketMetrics(tx: Executor, p: Period) {
  return one<{ opened: number; approved: number; avgDays: number | null; firstPass: number | null; avgReturns: number | null }>(
    tx,
    sql`select
          count(*) filter (where ${inPeriod(sql`k.submitted_at`, p)})::int as opened,
          count(*) filter (where k.status = 'approved' and ${inPeriod(sql`k.approved_at`, p)})::int as approved,
          avg(${RESOLUTION_DAYS}) filter (where k.status = 'approved' and ${inPeriod(sql`k.approved_at`, p)})::float8 as "avgDays",
          (100.0 * count(*) filter (where k.status = 'approved' and k.revision_count = 0 and ${inPeriod(sql`k.approved_at`, p)})
            / nullif(count(*) filter (where k.status = 'approved' and ${inPeriod(sql`k.approved_at`, p)}), 0))::float8 as "firstPass",
          avg(k.revision_count) filter (where k.status = 'approved' and ${inPeriod(sql`k.approved_at`, p)})::float8 as "avgReturns"
        from tickets k join tasks t on t.id = k.task_id
        where ${ticketScope(p)}`,
  );
}

const metric = (value: number | null | undefined, previous: number | null | undefined): MetricDto => ({
  value: Math.round((value ?? 0) * 10) / 10,
  previous: previous == null ? null : Math.round(previous * 10) / 10,
});

function assertAccess(viewer: RequestViewer, departmentId: string | undefined) {
  if (!permissions.viewDashboards(viewer) && !(departmentId && permissions.viewDepartmentReports(viewer, departmentId))) {
    throw forbidden('Você não tem acesso aos painéis.');
  }
  if (departmentId && !permissions.viewDepartmentReports(viewer, departmentId)) {
    throw forbidden('Você não tem acesso ao painel deste departamento.');
  }
}

async function buildDashboard(tx: Executor, p: Period): Promise<DashboardDto> {
  const prev = previousPeriod(p);
  const today = todayIso();

  const [cur, old, tasksNow, onTime, weekly, resolution, departments, flow, ticketStatus, taskStatus, load, types, received] =
    await Promise.all([
      ticketMetrics(tx, p),
      ticketMetrics(tx, prev),
      one<{ overdue: number; next7: number }>(
        tx,
        sql`select count(*) filter (where t.due_date < ${today}::date)::int as overdue,
                   count(*) filter (where t.due_date between ${today}::date and ${addDays(today, 7)}::date)::int as next7
            from tasks t join projects pr on pr.id = t.project_id join board_columns c on c.id = t.column_id
            where ${taskScope(p)} and c.status_category <> 'done'`,
      ),
      rows<{ departmentId: string; label: string; color: DashboardDto['onTimeByDepartment'][number]['color']; pct: number; total: number }>(
        tx,
        sql`select d.id as "departmentId", d.acronym as label, d.color,
              coalesce(100.0 * count(*) filter (where (t.completed_at at time zone 'America/Sao_Paulo')::date <= t.due_date)
                / nullif(count(*), 0), 0)::float8 as pct,
              count(*)::int as total
            from tasks t join projects pr on pr.id = t.project_id join departments d on d.id = pr.department_id
            where ${taskScope(p)} and t.due_date is not null and t.completed_at is not null
              and ${inPeriod(sql`t.completed_at`, p)}
            group by d.id order by d.acronym`,
      ),
      rows<{ week: string; opened: number; done: number }>(
        tx,
        sql`with weeks as (
              select generate_series(date_trunc('week', ${p.from}::date), ${p.to}::date, interval '1 week')::date as week)
            select to_char(w.week, 'DD/MM') as week,
              (select count(*)::int from tasks t join projects pr on pr.id = t.project_id
                where ${taskScope(p)} and (t.created_at at time zone 'America/Sao_Paulo')::date >= w.week
                  and (t.created_at at time zone 'America/Sao_Paulo')::date < w.week + 7) as opened,
              (select count(*)::int from tasks t join projects pr on pr.id = t.project_id
                where ${taskScope(p)} and (t.completed_at at time zone 'America/Sao_Paulo')::date >= w.week
                  and (t.completed_at at time zone 'America/Sao_Paulo')::date < w.week + 7) as done
            from weeks w order by w.week`,
      ),
      rows<{ label: string; value: number }>(
        tx,
        sql`select to_char(date_trunc('week', k.approved_at at time zone 'America/Sao_Paulo'), 'DD/MM') as label,
              round(avg(${RESOLUTION_DAYS})::numeric, 1)::float8 as value
            from tickets k join tasks t on t.id = k.task_id
            where ${ticketScope(p)} and k.status = 'approved' and ${inPeriod(sql`k.approved_at`, p)}
            group by date_trunc('week', k.approved_at at time zone 'America/Sao_Paulo') order by 1`,
      ),
      rows<{ id: string; acronym: string }>(
        tx,
        sql`select id, acronym from departments where archived_at is null order by acronym`,
      ),
      rows<{ fromId: string; toId: string; n: number }>(
        tx,
        sql`select k.requester_department_id as "fromId", k.target_department_id as "toId", count(*)::int as n
            from tickets k join tasks t on t.id = k.task_id
            where ${inPeriod(sql`k.submitted_at`, p)}
              and (${p.projectId ?? null}::uuid is null or t.project_id = ${p.projectId ?? null}::uuid)
              and (${p.departmentId ?? null}::uuid is null or k.target_department_id = ${p.departmentId ?? null}::uuid
                   or k.requester_department_id = ${p.departmentId ?? null}::uuid)
            group by 1, 2`,
      ),
      rows<{ status: TicketStatus; n: number }>(
        tx,
        sql`select k.status, count(*)::int as n from tickets k join tasks t on t.id = k.task_id
            where ${ticketScope(p)} and k.status not in ('approved', 'rejected', 'cancelled')
            group by k.status`,
      ),
      rows<{ category: StatusCategory; n: number }>(
        tx,
        sql`select c.status_category as category, count(*)::int as n
            from tasks t join projects pr on pr.id = t.project_id join board_columns c on c.id = t.column_id
            where ${taskScope(p)} and pr.kind = 'regular' and c.status_category <> 'done'
            group by c.status_category`,
      ),
      rows<{ userId: string; label: string; value: number }>(
        tx,
        sql`select u.id as "userId", u.name as label, count(*)::int as value
            from tasks t join projects pr on pr.id = t.project_id join board_columns c on c.id = t.column_id
            join users u on u.id = t.assignee_id
            where ${taskScope(p)} and c.status_category <> 'done'
              and t.due_date between ${p.from}::date and ${p.to}::date
            group by u.id order by value desc, u.name limit 15`,
      ),
      rows<{ label: string; value: number }>(
        tx,
        sql`select tt.name || ' (' || d.acronym || ')' as label, count(*)::int as value
            from tickets k join tasks t on t.id = k.task_id join ticket_types tt on tt.id = k.ticket_type_id
            join departments d on d.id = k.target_department_id
            where ${ticketScope(p)} and ${inPeriod(sql`k.submitted_at`, p)}
            group by tt.name, d.acronym order by value desc limit 10`,
      ),
      p.departmentId
        ? one<{ received: number; sent: number; prevReceived: number; prevSent: number }>(
            tx,
            sql`select
                  count(*) filter (where k.target_department_id = ${p.departmentId} and ${inPeriod(sql`k.submitted_at`, p)})::int as received,
                  count(*) filter (where k.requester_department_id = ${p.departmentId} and ${inPeriod(sql`k.submitted_at`, p)})::int as sent,
                  count(*) filter (where k.target_department_id = ${p.departmentId} and ${inPeriod(sql`k.submitted_at`, prev)})::int as "prevReceived",
                  count(*) filter (where k.requester_department_id = ${p.departmentId} and ${inPeriod(sql`k.submitted_at`, prev)})::int as "prevSent"
                from tickets k`,
          )
        : Promise.resolve(undefined),
    ]);

  const visibleDepts = departments.filter(
    (d) => !p.departmentId || d.id === p.departmentId || flow.some((f) => f.fromId === d.id || f.toId === d.id),
  );
  const counts = visibleDepts.map((from) =>
    visibleDepts.map((to) => flow.find((f) => f.fromId === from.id && f.toId === to.id)?.n ?? 0),
  );

  return {
    period: { from: p.from, to: p.to, previousFrom: prev.from, previousTo: prev.to },
    ticketsOpened: metric(cur?.opened, old?.opened),
    ticketsApproved: metric(cur?.approved, old?.approved),
    avgResolutionDays: metric(cur?.avgDays, old?.avgDays),
    firstPassApprovalPct: metric(cur?.firstPass, old?.firstPass),
    avgReturnsPerTicket: metric(cur?.avgReturns, old?.avgReturns),
    overdueNow: tasksNow?.overdue ?? 0,
    dueNext7Days: tasksNow?.next7 ?? 0,
    onTimeByDepartment: onTime.map((o) => ({ ...o, pct: Math.round(o.pct) })),
    openedVsDone: weekly,
    resolutionByWeek: resolution,
    flowMatrix: { departments: visibleDepts, counts },
    pendingByStatus: [
      ...taskStatus.map((s) => ({ label: `Tarefas: ${STATUS_CATEGORY_LABELS[s.category]}`, value: s.n })),
      ...ticketStatus.map((s) => ({ label: `Chamados: ${TICKET_STATUS_LABELS[s.status]}`, value: s.n })),
    ],
    loadByAssignee: load,
    ticketsByType: types,
    openByStatus: taskStatus.map((s) => ({ label: STATUS_CATEGORY_LABELS[s.category], value: s.n })),
    ticketsReceived: metric(received?.received, received?.prevReceived),
    ticketsSent: metric(received?.sent, received?.prevSent),
    generatedAt: new Date().toISOString(),
  };
}

export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  // RF-10.1: página inicial.
  app.get('/dashboard/home', (request) =>
    asViewer(request, async (tx, viewer) => {
      const today = todayIso();
      const [todayTasks, overdue, approvals, notifications] = await Promise.all([
        getMyTaskCards(tx, sql`t.assignee_id = ${viewer.id} and t.deleted_at is null and c.status_category <> 'done' and t.due_date = ${today}::date`),
        getMyTaskCards(tx, sql`t.assignee_id = ${viewer.id} and t.deleted_at is null and c.status_category <> 'done' and t.due_date < ${today}::date`),
        listTickets(tx, awaitingMyApproval(viewer.id), sql`k.delivered_at`),
        listNotifications(tx, viewer.id, 6),
      ]);
      const result: HomeDashboardDto = { today: todayTasks, overdue, awaitingMyApproval: approvals, notifications };
      return result;
    }),
  );

  // RF-10.2 a RF-10.17: números calculados no banco, sob RLS.
  app.get('/dashboards', { schema: { querystring: periodQuery } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      assertAccess(viewer, request.query.departmentId);
      return buildDashboard(tx, request.query);
    }),
  );

  // Aba "Fluxo": onde o trabalho para (tempo por coluna), lead time, fluxo acumulado e SLA.
  app.get('/dashboards/flow', { schema: { querystring: periodQuery } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const p = request.query;
      assertAccess(viewer, p.departmentId);
      const days = Math.min(daysBetween(p.from, p.to), 120);
      const [timeInColumn, leadTimeByWeek, cfd, sla] = await Promise.all([
        rows<{ label: string; hours: number }>(
          tx,
          sql`with moves as (
                select l.changes->'column'->>'from' as col, l.created_at as left_at,
                  coalesce(lag(l.created_at) over (partition by l.entity_id order by l.created_at), t.created_at) as entered_at
                from activity_log l
                join tasks t on t.id = l.entity_id
                join projects pr on pr.id = t.project_id
                where l.entity_type = 'task' and l.changes ? 'column' and ${taskScope(p)}
              )
              select col as label, round((avg(extract(epoch from left_at - entered_at)) / 3600.0)::numeric, 1)::float8 as hours
              from moves
              where col is not null and ${inPeriod(sql`left_at`, p)}
              group by col order by hours desc limit 12`,
        ),
        rows<{ label: string; value: number }>(
          tx,
          sql`select to_char(date_trunc('week', t.completed_at at time zone 'America/Sao_Paulo'), 'DD/MM') as label,
                round((avg(extract(epoch from t.completed_at - t.created_at)) / 86400.0)::numeric, 1)::float8 as value
              from tasks t join projects pr on pr.id = t.project_id
              where ${taskScope(p)} and t.completed_at is not null and ${inPeriod(sql`t.completed_at`, p)}
              group by date_trunc('week', t.completed_at at time zone 'America/Sao_Paulo') order by 1`,
        ),
        rows<{ day: string; created: number; done: number }>(
          tx,
          sql`with days as (
                select generate_series(${p.from}::date, ${p.from}::date + ${days}::int, interval '1 day')::date as day)
              select to_char(d.day, 'DD/MM') as day,
                (select count(*)::int from tasks t join projects pr on pr.id = t.project_id
                  where ${taskScope(p)} and (t.created_at at time zone 'America/Sao_Paulo')::date <= d.day) as created,
                (select count(*)::int from tasks t join projects pr on pr.id = t.project_id
                  where ${taskScope(p)} and (t.completed_at at time zone 'America/Sao_Paulo')::date <= d.day) as done
              from days d order by d.day`,
        ),
        one<{ pct: number | null; total: number }>(
          tx,
          sql`select (100.0 * count(*) filter (where k.delivered_at <= k.sla_due_at) / nullif(count(*), 0))::float8 as pct,
                count(*)::int as total
              from tickets k join tasks t on t.id = k.task_id
              where ${ticketScope(p)} and k.sla_due_at is not null and k.delivered_at is not null
                and ${inPeriod(sql`k.delivered_at`, p)}`,
        ),
      ]);
      const result: FlowDashboardDto = {
        timeInColumn,
        leadTimeByWeek,
        cfd,
        slaMetPct: sla?.pct == null ? null : Math.round(sla.pct),
        slaTotal: sla?.total ?? 0,
      };
      return result;
    }),
  );

  // RF-10.11: clicar num indicador abre a lista que forma o número.
  app.get('/dashboards/drilldown', { schema: { querystring: drilldownQuery } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const q = request.query;
      assertAccess(viewer, q.departmentId);
      const ticketBase = sql`select coalesce(k.code, pr.key || '-' || t.number) as code, t.title,
            k.status::text as status, a.name as assignee, t.due_date::text as "dueDate"
          from tickets k join tasks t on t.id = k.task_id join projects pr on pr.id = t.project_id
          left join users a on a.id = t.assignee_id`;
      const taskBase = sql`select pr.key || '-' || t.number as code, t.title, c.name as status, a.name as assignee,
            t.due_date::text as "dueDate"
          from tasks t join projects pr on pr.id = t.project_id join board_columns c on c.id = t.column_id
          left join users a on a.id = t.assignee_id`;
      let query: SQL;
      switch (q.metric) {
        case 'tickets_opened':
          query = sql`${ticketBase} where ${ticketScope(q)} and ${inPeriod(sql`k.submitted_at`, q)} order by k.submitted_at desc`;
          break;
        case 'tickets_approved':
          query = sql`${ticketBase} where ${ticketScope(q)} and k.status = 'approved' and ${inPeriod(sql`k.approved_at`, q)} order by k.approved_at desc`;
          break;
        case 'flow':
          query = sql`${ticketBase} where ${inPeriod(sql`k.submitted_at`, q)}
            and k.requester_department_id = ${q.key ?? null}::uuid and k.target_department_id = ${q.key2 ?? null}::uuid
            order by k.submitted_at desc`;
          break;
        case 'overdue':
          query = sql`${taskBase} where ${taskScope(q)} and c.status_category <> 'done' and t.due_date < ${todayIso()}::date order by t.due_date`;
          break;
        case 'by_assignee':
          query = sql`${taskBase} where ${taskScope(q)} and c.status_category <> 'done' and t.assignee_id = ${q.key ?? null}::uuid
            and t.due_date between ${q.from}::date and ${q.to}::date order by t.due_date`;
          break;
        case 'open_by_status':
          query = sql`${taskBase} where ${taskScope(q)} and c.status_category = ${q.key ?? 'todo'}::status_category order by t.due_date nulls last`;
          break;
      }
      return rows<DrilldownItemDto>(tx, sql`${query} limit 200`);
    }),
  );
};
