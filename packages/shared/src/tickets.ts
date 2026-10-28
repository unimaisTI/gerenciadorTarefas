import type { TicketStage, TicketStatus } from './enums';

/**
 * Quem pode agir num chamado:
 * - executor_manager: gestor do departamento executor (ou admin)
 * - assignee: responsável atribuído (tarefa do chamado no quadro do executor)
 * - requester_side: solicitante original, gestor do departamento solicitante ou aprovador indicado
 */
export type TicketActor = 'executor_manager' | 'assignee' | 'requester_side';

export interface TicketTransition {
  from: TicketStatus;
  to: TicketStatus;
  actors: readonly TicketActor[];
  /** Motivo/comentário obrigatório (recusa, devolução, entrega, pedido de informação). */
  requiresNote: boolean;
  /** Só com responsável atribuído. */
  requiresAssignee?: boolean;
  /** Saída de "Aguardando informações": só volta para o status de onde veio. */
  onlyToPrevious?: boolean;
}

/**
 * Espelho da máquina de estados. A autoridade é a função SQL app.ticket_transition
 * (packages/db/migrations); o teste transitions.sql.test.ts garante que as duas batem.
 */
export const TICKET_TRANSITIONS: readonly TicketTransition[] = [
  { from: 'open', to: 'triage', actors: ['executor_manager'], requiresNote: false },
  {
    from: 'open',
    to: 'in_progress',
    actors: ['executor_manager'],
    requiresNote: false,
    requiresAssignee: true,
  },
  {
    from: 'triage',
    to: 'in_progress',
    actors: ['executor_manager'],
    requiresNote: false,
    requiresAssignee: true,
  },
  { from: 'open', to: 'rejected', actors: ['executor_manager'], requiresNote: true },
  { from: 'triage', to: 'rejected', actors: ['executor_manager'], requiresNote: true },
  {
    from: 'triage',
    to: 'awaiting_info',
    actors: ['executor_manager', 'assignee'],
    requiresNote: true,
  },
  {
    from: 'in_progress',
    to: 'awaiting_info',
    actors: ['executor_manager', 'assignee'],
    requiresNote: true,
  },
  {
    from: 'awaiting_info',
    to: 'triage',
    actors: ['requester_side'],
    requiresNote: true,
    onlyToPrevious: true,
  },
  {
    from: 'awaiting_info',
    to: 'in_progress',
    actors: ['requester_side'],
    requiresNote: true,
    onlyToPrevious: true,
  },
  {
    from: 'in_progress',
    to: 'awaiting_approval',
    actors: ['assignee', 'executor_manager'],
    requiresNote: true,
  },
  {
    from: 'returned',
    to: 'awaiting_approval',
    actors: ['assignee', 'executor_manager'],
    requiresNote: true,
  },
  { from: 'returned', to: 'in_progress', actors: ['assignee', 'executor_manager'], requiresNote: false },
  { from: 'awaiting_approval', to: 'approved', actors: ['requester_side'], requiresNote: false },
  { from: 'awaiting_approval', to: 'returned', actors: ['requester_side'], requiresNote: true },
  { from: 'open', to: 'cancelled', actors: ['requester_side'], requiresNote: false },
  { from: 'triage', to: 'cancelled', actors: ['requester_side'], requiresNote: false },
  { from: 'awaiting_info', to: 'cancelled', actors: ['requester_side'], requiresNote: false },
  { from: 'in_progress', to: 'cancelled', actors: ['requester_side'], requiresNote: false },
  { from: 'returned', to: 'cancelled', actors: ['requester_side'], requiresNote: false },
];

export interface TicketActorContext {
  isAdmin: boolean;
  isExecutorManager: boolean;
  isAssignee: boolean;
  isRequesterSide: boolean;
}

export interface TicketState {
  status: TicketStatus;
  previousStatus: TicketStatus | null;
  hasAssignee: boolean;
}

function actorMatches(actors: readonly TicketActor[], ctx: TicketActorContext): boolean {
  if (ctx.isAdmin) return true;
  return actors.some(
    (a) =>
      (a === 'executor_manager' && ctx.isExecutorManager) ||
      (a === 'assignee' && ctx.isAssignee) ||
      (a === 'requester_side' && ctx.isRequesterSide),
  );
}

/** Transições que este usuário pode executar agora (para montar os botões da tela). */
export function availableTransitions(
  state: TicketState,
  ctx: TicketActorContext,
): TicketTransition[] {
  return TICKET_TRANSITIONS.filter(
    (t) =>
      t.from === state.status &&
      (!t.onlyToPrevious || t.to === state.previousStatus) &&
      actorMatches(t.actors, ctx),
  );
}

export function findTransition(from: TicketStatus, to: TicketStatus): TicketTransition | undefined {
  return TICKET_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/** Coluna do quadro "Chamados recebidos" para cada status. */
export function ticketStage(status: TicketStatus, previous: TicketStatus | null): TicketStage {
  switch (status) {
    case 'open':
      return 'new';
    case 'triage':
      return 'triage';
    case 'awaiting_info':
      return previous === 'in_progress' ? 'execution' : 'triage';
    case 'in_progress':
    case 'returned':
      return 'execution';
    case 'awaiting_approval':
      return 'approval';
    case 'approved':
    case 'rejected':
    case 'cancelled':
      return 'closed';
  }
}
