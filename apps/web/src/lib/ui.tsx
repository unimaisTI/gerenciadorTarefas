import { CircleAlert, Flag } from 'lucide-react';
import {
  PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  formatDate,
  todayIso,
  type DepartmentColor,
  type Priority,
  type TicketStatus,
} from '@hub/shared';
import { Badge, type BadgeTone } from '@/design-system';
import { cn } from './cn';

// Pequenos componentes de domínio reaproveitados em várias telas.
// Cor nunca é o único sinal (RNF-15.7): sempre texto ou ícone junto.

const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  low: 'neutral',
  medium: 'navy',
  high: 'warning',
  urgent: 'danger',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge tone={PRIORITY_TONE[priority]}>
      <Flag size={11} aria-hidden="true" />
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}

const TICKET_TONE: Record<TicketStatus, BadgeTone> = {
  open: 'navy',
  triage: 'navy',
  awaiting_info: 'warning',
  in_progress: 'navy',
  awaiting_approval: 'warning',
  returned: 'danger',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge tone={TICKET_TONE[status]} dot>
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Prazo em dd/mm/aaaa; vermelho com ícone se atrasado (RF-5.8). */
export function DueDate({ date, time, done = false }: { date: string | null; time?: string | null; done?: boolean }) {
  if (!date) return <span className="text-faint">Sem prazo</span>;
  const overdue = !done && date < todayIso();
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', overdue ? 'font-semibold text-red-600' : 'text-body')}>
      {overdue && <CircleAlert size={12} aria-hidden="true" />}
      {formatDate(date)}
      {time ? ` ${time}` : ''}
      {overdue && <span className="sr-only"> (atrasada)</span>}
    </span>
  );
}

/** Tempo restante do SLA do chamado (RF-10.20); só enquanto o executor ainda deve a entrega. */
export function SlaBadge({ dueAt, status }: { dueAt: string | null; status: TicketStatus }) {
  if (!dueAt || !['open', 'triage', 'in_progress', 'returned', 'awaiting_info'].includes(status)) return null;
  const hours = (Date.parse(dueAt) - Date.now()) / 3_600_000;
  if (hours < 0) {
    return (
      <Badge tone="danger">
        <CircleAlert size={11} aria-hidden="true" /> SLA estourado
      </Badge>
    );
  }
  const text = hours < 24 ? `${String(Math.max(1, Math.round(hours)))}h` : `${String(Math.round(hours / 24))}d`;
  return <Badge tone={hours < 24 ? 'warning' : 'neutral'}>SLA: {text}</Badge>;
}

export const DEPT_BG: Record<DepartmentColor, string> = {
  navy: 'bg-dept-navy',
  red: 'bg-dept-red',
  indigo: 'bg-dept-indigo',
  green: 'bg-dept-green',
  amber: 'bg-dept-amber',
  slate: 'bg-dept-slate',
  wine: 'bg-dept-wine',
  teal: 'bg-dept-teal',
};

export function deptColorVar(color: DepartmentColor) {
  return `var(--dept-${color})`;
}

export function DeptChip({ acronym, color }: { acronym: string; color: DepartmentColor }) {
  return (
    <span className={cn('inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-semibold text-white', DEPT_BG[color])}>
      {acronym}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-[15px]">
      <div className="min-w-0">
        <h1 className="m-0 text-h3 leading-tight font-bold">{title}</h1>
        {subtitle && <p className="m-0 mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}
