import { z } from 'zod';
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  EPIC_STATUSES,
  RECURRENCE_FREQUENCIES,
  TASK_LINK_KINDS,
  CALENDAR_EVENT_KINDS,
  COMMENT_VISIBILITIES,
  DEPARTMENT_COLORS,
  EMAIL_EVENTS,
  PRIORITIES,
  ROLES,
  STATUS_CATEGORIES,
  TICKET_STATUSES,
} from './enums';
import { richDocSchema } from './richtext';

// Validações de entrada compartilhadas: a mesma regra no formulário e na rota da API.

const msg = {
  required: 'Campo obrigatório.',
  email: 'Informe um e-mail válido.',
  date: 'Use o formato de data AAAA-MM-DD.',
};

export const uuid = z.uuid({ message: 'Identificador inválido.' });
export const isoDate = z.iso.date({ message: msg.date });
const optionalDate = isoDate.nullable().optional();
const trimmed = (max: number) => z.string().trim().min(1, msg.required).max(max, `Até ${max} caracteres.`);

/** RF-3.5: no mínimo 8 caracteres, com letras e números. */
export const passwordSchema = z
  .string()
  .min(8, 'A senha precisa ter pelo menos 8 caracteres.')
  .max(128, 'A senha pode ter até 128 caracteres.')
  .regex(/[A-Za-z]/, 'A senha precisa ter letras.')
  .regex(/\d/, 'A senha precisa ter números.');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email({ message: msg.email }));

// Autenticação --------------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, msg.required),
  remember: z.boolean().default(false),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, msg.required),
  newPassword: passwordSchema,
});

// Usuários e perfil ---------------------------------------------------------

export const userDepartmentSchema = z.object({
  departmentId: uuid,
  isPrimary: z.boolean().default(false),
  isManager: z.boolean().default(false),
});

export const createUserSchema = z.object({
  name: trimmed(120),
  email: emailSchema,
  jobTitle: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  avatarUrl: z.url({ protocol: /^https$/, message: 'Use um endereço https.' }).max(500).nullable().optional(),
  role: z.enum(ROLES),
  seesAllDepartments: z.boolean().default(false),
  departments: z
    .array(userDepartmentSchema)
    .min(1, 'Escolha pelo menos um departamento.')
    .refine((d) => d.filter((x) => x.isPrimary).length <= 1, 'Só um departamento principal.'),
});

export const updateUserSchema = createUserSchema.partial();

export const listUsersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  departmentId: uuid.optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateProfileSchema = z.object({
  phone: z.string().trim().max(40).nullable().optional(),
  avatarUrl: z.url({ protocol: /^https$/, message: 'Use um endereço https.' }).max(500).nullable().optional(),
});

export const notificationPrefsSchema = z.object({
  prefs: z.array(z.object({ eventType: z.enum(EMAIL_EVENTS), emailEnabled: z.boolean() })),
});

// Departamentos -------------------------------------------------------------

export const departmentSchema = z.object({
  name: trimmed(120),
  acronym: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Sigla com 2 a 10 letras ou números, começando por letra.'),
  color: z.enum(DEPARTMENT_COLORS),
  description: z.string().trim().max(1000).nullable().optional(),
  acceptsTickets: z.boolean().default(true),
});

export const updateDepartmentSchema = departmentSchema.partial();

export const addMemberSchema = z.object({
  userId: uuid,
  isManager: z.boolean().default(false),
  isPrimary: z.boolean().default(false),
});

export const ticketTypeSchema = z.object({
  name: trimmed(120),
  description: z.string().trim().max(1000).nullable().optional(),
  defaultDueDays: z.number().int().min(0).max(365).nullable().optional(),
  slaHours: z.number().int().min(1).max(2000).nullable().optional(),
  isActive: z.boolean().default(true),
});

// Projetos e quadro ---------------------------------------------------------

export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{0,9}(-[A-Z0-9]{1,10})?$/, 'Chave como TI ou MKT-EVT.');

export const projectSchema = z.object({
  departmentId: uuid,
  name: trimmed(120),
  key: projectKeySchema,
  description: z.string().trim().max(2000).nullable().optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  memberIds: z.array(uuid).default([]),
});

export const updateProjectSchema = projectSchema.omit({ departmentId: true, key: true }).partial();

export const columnSchema = z.object({
  name: trimmed(60),
  statusCategory: z.enum(STATUS_CATEGORIES),
  wipLimit: z.number().int().min(1).max(999).nullable().optional(),
});

export const updateColumnSchema = columnSchema.partial();

export const reorderColumnsSchema = z.object({ columnIds: z.array(uuid).min(1) });

export const deleteColumnSchema = z.object({ moveTasksTo: uuid.optional() });

export const labelSchema = z.object({
  name: trimmed(40),
  color: z.enum(DEPARTMENT_COLORS),
});

// Tarefas -------------------------------------------------------------------

const taskFields = {
  title: trimmed(200),
  description: richDocSchema.nullable().optional(),
  priority: z.enum(PRIORITIES).default('medium'),
  assigneeId: uuid.nullable().optional(),
  dueDate: optionalDate,
  dueTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Hora no formato HH:MM.')
    .nullable()
    .optional(),
  startDate: optionalDate,
  estimate: z.number().min(0).max(9999).nullable().optional(),
  labelIds: z.array(uuid).max(20).optional(),
  watcherIds: z.array(uuid).max(50).optional(),
  epicId: uuid.nullable().optional(),
  inBacklog: z.boolean().optional(),
};

export const createTaskSchema = z.object({
  projectId: uuid,
  columnId: uuid.optional(),
  parentTaskId: uuid.nullable().optional(),
  ...taskFields,
});

export const updateTaskSchema = z
  .object({ ...taskFields, columnId: uuid })
  .partial()
  .extend({
    /** RF-14.7: mudança de prazo de chamado recebido exige motivo. */
    dueChangeReason: z.string().trim().max(500).optional(),
  });

export const moveTaskSchema = z.object({
  columnId: uuid,
  /** Cartão que fica acima/abaixo após soltar; ambos nulos = fim da coluna. */
  beforeTaskId: uuid.nullable().optional(),
  afterTaskId: uuid.nullable().optional(),
});

export const moveTaskToProjectSchema = z.object({ projectId: uuid });

export const boardFiltersQuery = z.object({
  assigneeId: uuid.optional(),
  priority: z.enum(PRIORITIES).optional(),
  labelId: uuid.optional(),
  due: z.enum(['overdue', 'this_week']).optional(),
  q: z.string().trim().max(100).optional(),
  mine: z.coerce.boolean().optional(),
  epicId: uuid.optional(),
  /** true = lista do backlog; padrão = quadro. */
  backlog: z.coerce.boolean().optional(),
});

export const searchQuery = z.object({ q: z.string().trim().min(2).max(100) });

// Comentários e anexos --------------------------------------------------------

export const commentSchema = z.object({
  body: richDocSchema,
  visibility: z.enum(COMMENT_VISIBILITIES).default('public'),
});

export const updateCommentSchema = z.object({ body: richDocSchema });

export const attachmentSchema = z
  .object({
    taskId: uuid.optional(),
    commentId: uuid.optional(),
    url: z.string().trim().max(2000),
    name: z.string().trim().max(200).nullable().optional(),
  })
  .refine((a) => (a.taskId ? 1 : 0) + (a.commentId ? 1 : 0) === 1, {
    message: 'Informe a tarefa ou o comentário.',
  });

// Chamados ------------------------------------------------------------------

export const openTicketSchema = z.object({
  targetDepartmentId: uuid,
  ticketTypeId: uuid,
  title: trimmed(200),
  description: richDocSchema.nullable().optional(),
  priority: z.enum(PRIORITIES).default('medium'),
  desiredDueDate: optionalDate,
  approverId: uuid.nullable().optional(),
  attachments: z
    .array(z.object({ url: z.string().trim().max(2000), name: z.string().trim().max(200).nullable().optional() }))
    .max(20)
    .default([]),
});

export const ticketTransitionSchema = z.object({
  to: z.enum(TICKET_STATUSES),
  note: z.string().trim().max(5000).optional(),
});

export const ticketAssignSchema = z.object({ assigneeId: uuid });

export const myTicketsQuery = z.object({
  tab: z.enum(['opened', 'approval', 'closed']).default('opened'),
});

// Calendário ----------------------------------------------------------------

export const calendarQuery = z.object({
  from: isoDate,
  to: isoDate,
  departmentId: uuid.optional(),
});

export const calendarEventSchema = z
  .object({
    title: trimmed(160),
    description: z.string().trim().max(1000).nullable().optional(),
    departmentId: uuid.nullable().optional(),
    startDate: isoDate,
    endDate: isoDate,
    kind: z.enum(CALENDAR_EVENT_KINDS).default('event'),
  })
  .refine((e) => e.endDate >= e.startDate, {
    message: 'A data final não pode ser antes da inicial.',
    path: ['endDate'],
  });

// Dashboards ----------------------------------------------------------------

export const periodQuery = z.object({
  from: isoDate,
  to: isoDate,
  departmentId: uuid.optional(),
  projectId: uuid.optional(),
});

export const drilldownQuery = periodQuery.extend({
  metric: z.enum([
    'tickets_opened',
    'tickets_approved',
    'overdue',
    'open_by_status',
    'by_assignee',
    'flow',
  ]),
  key: z.string().max(100).optional(),
  key2: z.string().max(100).optional(),
});

// Recursos de gestão --------------------------------------------------------

/** Ações em massa: aplica a mesma mudança a vários cartões. */
export const bulkTaskSchema = z
  .object({
    taskIds: z.array(uuid).min(1, 'Selecione pelo menos uma tarefa.').max(200),
    columnId: uuid.optional(),
    assigneeId: uuid.nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
    epicId: uuid.nullable().optional(),
    inBacklog: z.boolean().optional(),
    delete: z.boolean().optional(),
  })
  .refine(
    (b) =>
      [b.columnId, b.assigneeId, b.priority, b.epicId, b.inBacklog, b.delete].some((v) => v !== undefined),
    { message: 'Escolha o que mudar.' },
  );

export const epicSchema = z.object({
  name: trimmed(120),
  description: z.string().trim().max(1000).nullable().optional(),
  color: z.enum(DEPARTMENT_COLORS).default('indigo'),
  status: z.enum(EPIC_STATUSES).default('open'),
});

export const taskLinkSchema = z.object({
  /** Código da outra tarefa (ex.: TI-42 ou CH-12). */
  targetCode: z.string().trim().min(3).max(40),
  kind: z.enum(TASK_LINK_KINDS),
});

export const savedFilterSchema = z.object({
  projectId: uuid.nullable().optional(),
  name: trimmed(60),
  filters: z.record(z.string(), z.union([z.string(), z.boolean()])),
  isShared: z.boolean().default(false),
});

export const taskTemplateSchema = z.object({
  name: trimmed(80),
  title: trimmed(200),
  description: richDocSchema.nullable().optional(),
  priority: z.enum(PRIORITIES).default('medium'),
});

export const recurrenceSchema = z
  .object({
    title: trimmed(200),
    description: richDocSchema.nullable().optional(),
    priority: z.enum(PRIORITIES).default('medium'),
    assigneeId: uuid.nullable().optional(),
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    weekday: z.number().int().min(1).max(7).nullable().optional(),
    monthDay: z.number().int().min(1, 'Dia de 1 a 28.').max(28, 'Dia de 1 a 28, para existir em todo mês.').nullable().optional(),
    dueOffsetDays: z.number().int().min(0).max(365).default(0),
    isActive: z.boolean().default(true),
  })
  .refine((r) => r.frequency !== 'weekly' || r.weekday != null, { message: 'Escolha o dia da semana.', path: ['weekday'] })
  .refine((r) => r.frequency !== 'monthly' || r.monthDay != null, { message: 'Escolha o dia do mês.', path: ['monthDay'] });

export const automationRuleSchema = z
  .object({
    name: trimmed(80),
    trigger: z.enum(AUTOMATION_TRIGGERS),
    columnId: uuid.nullable().optional(),
    triggerPriority: z.enum(PRIORITIES).nullable().optional(),
    action: z.enum(AUTOMATION_ACTIONS),
    actionUserId: uuid.nullable().optional(),
    actionPriority: z.enum(PRIORITIES).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((r) => r.trigger !== 'task_moved' || r.columnId, { message: 'Escolha a coluna.', path: ['columnId'] })
  .refine((r) => !['notify_user', 'assign_user'].includes(r.action) || r.actionUserId, {
    message: 'Escolha a pessoa.',
    path: ['actionUserId'],
  })
  .refine((r) => r.action !== 'set_priority' || r.actionPriority, { message: 'Escolha a prioridade.', path: ['actionPriority'] });

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type DepartmentInput = z.infer<typeof departmentSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type ColumnInput = z.infer<typeof columnSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type OpenTicketInput = z.infer<typeof openTicketSchema>;
export type CalendarEventInput = z.infer<typeof calendarEventSchema>;
