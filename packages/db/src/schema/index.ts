import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  ATTACHMENT_PROVIDERS,
  CALENDAR_EVENT_KINDS,
  COMMENT_VISIBILITIES,
  DEPARTMENT_COLORS,
  PRIORITIES,
  PROJECT_KINDS,
  ROLES,
  STATUS_CATEGORIES,
  TICKET_STAGES,
  TICKET_STATUSES,
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  EPIC_STATUSES,
  RECURRENCE_FREQUENCIES,
  TASK_LINK_KINDS,
  type RichNode,
} from '@hub/shared';

// Modelo de dados da seção 13 (+ calendar_events da seção 14). As políticas RLS, funções e
// triggers ficam nas migrations SQL customizadas (migrations/*_security.sql).

export const userRole = pgEnum('user_role', ROLES);
export const priority = pgEnum('priority', PRIORITIES);
export const statusCategory = pgEnum('status_category', STATUS_CATEGORIES);
export const ticketStatus = pgEnum('ticket_status', TICKET_STATUSES);
export const ticketStage = pgEnum('ticket_stage', TICKET_STAGES);
export const projectKind = pgEnum('project_kind', PROJECT_KINDS);
export const commentVisibility = pgEnum('comment_visibility', COMMENT_VISIBILITIES);
export const departmentColor = pgEnum('department_color', DEPARTMENT_COLORS);
export const calendarEventKind = pgEnum('calendar_event_kind', CALENDAR_EVENT_KINDS);
export const attachmentProvider = pgEnum('attachment_provider', ATTACHMENT_PROVIDERS);
export const authTokenKind = pgEnum('auth_token_kind', ['invite', 'reset']);
export const taskLinkKind = pgEnum('task_link_kind', TASK_LINK_KINDS);
export const epicStatus = pgEnum('epic_status', EPIC_STATUSES);
export const recurrenceFrequency = pgEnum('recurrence_frequency', RECURRENCE_FREQUENCIES);
export const automationTrigger = pgEnum('automation_trigger', AUTOMATION_TRIGGERS);
export const automationAction = pgEnum('automation_action', AUTOMATION_ACTIONS);

const id = () => uuid('id').primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};
const day = (name: string) => date(name, { mode: 'string' });

export const users = pgTable(
  'users',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    jobTitle: text('job_title'),
    phone: text('phone'),
    avatarUrl: text('avatar_url'),
    role: userRole('role').notNull().default('colaborador'),
    seesAllDepartments: boolean('sees_all_departments').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: ts('last_login_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_key').on(sql`lower(${t.email})`),
    check('users_email_lower', sql`${t.email} = lower(${t.email})`),
  ],
);

/** Senha e bloqueio ficam fora de `users`: o papel da API não lê esta tabela diretamente. */
export const userCredentials = pgTable('user_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  passwordChangedAt: ts('password_changed_at'),
  ...timestamps,
});

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    remember: boolean('remember').notNull().default(false),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const authTokens = pgTable('auth_tokens', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  kind: authTokenKind('kind').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** RF-3.7: bloqueio por e-mail, inclusive para e-mails que não existem (não revela contas). */
export const authLockouts = pgTable('auth_lockouts', {
  email: text('email').primaryKey(),
  failedCount: integer('failed_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const departments = pgTable('departments', {
  id: id(),
  name: text('name').notNull(),
  acronym: text('acronym').notNull().unique(),
  color: departmentColor('color').notNull().default('navy'),
  description: text('description'),
  acceptsTickets: boolean('accepts_tickets').notNull().default(true),
  archivedAt: ts('archived_at'),
  ...timestamps,
});

export const departmentMembers = pgTable(
  'department_members',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    isManager: boolean('is_manager').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('department_members_user_dept_key').on(t.userId, t.departmentId),
    uniqueIndex('department_members_one_primary')
      .on(t.userId)
      .where(sql`${t.isPrimary}`),
    index('department_members_dept_idx').on(t.departmentId),
  ],
);

export const ticketTypes = pgTable('ticket_types', {
  id: id(),
  departmentId: uuid('department_id')
    .notNull()
    .references(() => departments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  defaultDueDays: integer('default_due_days'),
  /** SLA: horas para entregar (até "Aguardando aprovação"). Nulo = sem SLA. */
  slaHours: integer('sla_hours'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export const projects = pgTable(
  'projects',
  {
    id: id(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id),
    name: text('name').notNull(),
    key: text('key').notNull().unique(),
    kind: projectKind('kind').notNull().default('regular'),
    description: text('description'),
    startDate: day('start_date'),
    endDate: day('end_date'),
    nextTaskNumber: integer('next_task_number').notNull().default(1),
    archivedAt: ts('archived_at'),
    ...timestamps,
  },
  (t) => [
    index('projects_department_idx').on(t.departmentId),
    uniqueIndex('projects_one_tickets_board')
      .on(t.departmentId)
      .where(sql`${t.kind} = 'tickets'`),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const boardColumns = pgTable(
  'board_columns',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: text('position').notNull(),
    statusCategory: statusCategory('status_category').notNull(),
    wipLimit: integer('wip_limit'),
    /** Só no quadro "Chamados recebidos": etapa do fluxo que a coluna representa. */
    ticketStage: ticketStage('ticket_stage'),
    ...timestamps,
  },
  (t) => [index('board_columns_project_idx').on(t.projectId)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    columnId: uuid('column_id')
      .notNull()
      .references(() => boardColumns.id),
    // Preenchido pelo trigger app.tasks_before_insert (sequencial por projeto).
    number: integer('number').notNull().default(0),
    title: varchar('title', { length: 200 }).notNull(),
    description: jsonb('description').$type<RichNode>(),
    descriptionText: text('description_text').notNull().default(''),
    priority: priority('priority').notNull().default('medium'),
    assigneeId: uuid('assignee_id').references(() => users.id),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id),
    dueDate: day('due_date'),
    dueTime: time('due_time'),
    startDate: day('start_date'),
    estimate: numeric('estimate', { precision: 7, scale: 2, mode: 'number' }),
    position: text('position').notNull(),
    parentTaskId: uuid('parent_task_id'),
    epicId: uuid('epic_id'),
    /** Fica no backlog (fora do quadro) até ser enviada ao quadro. */
    inBacklog: boolean('in_backlog').notNull().default(false),
    isConfidential: boolean('is_confidential').notNull().default(false),
    /** Momento em que entrou numa coluna "concluído" (indicadores de prazo). */
    completedAt: ts('completed_at'),
    dueNotifiedAt: ts('due_notified_at'),
    overdueNotifiedAt: ts('overdue_notified_at'),
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tasks_project_number_key').on(t.projectId, t.number),
    index('tasks_column_position_idx').on(t.columnId, t.position),
    index('tasks_assignee_idx').on(t.assigneeId),
    index('tasks_due_idx').on(t.dueDate),
    index('tasks_parent_idx').on(t.parentTaskId),
    index('tasks_search_idx').using(
      'gin',
      sql`to_tsvector('portuguese'::regconfig, ${t.title} || ' ' || ${t.descriptionText})`,
    ),
  ],
);

export const taskWatchers = pgTable(
  'task_watchers',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] })],
);

export const labels = pgTable('labels', {
  id: id(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: departmentColor('color').notNull().default('navy'),
  ...timestamps,
});

export const taskLabels = pgTable(
  'task_labels',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] })],
);

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    code: text('code').notNull().unique(),
    taskId: uuid('task_id')
      .notNull()
      .unique()
      .references(() => tasks.id),
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id),
    requesterDepartmentId: uuid('requester_department_id')
      .notNull()
      .references(() => departments.id),
    targetDepartmentId: uuid('target_department_id')
      .notNull()
      .references(() => departments.id),
    approverId: uuid('approver_id').references(() => users.id),
    status: ticketStatus('status').notNull().default('open'),
    previousStatus: ticketStatus('previous_status'),
    revisionCount: integer('revision_count').notNull().default(0),
    desiredDueDate: day('desired_due_date'),
    submittedAt: ts('submitted_at').notNull().defaultNow(),
    deliveredAt: ts('delivered_at'),
    approvedAt: ts('approved_at'),
    closedAt: ts('closed_at'),
    /** Segundos acumulados em "Aguardando informações" (não contam no tempo de atendimento). */
    pausedSeconds: integer('paused_seconds').notNull().default(0),
    slaDueAt: ts('sla_due_at'),
    slaWarnedAt: ts('sla_warned_at'),
    slaBreachedAt: ts('sla_breached_at'),
    rating: integer('rating'),
    ratingComment: text('rating_comment'),
    ...timestamps,
  },
  (t) => [
    index('tickets_requester_idx').on(t.requesterId),
    index('tickets_target_idx').on(t.targetDepartmentId),
    index('tickets_requester_dept_idx').on(t.requesterDepartmentId),
    index('tickets_status_idx').on(t.status),
  ],
);

export const ticketEvents = pgTable(
  'ticket_events',
  {
    id: id(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id),
    fromStatus: ticketStatus('from_status'),
    toStatus: ticketStatus('to_status').notNull(),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('ticket_events_ticket_idx').on(t.ticketId, t.createdAt)],
);

export const comments = pgTable(
  'comments',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: jsonb('body').$type<RichNode>().notNull(),
    bodyText: text('body_text').notNull().default(''),
    visibility: commentVisibility('visibility').notNull().default('public'),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
    ...timestamps,
  },
  (t) => [index('comments_task_idx').on(t.taskId, t.createdAt)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    taskId: uuid('task_id').references(() => tasks.id),
    commentId: uuid('comment_id').references(() => comments.id),
    url: text('url').notNull(),
    provider: attachmentProvider('provider').notNull().default('gdrive'),
    driveFileId: text('drive_file_id'),
    fileId: uuid('file_id'),
    name: text('name'),
    mimeType: text('mime_type'),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('attachments_one_parent', sql`num_nonnulls(${t.taskId}, ${t.commentId}) = 1`),
    // Link do Google (RF-9.2) ou imagem enviada (arquivo em `files`).
    check(
      'attachments_source',
      sql`(${t.fileId} is null and ${t.url} ~ '^https://(drive|docs)\\.google\\.com/') or (${t.fileId} is not null and ${t.provider}::text = 'upload')`,
    ),
    index('attachments_task_idx').on(t.taskId),
    index('attachments_comment_idx').on(t.commentId),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    taskId: uuid('task_id').references(() => tasks.id),
    actorId: uuid('actor_id').references(() => users.id),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const notificationPrefs = pgTable(
  'notification_prefs',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventType] })],
);

export const activityLog = pgTable(
  'activity_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('activity_log_entity_idx').on(t.entityType, t.entityId, t.createdAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    target: text('target'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt)],
);

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: id(),
    title: text('title').notNull(),
    description: text('description'),
    /** Nulo = evento geral (aparece em todos os calendários). */
    departmentId: uuid('department_id').references(() => departments.id),
    startDate: day('start_date').notNull(),
    endDate: day('end_date').notNull(),
    allDay: boolean('all_day').notNull().default(true),
    kind: calendarEventKind('kind').notNull().default('event'),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    check('calendar_events_range', sql`${t.endDate} >= ${t.startDate}`),
    index('calendar_events_range_idx').on(t.startDate, t.endDate),
  ],
);

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: id(),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    template: text('template').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    sentAt: ts('sent_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('email_outbox_pending_idx').on(t.nextAttemptAt).where(sql`${t.sentAt} is null`)],
);

// ---------------------------------------------------------------------------
// Recursos de gestão de tarefas (fase pós-MVP): épicos, vínculos, filtros salvos, modelos,
// recorrência, automações e imagens enviadas.
// ---------------------------------------------------------------------------

/** Agrupador acima da tarefa (equivale ao épico do Jira). */
export const epics = pgTable(
  'epics',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    color: departmentColor('color').notNull().default('indigo'),
    status: epicStatus('status').notNull().default('open'),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [index('epics_project_idx').on(t.projectId)],
);

/** "bloqueia / é bloqueada por", "relacionada a", "duplicada de" (RF-6.6). */
export const taskLinks = pgTable(
  'task_links',
  {
    id: id(),
    sourceTaskId: uuid('source_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    targetTaskId: uuid('target_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: taskLinkKind('kind').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('task_links_unique').on(t.sourceTaskId, t.targetTaskId, t.kind),
    index('task_links_target_idx').on(t.targetTaskId),
    check('task_links_not_self', sql`${t.sourceTaskId} <> ${t.targetTaskId}`),
  ],
);

export const savedFilters = pgTable(
  'saved_filters',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull(),
    /** Visível para o departamento do projeto. */
    isShared: boolean('is_shared').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('saved_filters_project_idx').on(t.projectId)],
);

/** Modelos de tarefa por projeto (RF-6.8). */
export const taskTemplates = pgTable('task_templates', {
  id: id(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: jsonb('description').$type<RichNode>(),
  priority: priority('priority').notNull().default('medium'),
  createdBy: uuid('created_by').references(() => users.id),
  ...timestamps,
});

/** Tarefas recorrentes (RF-6.7): o worker cria a tarefa na data. */
export const taskRecurrences = pgTable('task_recurrences', {
  id: id(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull(),
  description: jsonb('description').$type<RichNode>(),
  priority: priority('priority').notNull().default('medium'),
  assigneeId: uuid('assignee_id').references(() => users.id),
  frequency: recurrenceFrequency('frequency').notNull(),
  /** Semanal: 1 = segunda ... 7 = domingo. */
  weekday: integer('weekday'),
  /** Mensal: dia do mês (1 a 28, para existir em todo mês). */
  monthDay: integer('month_day'),
  /** Prazo = data de criação + N dias. */
  dueOffsetDays: integer('due_offset_days').notNull().default(0),
  nextRunOn: day('next_run_on').notNull(),
  lastRunOn: day('last_run_on'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  ...timestamps,
});

/** Automação: quando <gatilho> então <ação>. */
export const automationRules = pgTable(
  'automation_rules',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    trigger: automationTrigger('trigger').notNull(),
    /** task_moved: coluna de destino. */
    columnId: uuid('column_id').references(() => boardColumns.id, { onDelete: 'cascade' }),
    /** task_created: só dispara para esta prioridade (nulo = qualquer). */
    triggerPriority: priority('trigger_priority'),
    action: automationAction('action').notNull(),
    actionUserId: uuid('action_user_id').references(() => users.id),
    actionPriority: priority('action_priority'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [index('automation_rules_project_idx').on(t.projectId)],
);

/** Imagens enviadas (prints colados em tarefas, chamados e comentários). */
export const files = pgTable(
  'files',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Caminho relativo no armazenamento (disco local ou bucket). */
    storageKey: text('storage_key').notNull().unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('files_task_idx').on(t.taskId)],
);
