// Códigos gravados no banco. Os rótulos em PT-BR ficam em labels.ts.

export const ROLES = ['admin', 'gestor', 'colaborador', 'observador'] as const;
export type Role = (typeof ROLES)[number];

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUS_CATEGORIES = ['todo', 'doing', 'done'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export const TICKET_STATUSES = [
  'open',
  'triage',
  'awaiting_info',
  'in_progress',
  'awaiting_approval',
  'returned',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const CLOSED_TICKET_STATUSES = ['approved', 'rejected', 'cancelled'] as const satisfies
  readonly TicketStatus[];

/** Coluna do quadro "Chamados recebidos" em que o chamado aparece (seção 7, Telas). */
export const TICKET_STAGES = ['new', 'triage', 'execution', 'approval', 'closed'] as const;
export type TicketStage = (typeof TICKET_STAGES)[number];

export const PROJECT_KINDS = ['regular', 'tickets'] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const COMMENT_VISIBILITIES = ['public', 'internal'] as const;
export type CommentVisibility = (typeof COMMENT_VISIBILITIES)[number];

export const CALENDAR_EVENT_KINDS = ['event', 'holiday', 'recess'] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

export const ATTACHMENT_PROVIDERS = ['gdrive', 'link', 'upload'] as const;
export type AttachmentProvider = (typeof ATTACHMENT_PROVIDERS)[number];

// Paleta fixa de departamentos (RNF-15.6): o admin escolhe uma chave, nunca um hex livre.
export const DEPARTMENT_COLORS = [
  'navy',
  'red',
  'indigo',
  'green',
  'amber',
  'slate',
  'wine',
  'teal',
] as const;
export type DepartmentColor = (typeof DEPARTMENT_COLORS)[number];

/** Eventos que geram notificação (RF-8.6). Os marcados em EMAIL_EVENTS também podem ir por e-mail. */
export const NOTIFICATION_TYPES = [
  'task_assigned',
  'mentioned',
  'task_commented',
  'ticket_opened',
  'ticket_status_changed',
  'ticket_awaiting_approval',
  'ticket_returned',
  'ticket_approved',
  'ticket_due_changed',
  'task_due_soon',
  'task_overdue',
  'automation',
  'ticket_sla_warning',
  'ticket_sla_breached',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** RF-8.8: eventos importantes que também vão por e-mail (o usuário pode desligar, RF-8.10). */
export const EMAIL_EVENTS = [
  'ticket_opened',
  'ticket_awaiting_approval',
  'ticket_returned',
  'ticket_approved',
  'task_assigned',
  'mentioned',
] as const satisfies readonly NotificationType[];
export type EmailEvent = (typeof EMAIL_EVENTS)[number];

export const TASK_LINK_KINDS = ['blocks', 'relates', 'duplicates'] as const;
export type TaskLinkKind = (typeof TASK_LINK_KINDS)[number];

export const EPIC_STATUSES = ['open', 'done'] as const;
export type EpicStatus = (typeof EPIC_STATUSES)[number];

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** Automações simples por projeto: um gatilho e uma ação. */
export const AUTOMATION_TRIGGERS = ['task_moved', 'task_created'] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_ACTIONS = [
  'notify_user',
  'notify_watchers',
  'notify_reporter',
  'assign_user',
  'set_priority',
] as const;
export type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];

export const SWIMLANES = ['none', 'assignee', 'priority', 'epic'] as const;
export type Swimlane = (typeof SWIMLANES)[number];

/** Imagens que podem ser enviadas (colar print, anexar). */
export const UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
