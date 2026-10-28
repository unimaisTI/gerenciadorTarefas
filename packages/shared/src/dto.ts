import type {
  AutomationAction,
  AutomationTrigger,
  EpicStatus,
  RecurrenceFrequency,
  TaskLinkKind,
  CalendarEventKind,
  CommentVisibility,
  DepartmentColor,
  NotificationType,
  Priority,
  ProjectKind,
  Role,
  StatusCategory,
  TicketStage,
  TicketStatus,
} from './enums';
import type { RichNode } from './richtext';
import type { DriveFileKind } from './attachments';

// Formatos de resposta da API. Datas puras como "AAAA-MM-DD"; instantes em ISO 8601.

export interface UserRef {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface MembershipDto {
  departmentId: string;
  departmentName: string;
  acronym: string;
  color: DepartmentColor;
  isPrimary: boolean;
  isManager: boolean;
}

export interface MeDto {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: Role;
  seesAllDepartments: boolean;
  memberships: MembershipDto[];
}

export interface UserDto extends MeDto {
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface DirectoryUserDto extends UserRef {
  jobTitle: string | null;
  departmentIds: string[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DepartmentDto {
  id: string;
  name: string;
  acronym: string;
  color: DepartmentColor;
  description: string | null;
  acceptsTickets: boolean;
  archivedAt: string | null;
  managers: UserRef[];
  memberCount: number;
}

export interface DepartmentMemberDto extends UserRef {
  email: string;
  role: Role;
  isManager: boolean;
  isPrimary: boolean;
  isActive: boolean;
}

export interface TicketTypeDto {
  id: string;
  departmentId: string;
  name: string;
  description: string | null;
  defaultDueDays: number | null;
  slaHours: number | null;
  isActive: boolean;
}

export interface ColumnDto {
  id: string;
  name: string;
  position: string;
  statusCategory: StatusCategory;
  wipLimit: number | null;
  ticketStage: TicketStage | null;
}

export interface LabelDto {
  id: string;
  name: string;
  color: DepartmentColor;
}

export interface ProjectDto {
  id: string;
  departmentId: string;
  departmentName: string;
  departmentColor: DepartmentColor;
  name: string;
  key: string;
  kind: ProjectKind;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  archivedAt: string | null;
  openTaskCount: number;
}

export interface ProjectDetailDto extends ProjectDto {
  columns: ColumnDto[];
  labels: LabelDto[];
  members: UserRef[];
  canManage: boolean;
  canEdit: boolean;
}

export interface TicketSummaryDto {
  id: string;
  code: string;
  status: TicketStatus;
  revisionCount: number;
  requesterDepartmentId: string;
  requesterDepartmentAcronym: string;
  slaDueAt: string | null;
}

export interface TaskCardDto {
  id: string;
  code: string;
  projectId: string;
  columnId: string;
  title: string;
  priority: Priority;
  assignee: UserRef | null;
  dueDate: string | null;
  dueTime: string | null;
  position: string;
  statusCategory: StatusCategory;
  labels: LabelDto[];
  commentCount: number;
  attachmentCount: number;
  subtaskTotal: number;
  subtaskDone: number;
  ticket: TicketSummaryDto | null;
  epic: { id: string; name: string; color: DepartmentColor } | null;
  /** Tem bloqueio ainda aberto ("é bloqueada por" tarefa não concluída). */
  blocked: boolean;
  inBacklog: boolean;
}

export interface AttachmentDto {
  id: string;
  url: string;
  name: string | null;
  kind: DriveFileKind;
  addedBy: UserRef;
  createdAt: string;
}

export interface SubtaskDto {
  id: string;
  code: string;
  title: string;
  columnId: string;
  statusCategory: StatusCategory;
  assignee: UserRef | null;
}

export interface TicketDetailDto {
  id: string;
  code: string;
  status: TicketStatus;
  previousStatus: TicketStatus | null;
  revisionCount: number;
  ticketType: { id: string; name: string };
  requester: UserRef;
  requesterDepartment: { id: string; name: string; acronym: string };
  targetDepartment: { id: string; name: string; acronym: string };
  approver: UserRef | null;
  desiredDueDate: string | null;
  submittedAt: string;
  deliveredAt: string | null;
  approvedAt: string | null;
  closedAt: string | null;
  slaDueAt: string | null;
  slaBreached: boolean;
  /** Lado do usuário: executor (membro do departamento de destino) ou solicitante. */
  viewerSide: 'executor' | 'requester';
  /** Transições que o usuário atual pode executar. */
  allowedTransitions: { to: TicketStatus; requiresNote: boolean }[];
  canAssign: boolean;
  events: TicketEventDto[];
}

export interface TicketEventDto {
  id: string;
  actor: UserRef | null;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  note: string | null;
  createdAt: string;
}

export interface TaskDetailDto extends TaskCardDto {
  description: RichNode | null;
  startDate: string | null;
  estimate: number | null;
  reporter: UserRef;
  watchers: UserRef[];
  isWatching: boolean;
  parentTask: { id: string; code: string; title: string } | null;
  subtasks: SubtaskDto[];
  attachments: AttachmentDto[];
  project: { id: string; name: string; key: string; kind: ProjectKind; departmentId: string };
  columns: ColumnDto[];
  labelsAvailable: LabelDto[];
  epicsAvailable: { id: string; name: string; color: DepartmentColor }[];
  links: TaskLinkDto[];
  /** Tempo acumulado em cada coluna (horas), a partir do histórico. */
  columnTimes: { column: string; hours: number }[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
  canComment: boolean;
  ticketDetail: TicketDetailDto | null;
}

export interface CommentDto {
  id: string;
  author: UserRef;
  body: RichNode;
  visibility: CommentVisibility;
  editedAt: string | null;
  createdAt: string;
  attachments: AttachmentDto[];
  canEdit: boolean;
}

export interface ActivityDto {
  id: string;
  actor: UserRef | null;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  actor: UserRef | null;
  taskCode: string | null;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface MyTaskDto extends TaskCardDto {
  projectName: string;
  departmentAcronym: string;
}

export interface TicketListItemDto {
  id: string;
  code: string;
  taskCode: string;
  title: string;
  status: TicketStatus;
  priority: Priority;
  revisionCount: number;
  targetDepartment: { id: string; acronym: string; name: string };
  requesterDepartment: { id: string; acronym: string; name: string };
  requester: UserRef;
  assignee: UserRef | null;
  desiredDueDate: string | null;
  dueDate: string | null;
  submittedAt: string;
  updatedAt: string;
}

export interface SearchResultDto {
  id: string;
  code: string;
  title: string;
  projectName: string;
  snippet: string | null;
}

export interface CalendarItemDto {
  id: string;
  kind: 'task' | 'ticket_received' | 'ticket_sent' | 'event';
  title: string;
  code: string | null;
  start: string;
  end: string | null;
  departmentId: string | null;
  departmentColor: DepartmentColor | null;
  departmentAcronym: string | null;
  projectId: string | null;
  assigneeId: string | null;
  priority: Priority | null;
  eventKind: CalendarEventKind | null;
  overdue: boolean;
  done: boolean;
  canDrag: boolean;
}

export interface CalendarEventDto {
  id: string;
  title: string;
  description: string | null;
  departmentId: string | null;
  startDate: string;
  endDate: string;
  kind: CalendarEventKind;
}

export interface HomeDashboardDto {
  today: MyTaskDto[];
  overdue: MyTaskDto[];
  awaitingMyApproval: TicketListItemDto[];
  notifications: NotificationDto[];
}

export interface MetricDto {
  value: number;
  previous: number | null;
}

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface DashboardDto {
  period: { from: string; to: string; previousFrom: string; previousTo: string };
  ticketsOpened: MetricDto;
  ticketsApproved: MetricDto;
  avgResolutionDays: MetricDto;
  firstPassApprovalPct: MetricDto;
  avgReturnsPerTicket: MetricDto;
  overdueNow: number;
  dueNext7Days: number;
  onTimeByDepartment: { departmentId: string; label: string; color: DepartmentColor; pct: number; total: number }[];
  openedVsDone: { week: string; opened: number; done: number }[];
  resolutionByWeek: SeriesPoint[];
  flowMatrix: { departments: { id: string; acronym: string }[]; counts: number[][] };
  pendingByStatus: SeriesPoint[];
  loadByAssignee: { userId: string; label: string; value: number }[];
  ticketsByType: SeriesPoint[];
  openByStatus: SeriesPoint[];
  ticketsReceived: MetricDto;
  ticketsSent: MetricDto;
  generatedAt: string;
}

export interface DrilldownItemDto {
  code: string;
  title: string;
  status: string;
  assignee: string | null;
  dueDate: string | null;
}

export interface AuditEntryDto {
  id: string;
  actor: UserRef | null;
  action: string;
  target: string | null;
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface TrashItemDto {
  id: string;
  code: string;
  title: string;
  projectName: string;
  deletedAt: string;
  deletedBy: UserRef | null;
}

export interface DeactivateResultDto {
  openTasks: { id: string; code: string; title: string; projectName: string }[];
}

export interface TaskLinkDto {
  id: string;
  kind: TaskLinkKind;
  /** outgoing: esta tarefa é a origem (ex.: "bloqueia"); incoming: é o destino. */
  direction: 'outgoing' | 'incoming';
  task: { id: string; code: string; title: string; done: boolean };
}

export interface EpicDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  color: DepartmentColor;
  status: EpicStatus;
  taskCount: number;
  doneCount: number;
}

export interface SavedFilterDto {
  id: string;
  projectId: string | null;
  name: string;
  filters: Record<string, string | boolean>;
  isShared: boolean;
  isMine: boolean;
}

export interface TaskTemplateDto {
  id: string;
  projectId: string;
  name: string;
  title: string;
  description: RichNode | null;
  priority: Priority;
}

export interface RecurrenceDto {
  id: string;
  projectId: string;
  title: string;
  description: RichNode | null;
  priority: Priority;
  assignee: UserRef | null;
  frequency: RecurrenceFrequency;
  weekday: number | null;
  monthDay: number | null;
  dueOffsetDays: number;
  nextRunOn: string;
  lastRunOn: string | null;
  isActive: boolean;
}

export interface AutomationRuleDto {
  id: string;
  projectId: string;
  name: string;
  trigger: AutomationTrigger;
  columnId: string | null;
  triggerPriority: Priority | null;
  action: AutomationAction;
  actionUser: UserRef | null;
  actionPriority: Priority | null;
  isActive: boolean;
}

export interface UploadedFileDto {
  id: string;
  url: string;
  name: string;
}

/** Aba "Fluxo" dos Dashboards. */
export interface FlowDashboardDto {
  /** Horas médias que as tarefas passam em cada coluna (gargalos). */
  timeInColumn: { label: string; hours: number }[];
  /** Lead time médio (criação → conclusão), em dias, por semana de conclusão. */
  leadTimeByWeek: SeriesPoint[];
  /** Fluxo acumulado: tarefas criadas e concluídas até cada dia (a distância entre as linhas é o estoque aberto). */
  cfd: { day: string; created: number; done: number }[];
  /** % de chamados com SLA entregues no prazo. */
  slaMetPct: number | null;
  slaTotal: number;
}
