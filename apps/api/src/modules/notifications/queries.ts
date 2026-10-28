import { sql } from 'drizzle-orm';
import type { Executor } from '@hub/db';
import {
  TICKET_STATUS_LABELS,
  formatDate,
  type NotificationDto,
  type NotificationType,
  type TicketStatus,
  type UserRef,
} from '@hub/shared';
import { rows } from '../../lib/sql';
import { userRef } from '../tasks/queries';

interface Row {
  id: string;
  type: NotificationType;
  actor: UserRef | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

function text(type: NotificationType, p: Record<string, unknown>, actor: string): { title: string; body: string | null } {
  const s = (k: string) => (typeof p[k] === 'string' ? p[k] : '');
  const ref = s('ticketCode') || s('taskCode');
  const title = s('taskTitle');
  const status = s('status') as TicketStatus;
  const note = s('note') || s('excerpt') || null;
  switch (type) {
    case 'task_assigned':
      return { title: `${actor} atribuiu ${ref} a você`, body: title };
    case 'mentioned':
      return { title: `${actor} mencionou você em ${ref}`, body: note };
    case 'task_commented':
      return { title: `${actor} comentou em ${ref}`, body: note };
    case 'ticket_opened':
      return { title: `Novo chamado ${ref} para o seu departamento`, body: title };
    case 'ticket_awaiting_approval':
      return { title: `${ref} aguarda sua aprovação`, body: note ?? title };
    case 'ticket_returned':
      return { title: `${ref} foi devolvido`, body: note };
    case 'ticket_approved':
      return { title: `${ref} foi aprovado`, body: title };
    case 'ticket_due_changed':
      return {
        title: `Prazo de ${ref} alterado${s('dueDate') ? ` para ${formatDate(s('dueDate'))}` : ''}`,
        body: note,
      };
    case 'ticket_status_changed':
      return {
        title: `${ref}: ${status in TICKET_STATUS_LABELS ? TICKET_STATUS_LABELS[status] : 'atualizado'}`,
        body: note ?? title,
      };
    case 'task_due_soon':
      return { title: `${ref} vence em menos de 24 horas`, body: title };
    case 'task_overdue':
      return { title: `${ref} está atrasada`, body: title };
    case 'automation':
      return { title: `Automação "${s('rule')}": ${ref}`, body: title };
    case 'ticket_sla_warning':
      return { title: `SLA de ${ref} perto de estourar`, body: title };
    case 'ticket_sla_breached':
      return { title: `SLA de ${ref} estourado`, body: title };
  }
}

export async function listNotifications(tx: Executor, userId: string, limit: number): Promise<NotificationDto[]> {
  const list = await rows<Row>(
    tx,
    sql`select n.id, n.type, ${userRef('u')} as actor, n.payload, app.iso(n.read_at) as "readAt",
          app.iso(n.created_at) as "createdAt"
        from notifications n left join users u on u.id = n.actor_id
        where n.user_id = ${userId}
        order by n.created_at desc limit ${limit}`,
  );
  return list.map((n) => {
    const t = text(n.type, n.payload, n.actor?.name ?? 'Sistema');
    return {
      id: n.id,
      type: n.type,
      actor: n.actor,
      taskCode: typeof n.payload.taskCode === 'string' ? n.payload.taskCode : null,
      title: t.title,
      body: t.body,
      readAt: n.readAt,
      createdAt: n.createdAt,
    };
  });
}
