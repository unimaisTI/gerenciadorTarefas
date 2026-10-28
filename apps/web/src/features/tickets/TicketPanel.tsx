import { useMutation } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import {
  TICKET_ACTION_LABELS,
  TICKET_STATUS_LABELS,
  formatDate,
  formatDateTime,
  isManagerOf,
  revisionLabel,
  type TaskDetailDto,
  type TicketDetailDto,
  type TicketStatus,
} from '@hub/shared';
import { Avatar, Badge, Button, Card, Field, Input, Modal, Textarea, useToast } from '@/design-system';
import { PeoplePicker } from '@/components/PeoplePicker';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SlaBadge, TicketStatusBadge } from '@/lib/ui';
import { DueDateWarning } from '../tasks/DueDateWarning';

const NOTE_LABELS: Partial<Record<TicketStatus, string>> = {
  rejected: 'Motivo da recusa',
  returned: 'Motivo da devolução',
  awaiting_approval: 'O que foi feito (comentário de entrega, link do resultado)',
  awaiting_info: 'Quais informações faltam',
  triage: 'Resposta ao executor',
  in_progress: 'Resposta ao executor',
};

/** Ação "principal" de cada lado ganha destaque; o resto fica em contorno. */
const PRIMARY: TicketStatus[] = ['approved', 'awaiting_approval', 'in_progress', 'triage'];

/** Linha do tempo do chamado (seção 7, Telas): abertura, atribuições, entregas, devoluções, aprovação. */
export function TicketTimeline({ ticket }: { ticket: TicketDetailDto }) {
  return (
    <ol className="relative m-0 flex list-none flex-col gap-[15px] border-l-2 border-navy-100 py-1 pl-5">
      {ticket.events.map((e) => {
        const label =
          e.fromStatus === null
            ? 'abriu o chamado'
            : e.fromStatus === e.toStatus
              ? 'atualizou o chamado'
              : `${TICKET_ACTION_LABELS[e.toStatus].toLowerCase()} → ${TICKET_STATUS_LABELS[e.toStatus]}`;
        return (
          <li key={e.id} className="relative">
            <span
              aria-hidden="true"
              className="absolute top-1.5 -left-[27px] size-3 rounded-full border-2 border-white bg-navy-700"
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {e.actor && <Avatar name={e.actor.name} src={e.actor.avatarUrl} size={20} />}
              <strong className="text-strong">{e.actor?.name ?? 'Sistema'}</strong>
              <span className="text-body">{label}</span>
            </div>
            {e.note && <p className="m-0 mt-1 rounded-xs bg-gray-050 px-2.5 py-1.5 text-sm whitespace-pre-wrap text-body">{e.note}</p>}
            <span className="text-xs text-muted">{formatDateTime(e.createdAt)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function TicketPanel({ task, onChanged }: { task: TaskDetailDto; onChanged: () => void }) {
  const ticket = task.ticketDetail;
  const { viewer } = useAuth();
  const toast = useToast();
  const [pending, setPending] = useState<{ to: TicketStatus; requiresNote: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [dueOpen, setDueOpen] = useState(false);
  const [due, setDue] = useState(task.dueDate ?? '');
  const [reason, setReason] = useState('');

  const transition = useMutation({
    mutationFn: (v: { to: TicketStatus; note?: string }) => api.post(`/tickets/${ticket?.id ?? ''}/transition`, v),
    onSuccess: (_d, v) => {
      toast(`Chamado: ${TICKET_STATUS_LABELS[v.to]}.`);
      setPending(null);
      setNote('');
      onChanged();
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  const assign = useMutation({
    mutationFn: (assigneeId: string) => api.post(`/tickets/${ticket?.id ?? ''}/assign`, { assigneeId }),
    onSuccess: () => {
      toast('Responsável atribuído.');
      onChanged();
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  const changeDue = useMutation({
    mutationFn: () => api.post(`/tickets/${ticket?.id ?? ''}/due`, { dueDate: due || null, reason }),
    onSuccess: () => {
      setDueOpen(false);
      setReason('');
      onChanged();
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });

  if (!ticket) return null;
  const revision = revisionLabel(ticket.revisionCount);
  const canChangeDue = isManagerOf(viewer, ticket.targetDepartment.id) && !['approved', 'rejected', 'cancelled'].includes(ticket.status);

  const act = (t: { to: TicketStatus; requiresNote: boolean }) => {
    if (t.requiresNote || t.to === 'cancelled' || t.to === 'approved') {
      setPending(t);
    } else {
      transition.mutate({ to: t.to });
    }
  };

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          Chamado {ticket.code}
          <TicketStatusBadge status={ticket.status} />
          {revision && <Badge tone="danger">{revision}</Badge>}
        </span>
      }
    >
      <dl className="m-0 grid grid-cols-1 gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="u-label">Solicitante</dt>
          <dd className="m-0">
            {ticket.requester.name} · {ticket.requesterDepartment.acronym}
          </dd>
        </div>
        <div>
          <dt className="u-label">Departamento executor</dt>
          <dd className="m-0">{ticket.targetDepartment.name}</dd>
        </div>
        <div>
          <dt className="u-label">Tipo</dt>
          <dd className="m-0">{ticket.ticketType.name}</dd>
        </div>
        <div>
          <dt className="u-label">Prazo desejado</dt>
          <dd className="m-0">{ticket.desiredDueDate ? formatDate(ticket.desiredDueDate) : 'Não informado'}</dd>
        </div>
        <div>
          <dt className="u-label">Prazo combinado</dt>
          <dd className="m-0 flex items-center gap-2">
            {task.dueDate ? formatDate(task.dueDate) : 'Não definido'}
            {canChangeDue && (
              <Button variant="ghost" size="sm" icon={<CalendarClock size={14} />} onClick={() => { setDueOpen(true); }}>
                Alterar prazo
              </Button>
            )}
          </dd>
        </div>
        {ticket.slaDueAt && (
          <div>
            <dt className="u-label">SLA (entrega até)</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2">
              {formatDateTime(ticket.slaDueAt)}
              {ticket.slaBreached ? (
                <Badge tone="danger">Estourado</Badge>
              ) : (
                <SlaBadge dueAt={ticket.slaDueAt} status={ticket.status} />
              )}
            </dd>
          </div>
        )}
        {ticket.approver && (
          <div>
            <dt className="u-label">Aprovador</dt>
            <dd className="m-0">{ticket.approver.name}</dd>
          </div>
        )}
      </dl>

      {ticket.canAssign && (
        <div className="mt-[15px] max-w-sm">
          <Field label="Responsável pelo atendimento">
            <PeoplePicker
              label="Responsável pelo atendimento"
              value={task.assignee}
              departmentIds={[ticket.targetDepartment.id]}
              onChange={(u) => {
                if (u) assign.mutate(u.id);
              }}
            />
          </Field>
        </div>
      )}

      {ticket.allowedTransitions.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2.5" role="group" aria-label="Ações do chamado">
          {ticket.allowedTransitions.map((t) => (
            <Button
              key={t.to}
              variant={PRIMARY.includes(t.to) ? 'primary' : 'outline'}
              disabled={transition.isPending}
              onClick={() => {
                act(t);
              }}
            >
              {TICKET_ACTION_LABELS[t.to]}
            </Button>
          ))}
        </div>
      )}

      <h3 className="mt-5 mb-2.5 text-base font-semibold">Linha do tempo</h3>
      <TicketTimeline ticket={ticket} />

      <Modal
        open={pending !== null}
        title={pending ? TICKET_ACTION_LABELS[pending.to] : ''}
        onClose={() => { setPending(null); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setPending(null); }}>
              Voltar
            </Button>
            <Button
              disabled={(pending?.requiresNote ?? false) && !note.trim()}
              onClick={() => {
                if (pending) transition.mutate({ to: pending.to, ...(note.trim() && { note: note.trim() }) });
              }}
            >
              Confirmar
            </Button>
          </>
        }
      >
        {pending?.requiresNote ? (
          <Field label={NOTE_LABELS[pending.to] ?? 'Comentário'} required>
            <Textarea data-autofocus value={note} maxLength={5000} onChange={(e) => { setNote(e.target.value); }} />
          </Field>
        ) : (
          <p className="m-0 text-sm">
            {pending?.to === 'approved'
              ? 'Confirmar a aprovação da entrega? O executor será avisado.'
              : 'Confirmar o cancelamento do chamado?'}
          </p>
        )}
      </Modal>

      <Modal
        open={dueOpen}
        title="Alterar prazo do chamado"
        onClose={() => { setDueOpen(false); }}
        footer={
          <Button disabled={!reason.trim() || changeDue.isPending} onClick={() => { changeDue.mutate(); }}>
            Salvar prazo
          </Button>
        }
      >
        <div className="flex flex-col gap-[15px]">
          <Field label="Novo prazo">
            <Input type="date" value={due} onChange={(e) => { setDue(e.target.value); }} />
          </Field>
          <DueDateWarning date={due} />
          <Field label="Motivo" required hint="O solicitante é avisado e a mudança entra na linha do tempo.">
            <Textarea value={reason} maxLength={500} onChange={(e) => { setReason(e.target.value); }} />
          </Field>
        </div>
      </Modal>
    </Card>
  );
}
