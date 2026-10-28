import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Ban, ListChecks, MessageSquare, MoreHorizontal, Paperclip, Ticket } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  revisionLabel,
  type Priority,
  type TaskCardDto,
  type UpdateTaskInput,
} from '@hub/shared';
import { Avatar, Badge, Button, Field, IconButton, Input, Select, useToast } from '@/design-system';
import { PeoplePicker } from '@/components/PeoplePicker';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { keys } from '@/lib/queries';
import { DEPT_BG, DueDate, PriorityBadge, SlaBadge, TicketStatusBadge } from '@/lib/ui';

export interface QuickEditContext {
  departmentId: string;
  epics: { id: string; name: string }[];
  canEdit: boolean;
}

/** Cartão do quadro (RF-5.8): código, título, responsável, prioridade, prazo, etiquetas e contadores. */
export function KanbanCardView({ task, dragging = false }: { task: TaskCardDto; dragging?: boolean }) {
  const revision = task.ticket ? revisionLabel(task.ticket.revisionCount) : null;
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-sm border border-subtle bg-card p-3 text-left shadow-sm',
        task.blocked && 'border-l-[3px] border-l-warning',
        dragging && 'rotate-1 shadow-lg',
      )}
    >
      <div className="flex items-center justify-between gap-2 pr-6">
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-navy-700">
          {task.ticket && <Ticket size={12} aria-label="Chamado" />}
          {task.ticket?.code ?? task.code}
        </span>
        {task.ticket && <span className="text-2xs text-muted">de {task.ticket.requesterDepartmentAcronym}</span>}
      </div>
      <span className="text-sm leading-snug font-medium text-strong">{task.title}</span>
      {(task.epic ?? task.labels.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {task.epic && (
            <span className={cn('rounded-xs px-1.5 py-px text-2xs font-semibold text-white', DEPT_BG[task.epic.color])} title="Épico">
              {task.epic.name}
            </span>
          )}
          {task.labels.map((l) => (
            <span key={l.id} className={cn('rounded-pill px-2 py-px text-2xs font-medium text-white', DEPT_BG[l.color])}>
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={task.priority} />
        {task.ticket && <TicketStatusBadge status={task.ticket.status} />}
        {task.ticket && <SlaBadge dueAt={task.ticket.slaDueAt} status={task.ticket.status} />}
        {revision && <Badge tone="danger">{revision}</Badge>}
        {task.blocked && (
          <Badge tone="warning">
            <Ban size={11} aria-hidden="true" /> Bloqueada
          </Badge>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="flex items-center gap-2.5">
          <DueDate date={task.dueDate} time={task.dueTime} done={task.statusCategory === 'done'} />
          {task.commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5" title="Comentários">
              <MessageSquare size={12} aria-hidden="true" />
              {task.commentCount}
              <span className="sr-only"> comentários</span>
            </span>
          )}
          {task.attachmentCount > 0 && (
            <span className="inline-flex items-center gap-0.5" title="Anexos">
              <Paperclip size={12} aria-hidden="true" />
              {task.attachmentCount}
              <span className="sr-only"> anexos</span>
            </span>
          )}
          {task.subtaskTotal > 0 && (
            <span className="inline-flex items-center gap-0.5" title="Subtarefas concluídas">
              <ListChecks size={12} aria-hidden="true" />
              {task.subtaskDone}/{task.subtaskTotal}
            </span>
          )}
        </span>
        {task.assignee ? (
          <Avatar name={task.assignee.name} src={task.assignee.avatarUrl} size={24} />
        ) : (
          <span className="text-2xs text-faint">Sem responsável</span>
        )}
      </div>
    </div>
  );
}

/** Edição rápida no cartão, sem abrir o painel (como no Jira). */
export function QuickEdit({ task, ctx }: { task: TaskCardDto; ctx: QuickEditContext }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const update = useMutation({
    mutationFn: (patch: UpdateTaskInput) => api.patch(`/tasks/${task.id}`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.board(task.projectId) });
      void queryClient.invalidateQueries({ queryKey: keys.taskAny });
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('[role="listbox"]')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!ctx.canEdit) return null;
  return (
    <div ref={ref} className="absolute top-1.5 right-1.5 z-10">
      <IconButton
        label={`Edição rápida de ${task.code}`}
        aria-expanded={open}
        className={cn('size-7 bg-card/90 opacity-0 group-hover:opacity-100 focus-visible:opacity-100', open && 'opacity-100')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <MoreHorizontal size={15} />
      </IconButton>
      {open && (
        <div
          role="dialog"
          aria-label={`Edição rápida de ${task.code}`}
          className="absolute top-8 right-0 flex w-64 flex-col gap-2.5 rounded-sm border border-subtle bg-card p-[15px] shadow-lg"
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
        >
          <Field label="Prioridade">
            <Select
              value={task.priority}
              options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
              onChange={(e) => {
                update.mutate({ priority: e.target.value as Priority });
              }}
            />
          </Field>
          {!task.ticket && (
            <Field label="Responsável">
              <PeoplePicker
                label="Responsável"
                value={task.assignee}
                departmentIds={[ctx.departmentId]}
                onChange={(u) => {
                  update.mutate({ assigneeId: u?.id ?? null });
                }}
              />
            </Field>
          )}
          {!task.ticket && (
            <Field label="Prazo">
              <Input
                type="date"
                defaultValue={task.dueDate ?? ''}
                onBlur={(e) => {
                  if ((e.target.value || null) !== task.dueDate) update.mutate({ dueDate: e.target.value || null });
                }}
              />
            </Field>
          )}
          {ctx.epics.length > 0 && (
            <Field label="Épico">
              <Select
                placeholder="Nenhum"
                value={task.epic?.id ?? ''}
                options={ctx.epics.map((e) => ({ value: e.id, label: e.name }))}
                onChange={(e) => {
                  update.mutate({ epicId: e.target.value || null });
                }}
              />
            </Field>
          )}
          {!task.ticket && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Archive size={13} />}
              onClick={() => {
                update.mutate({ inBacklog: !task.inBacklog });
                setOpen(false);
              }}
            >
              {task.inBacklog ? 'Enviar ao quadro' : 'Mandar para o backlog'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function SortableKanbanCard({
  task,
  onOpen,
  disabled,
  ctx,
}: {
  task: TaskCardDto;
  onOpen: () => void;
  disabled: boolean;
  ctx: QuickEditContext;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { columnId: task.columnId },
    disabled,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group relative list-none', isDragging && 'opacity-40')}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-roledescription="cartão arrastável"
        aria-label={`${task.ticket?.code ?? task.code}: ${task.title}`}
        onClick={onOpen}
        className="block w-full cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left transition-transform duration-[var(--dur-base)] hover:-translate-y-0.5"
      >
        <KanbanCardView task={task} />
      </button>
      <QuickEdit task={task} ctx={ctx} />
    </li>
  );
}
