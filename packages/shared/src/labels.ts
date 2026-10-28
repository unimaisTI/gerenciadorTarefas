import type {
  AutomationAction,
  AutomationTrigger,
  RecurrenceFrequency,
  Swimlane,
  TaskLinkKind,
  CalendarEventKind,
  DepartmentColor,
  NotificationType,
  Priority,
  Role,
  StatusCategory,
  TicketStage,
  TicketStatus,
} from './enums';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  colaborador: 'Colaborador',
  observador: 'Observador',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};

export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
  todo: 'A fazer',
  doing: 'Em andamento',
  done: 'Concluído',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Aberto',
  triage: 'Em triagem',
  awaiting_info: 'Aguardando informações',
  in_progress: 'Em execução',
  awaiting_approval: 'Aguardando aprovação',
  returned: 'Devolvido',
  approved: 'Aprovado',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
};

export const TICKET_STAGE_LABELS: Record<TicketStage, string> = {
  new: 'Novos',
  triage: 'Em triagem',
  execution: 'Em execução',
  approval: 'Aguardando aprovação',
  closed: 'Encerrados',
};

/** Rótulo do botão que leva o chamado ao status. */
export const TICKET_ACTION_LABELS: Record<TicketStatus, string> = {
  open: 'Reabrir',
  triage: 'Iniciar triagem',
  awaiting_info: 'Pedir informações',
  in_progress: 'Iniciar execução',
  awaiting_approval: 'Marcar como entregue',
  returned: 'Devolver',
  approved: 'Aprovar',
  rejected: 'Recusar',
  cancelled: 'Cancelar chamado',
};

export const DEPARTMENT_COLOR_LABELS: Record<DepartmentColor, string> = {
  navy: 'Azul UNIMAIS',
  red: 'Vermelho',
  indigo: 'Índigo',
  green: 'Verde',
  amber: 'Âmbar',
  slate: 'Grafite',
  wine: 'Vinho',
  teal: 'Azul-petróleo',
};

export const CALENDAR_EVENT_KIND_LABELS: Record<CalendarEventKind, string> = {
  event: 'Evento',
  holiday: 'Feriado',
  recess: 'Recesso',
};

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  task_assigned: 'Tarefa atribuída a mim',
  mentioned: 'Menção em comentário',
  task_commented: 'Comentário em tarefa que sigo',
  ticket_opened: 'Novo chamado para o meu departamento',
  ticket_status_changed: 'Mudança de status de chamado meu',
  ticket_awaiting_approval: 'Chamado aguardando minha aprovação',
  ticket_returned: 'Chamado devolvido',
  ticket_approved: 'Chamado aprovado',
  ticket_due_changed: 'Prazo de chamado alterado',
  task_due_soon: 'Prazo vencendo em 24 horas',
  task_overdue: 'Tarefa atrasada',
  automation: 'Aviso de automação',
  ticket_sla_warning: 'SLA de chamado perto de estourar',
  ticket_sla_breached: 'SLA de chamado estourado',
};

/** Como o vínculo aparece em cada ponta: [na origem, no destino]. */
export const TASK_LINK_LABELS: Record<TaskLinkKind, [string, string]> = {
  blocks: ['bloqueia', 'é bloqueada por'],
  relates: ['relacionada a', 'relacionada a'],
  duplicates: ['duplica', 'é duplicada por'],
};

export const RECURRENCE_FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  daily: 'Todo dia',
  weekly: 'Toda semana',
  monthly: 'Todo mês',
};

export const WEEKDAY_LABELS = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'] as const;

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  task_moved: 'Quando a tarefa entrar na coluna',
  task_created: 'Quando uma tarefa for criada',
};

export const AUTOMATION_ACTION_LABELS: Record<AutomationAction, string> = {
  notify_user: 'Avisar uma pessoa',
  notify_watchers: 'Avisar os participantes',
  notify_reporter: 'Avisar quem criou',
  assign_user: 'Atribuir a uma pessoa',
  set_priority: 'Mudar a prioridade',
};

export const SWIMLANE_LABELS: Record<Swimlane, string> = {
  none: 'Sem raias',
  assignee: 'Por responsável',
  priority: 'Por prioridade',
  epic: 'Por épico',
};
