import { sql, type SQL } from 'drizzle-orm';
import type { Executor } from '@hub/db';
import {
  availableTransitions,
  isAdmin,
  isManagerOf,
  permissions,
  type ActivityDto,
  type AttachmentDto,
  type ColumnDto,
  type LabelDto,
  type MyTaskDto,
  type SubtaskDto,
  type TaskCardDto,
  type TaskDetailDto,
  type TaskLinkDto,
  type TicketDetailDto,
  type TicketEventDto,
  type UserRef,
  type Viewer,
} from '@hub/shared';
import { one, rows } from '../../lib/sql';

export const userRef = (alias: string) =>
  sql.raw(`case when ${alias}.id is null then null else json_build_object('id', ${alias}.id, 'name', ${alias}.name, 'avatarUrl', ${alias}.avatar_url) end`);

/** Colunas do cartão do quadro (RF-5.8). Espera os aliases t, p, c, a, k, rd. */
export const CARD_COLUMNS = sql`
  t.id, p.key || '-' || t.number as code, t.project_id as "projectId", t.column_id as "columnId",
  t.title, t.priority, ${userRef('a')} as assignee,
  t.due_date::text as "dueDate", to_char(t.due_time, 'HH24:MI') as "dueTime",
  t.position, c.status_category as "statusCategory",
  coalesce((select json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color) order by l.name)
            from task_labels tl join labels l on l.id = tl.label_id where tl.task_id = t.id), '[]') as labels,
  (select count(*)::int from comments cm where cm.task_id = t.id and cm.deleted_at is null) as "commentCount",
  (select count(*)::int from attachments at where at.task_id = t.id) as "attachmentCount",
  (select count(*)::int from tasks s where s.parent_task_id = t.id and s.deleted_at is null) as "subtaskTotal",
  (select count(*)::int from tasks s where s.parent_task_id = t.id and s.deleted_at is null
     and s.completed_at is not null) as "subtaskDone",
  case when k.id is null then null else json_build_object(
    'id', k.id, 'code', k.code, 'status', k.status, 'revisionCount', k.revision_count,
    'requesterDepartmentId', k.requester_department_id, 'requesterDepartmentAcronym', rd.acronym,
    'slaDueAt', app.iso(k.sla_due_at)) end as ticket,
  (select json_build_object('id', e.id, 'name', e.name, 'color', e.color) from epics e where e.id = t.epic_id) as epic,
  exists (select 1 from task_links lk join tasks b on b.id = lk.source_task_id
          join board_columns bc on bc.id = b.column_id
          where lk.target_task_id = t.id and lk.kind = 'blocks' and b.deleted_at is null
            and bc.status_category <> 'done') as blocked,
  t.in_backlog as "inBacklog"`;

export const CARD_FROM = sql`
  tasks t
  join projects p on p.id = t.project_id
  join board_columns c on c.id = t.column_id
  left join users a on a.id = t.assignee_id
  left join tickets k on k.task_id = t.id
  left join departments rd on rd.id = k.requester_department_id`;

export function getCards(tx: Executor, where: SQL, order: SQL = sql`t.position`) {
  return rows<TaskCardDto>(tx, sql`select ${CARD_COLUMNS} from ${CARD_FROM} where ${where} order by ${order}`);
}

export function getMyTaskCards(tx: Executor, where: SQL) {
  return rows<MyTaskDto>(
    tx,
    sql`select ${CARD_COLUMNS}, p.name as "projectName", d.acronym as "departmentAcronym"
        from ${CARD_FROM} join departments d on d.id = p.department_id
        where ${where}
        order by t.due_date nulls last, t.priority desc`,
  );
}

/** Aceita o código da tarefa (TI-42, TI-CH-3) ou do chamado (CH-128). */
export async function resolveTaskId(tx: Executor, code: string): Promise<string | undefined> {
  const upper = code.toUpperCase();
  if (/^CH-\d+$/.test(upper)) {
    const row = await one<{ id: string }>(tx, sql`select task_id as id from tickets where code = ${upper}`);
    if (row) return row.id;
  }
  const m = /^(.+)-(\d+)$/.exec(upper);
  if (!m?.[1] || !m[2]) return undefined;
  const row = await one<{ id: string }>(
    tx,
    sql`select t.id from tasks t join projects p on p.id = t.project_id
        where p.key = ${m[1]} and t.number = ${Number(m[2])}`,
  );
  return row?.id;
}

export async function taskDepartment(tx: Executor, taskId: string) {
  return one<{ departmentId: string; projectId: string; kind: 'regular' | 'tickets'; reporterId: string; isTicket: boolean; assigneeId: string | null }>(
    tx,
    sql`select p.department_id as "departmentId", p.id as "projectId", p.kind, t.reporter_id as "reporterId",
          t.assignee_id as "assigneeId",
          exists (select 1 from tickets k where k.task_id = t.id) as "isTicket"
        from tasks t join projects p on p.id = t.project_id where t.id = ${taskId}`,
  );
}

export async function getTicketDetail(
  tx: Executor,
  viewer: Viewer,
  taskId: string,
  assigneeId: string | null,
): Promise<TicketDetailDto | null> {
  const k = await one<
    Omit<TicketDetailDto, 'viewerSide' | 'allowedTransitions' | 'canAssign' | 'events'> & {
      approverId: string | null;
      requesterId: string;
    }
  >(
    tx,
    sql`select k.id, k.code, k.status, k.previous_status as "previousStatus", k.revision_count as "revisionCount",
          json_build_object('id', tt.id, 'name', tt.name) as "ticketType",
          ${userRef('r')} as requester, k.requester_id as "requesterId",
          json_build_object('id', rd.id, 'name', rd.name, 'acronym', rd.acronym) as "requesterDepartment",
          json_build_object('id', td.id, 'name', td.name, 'acronym', td.acronym) as "targetDepartment",
          ${userRef('ap')} as approver, k.approver_id as "approverId",
          k.desired_due_date::text as "desiredDueDate", app.iso(k.submitted_at) as "submittedAt",
          app.iso(k.delivered_at) as "deliveredAt", app.iso(k.approved_at) as "approvedAt",
          app.iso(k.closed_at) as "closedAt", app.iso(k.sla_due_at) as "slaDueAt",
          (k.sla_due_at is not null and coalesce(k.delivered_at, now()) > k.sla_due_at) as "slaBreached"
        from tickets k
        join ticket_types tt on tt.id = k.ticket_type_id
        join users r on r.id = k.requester_id
        left join users ap on ap.id = k.approver_id
        join departments rd on rd.id = k.requester_department_id
        join departments td on td.id = k.target_department_id
        where k.task_id = ${taskId}`,
  );
  if (!k) return null;

  const events = await rows<TicketEventDto>(
    tx,
    sql`select e.id, ${userRef('u')} as actor, e.from_status as "fromStatus", e.to_status as "toStatus",
          e.note, app.iso(e.created_at) as "createdAt"
        from ticket_events e left join users u on u.id = e.actor_id
        where e.ticket_id = ${k.id} order by e.created_at`,
  );

  const ctx = {
    isAdmin: isAdmin(viewer),
    isExecutorManager: isManagerOf(viewer, k.targetDepartment.id),
    isAssignee: assigneeId === viewer.id,
    isRequesterSide:
      k.requesterId === viewer.id || k.approverId === viewer.id || isManagerOf(viewer, k.requesterDepartment.id),
  };
  const canAct = viewer.role !== 'observador';
  const { approverId: _a, requesterId: _r, ...rest } = k;
  return {
    ...rest,
    viewerSide: viewer.departmentIds.includes(k.targetDepartment.id) || isAdmin(viewer) ? 'executor' : 'requester',
    allowedTransitions: canAct
      ? availableTransitions(
          { status: k.status, previousStatus: k.previousStatus, hasAssignee: assigneeId !== null },
          ctx,
        ).map((t) => ({ to: t.to, requiresNote: t.requiresNote }))
      : [],
    canAssign: canAct && permissions.assignTicket(viewer, k.targetDepartment.id) && !['approved', 'rejected', 'cancelled'].includes(k.status),
    events,
  };
}

export const ATTACHMENT_COLUMNS = sql`
  at.id, at.url, at.name,
  coalesce(at.mime_type, 'file') as kind,
  ${userRef('au')} as "addedBy", app.iso(at.created_at) as "createdAt"`;

export async function getTaskDetail(
  tx: Executor,
  viewer: Viewer,
  taskId: string,
): Promise<TaskDetailDto | undefined> {
  const base = await one<
    TaskCardDto & {
      description: TaskDetailDto['description'];
      startDate: string | null;
      estimate: number | null;
      reporter: UserRef;
      parentTask: TaskDetailDto['parentTask'];
      project: TaskDetailDto['project'];
      createdAt: string;
      updatedAt: string;
      deletedAt: string | null;
      reporterId: string;
      assigneeId: string | null;
    }
  >(
    tx,
    sql`select ${CARD_COLUMNS}, t.description, t.start_date::text as "startDate", t.estimate::float8 as estimate,
          ${userRef('rp')} as reporter, t.reporter_id as "reporterId", t.assignee_id as "assigneeId",
          case when pt.id is null then null else json_build_object(
            'id', pt.id, 'code', p.key || '-' || pt.number, 'title', pt.title) end as "parentTask",
          json_build_object('id', p.id, 'name', p.name, 'key', p.key, 'kind', p.kind, 'departmentId', p.department_id) as project,
          app.iso(t.created_at) as "createdAt", app.iso(t.updated_at) as "updatedAt", app.iso(t.deleted_at) as "deletedAt"
        from ${CARD_FROM}
        join users rp on rp.id = t.reporter_id
        left join tasks pt on pt.id = t.parent_task_id
        where t.id = ${taskId}`,
  );
  if (!base) return undefined;

  const [watchers, subtasks, attachments, columns, labelsAvailable, ticketDetail, epicsAvailable, links, columnTimes] = await Promise.all([
    rows<UserRef>(
      tx,
      sql`select u.id, u.name, u.avatar_url as "avatarUrl" from task_watchers w join users u on u.id = w.user_id
          where w.task_id = ${taskId} order by u.name`,
    ),
    rows<SubtaskDto>(
      tx,
      sql`select s.id, p.key || '-' || s.number as code, s.title, s.column_id as "columnId",
            c.status_category as "statusCategory", ${userRef('a')} as assignee
          from tasks s join projects p on p.id = s.project_id join board_columns c on c.id = s.column_id
          left join users a on a.id = s.assignee_id
          where s.parent_task_id = ${taskId} and s.deleted_at is null order by s.created_at`,
    ),
    rows<AttachmentDto>(
      tx,
      sql`select ${ATTACHMENT_COLUMNS} from attachments at join users au on au.id = at.added_by
          where at.task_id = ${taskId} order by at.created_at`,
    ),
    rows<ColumnDto>(
      tx,
      sql`select id, name, position, status_category as "statusCategory", wip_limit as "wipLimit",
            ticket_stage as "ticketStage"
          from board_columns where project_id = ${base.projectId} order by position`,
    ),
    rows<LabelDto>(
      tx,
      sql`select id, name, color from labels where project_id = ${base.projectId} order by name`,
    ),
    getTicketDetail(tx, viewer, taskId, base.assigneeId),
    rows<TaskDetailDto['epicsAvailable'][number]>(
      tx,
      sql`select id, name, color from epics where project_id = ${base.projectId} and status = 'open' order by name`,
    ),
    rows<TaskLinkDto>(
      tx,
      sql`select lk.id, lk.kind,
            case when lk.source_task_id = ${taskId} then 'outgoing' else 'incoming' end as direction,
            json_build_object('id', o.id, 'code', p.key || '-' || o.number, 'title', o.title,
                              'done', c.status_category = 'done') as task
          from task_links lk
          join tasks o on o.id = case when lk.source_task_id = ${taskId} then lk.target_task_id else lk.source_task_id end
          join projects p on p.id = o.project_id
          join board_columns c on c.id = o.column_id
          where (lk.source_task_id = ${taskId} or lk.target_task_id = ${taskId}) and o.deleted_at is null
          order by lk.created_at`,
    ),
    getColumnTimes(tx, taskId),
  ]);

  const deptId = base.project.departmentId;
  const { reporterId, assigneeId: _assigneeId, ...card } = base;
  const canEdit = permissions.editTasks(viewer, deptId) && !base.deletedAt;
  return {
    ...card,
    watchers,
    isWatching: watchers.some((w) => w.id === viewer.id),
    subtasks,
    attachments,
    columns,
    labelsAvailable,
    epicsAvailable,
    links,
    columnTimes,
    canEdit,
    canDelete: !ticketDetail && !base.deletedAt && permissions.deleteTask(viewer, deptId, reporterId),
    canComment: permissions.comment(viewer) && !base.deletedAt,
    ticketDetail,
  };
}

/**
 * Tempo em cada coluna a partir do histórico (RF-11.1): cada mudança de coluna fecha um trecho.
 * O trecho da coluna atual conta até agora, salvo se ela for "concluído".
 */
export async function getColumnTimes(tx: Executor, taskId: string): Promise<{ column: string; hours: number }[]> {
  const info = await one<{ createdAt: string; current: string; done: boolean }>(
    tx,
    sql`select app.iso(t.created_at) as "createdAt", c.name as current, c.status_category = 'done' as done
        from tasks t join board_columns c on c.id = t.column_id where t.id = ${taskId}`,
  );
  if (!info) return [];
  const moves = await rows<{ from: string | null; to: string | null; at: string }>(
    tx,
    sql`select changes->'column'->>'from' as "from", changes->'column'->>'to' as "to", app.iso(created_at) as at
        from activity_log where entity_type = 'task' and entity_id = ${taskId} and changes ? 'column'
        order by created_at`,
  );
  const totals = new Map<string, number>();
  const add = (column: string | null, from: string, to: number) => {
    if (!column) return;
    totals.set(column, (totals.get(column) ?? 0) + Math.max(0, to - Date.parse(from)));
  };
  let column = moves[0]?.from ?? info.current;
  let since = info.createdAt;
  for (const m of moves) {
    add(column, since, Date.parse(m.at));
    column = m.to ?? column;
    since = m.at;
  }
  if (!info.done) add(column, since, Date.now());
  return [...totals.entries()].map(([name, ms]) => ({ column: name, hours: Math.round((ms / 3_600_000) * 10) / 10 }));
}

export function getHistory(tx: Executor, taskId: string) {
  return rows<ActivityDto>(
    tx,
    sql`select l.id::text, ${userRef('u')} as actor, l.action, l.changes, app.iso(l.created_at) as "createdAt"
        from activity_log l left join users u on u.id = l.actor_id
        where l.entity_type = 'task' and l.entity_id = ${taskId}
        order by l.created_at desc limit 200`,
  );
}
