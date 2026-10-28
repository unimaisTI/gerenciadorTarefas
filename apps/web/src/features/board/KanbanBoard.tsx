import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { generateKeyBetween } from 'fractional-indexing';
import { Plus } from 'lucide-react';
import { useMemo, useState, type SyntheticEvent } from 'react';
import type { ColumnDto, ProjectDetailDto, TaskCardDto } from '@hub/shared';
import { IconButton, Input, useToast } from '@/design-system';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { keys } from '@/lib/queries';
import { KanbanCardView, SortableKanbanCard, type QuickEditContext } from './KanbanCard';

interface Props {
  project: ProjectDetailDto;
  tasks: TaskCardDto[];
  filtered: boolean;
  onOpen: (task: TaskCardDto) => void;
  ctx: QuickEditContext;
  /** Raia: cabeçalho das colunas menor e sem criação rápida. */
  lane?: string;
}

function QuickAdd({ project, column }: { project: ProjectDetailDto; column: ColumnDto }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();
  const create = useMutation({
    mutationFn: () => api.post('/tasks', { projectId: project.id, columnId: column.id, title }),
    onSuccess: () => {
      setTitle('');
      void queryClient.invalidateQueries({ queryKey: keys.board(project.id) });
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  if (!open) {
    return (
      <IconButton label={`Nova tarefa em ${column.name}`} onClick={() => { setOpen(true); }}>
        <Plus size={16} />
      </IconButton>
    );
  }
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (title.trim()) create.mutate();
  };
  return (
    <form onSubmit={submit} className="absolute top-12 right-2 left-2 z-10 rounded-sm bg-card p-2 shadow-lg">
      <Input
        autoFocus
        aria-label={`Título da nova tarefa em ${column.name}`}
        placeholder="Título e Enter"
        value={title}
        maxLength={200}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      />
    </form>
  );
}

function Column({
  project,
  column,
  tasks,
  onOpen,
  canDrag,
  ctx,
  lane,
}: {
  project: ProjectDetailDto;
  column: ColumnDto;
  tasks: TaskCardDto[];
  onOpen: Props['onOpen'];
  canDrag: boolean;
  ctx: QuickEditContext;
  lane?: string | undefined;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${column.id}`, data: { columnId: column.id } });
  const overWip = column.wipLimit != null && tasks.length > column.wipLimit;
  const isTicketBoard = project.kind === 'tickets';
  return (
    <section
      aria-label={column.name}
      className={cn(
        'relative flex w-[270px] shrink-0 flex-col rounded-md border border-subtle bg-gray-050',
        isOver && 'border-navy-400 bg-navy-050',
      )}
    >
      <header className="flex items-center justify-between gap-2 px-[15px] pt-[15px] pb-2.5">
        <h2 className="m-0 flex items-center gap-2 text-sm font-semibold">
          {column.name}
          <span className={cn('rounded-pill px-2 text-xs', overWip ? 'bg-warning-050 text-warning-ink' : 'bg-gray-200 text-gray-600')}>
            {tasks.length}
            {column.wipLimit != null && ` / ${String(column.wipLimit)}`}
          </span>
        </h2>
        {project.canEdit && !isTicketBoard && !lane && <QuickAdd project={project} column={column} />}
      </header>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="m-0 flex min-h-24 flex-1 flex-col gap-2.5 overflow-y-auto px-2.5 pb-2.5">
          {tasks.map((t) => (
            <SortableKanbanCard key={t.id} task={t} onOpen={() => { onOpen(t); }} disabled={!canDrag} ctx={ctx} />
          ))}
          {!tasks.length && <li className="list-none py-5 text-center text-xs text-faint">Nenhum cartão</li>}
        </ul>
      </SortableContext>
    </section>
  );
}

/**
 * Quadro Kanban (RF-5.5 a RF-5.7): arrastar entre colunas e dentro da coluna, com atualização
 * otimista (RNF-05). No quadro de chamados o cartão só reordena dentro da coluna: a etapa muda
 * pelas ações do chamado (seção 7).
 */
export function KanbanBoard({ project, tasks, filtered, onOpen, ctx, lane }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byColumn = useMemo(() => {
    const map = new Map<string, TaskCardDto[]>();
    for (const c of project.columns) map.set(c.id, []);
    for (const t of [...tasks].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))) {
      map.get(t.columnId)?.push(t);
    }
    return map;
  }, [project.columns, tasks]);

  const boardKey = keys.board(project.id);
  const move = useMutation({
    mutationFn: (v: { id: string; columnId: string; beforeTaskId: string | null; afterTaskId: string | null }) =>
      api.post<{ id: string; columnId: string; position: string }>(`/tasks/${v.id}/move`, v),
    onSuccess: (res) => {
      queryClient.setQueriesData<TaskCardDto[]>({ queryKey: boardKey }, (old) =>
        old?.map((t) => (t.id === res.id ? { ...t, columnId: res.columnId, position: res.position } : t)),
      );
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
      void queryClient.invalidateQueries({ queryKey: boardKey });
    },
  });

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const task = tasks.find((t) => t.id === active.id);
    if (!task) return;
    const overData = over.data.current as { columnId?: string } | undefined;
    const targetColumn = overData?.columnId ?? task.columnId;
    if (project.kind === 'tickets' && targetColumn !== task.columnId) {
      toast('No quadro de chamados a etapa muda pelas ações do chamado.', 'info');
      return;
    }
    const sameColumn = targetColumn === task.columnId;
    const original = byColumn.get(targetColumn) ?? [];
    const fromIndex = original.findIndex((t) => t.id === task.id);
    const list = original.filter((t) => t.id !== task.id);
    let index = list.length;
    if (!String(over.id).startsWith('column:')) {
      const overIndex = list.findIndex((t) => t.id === over.id);
      if (overIndex >= 0) index = sameColumn && fromIndex <= overIndex ? overIndex + 1 : overIndex;
    }
    if (sameColumn && index === fromIndex) return;
    const before = list[index - 1] ?? null;
    const after = list[index] ?? null;

    // Otimista: mesma chave fracionária que o servidor vai gerar.
    let position: string;
    try {
      position = generateKeyBetween(before?.position ?? null, after?.position ?? null);
    } catch {
      position = generateKeyBetween(before?.position ?? null, null);
    }
    queryClient.setQueriesData<TaskCardDto[]>({ queryKey: boardKey }, (old) =>
      old?.map((t) => (t.id === task.id ? { ...t, columnId: targetColumn, position } : t)),
    );
    move.mutate({ id: task.id, columnId: targetColumn, beforeTaskId: before?.id ?? null, afterTaskId: after?.id ?? null });
  };

  const active = tasks.find((t) => t.id === activeId);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e: DragStartEvent) => {
        setActiveId(String(e.active.id));
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable: 'Para mover o cartão, pressione espaço, use as setas e pressione espaço de novo para soltar.',
        },
      }}
    >
      <div className={cn('-mx-1 flex gap-[15px] overflow-x-auto px-1 pb-2.5', lane ? 'min-h-24' : 'min-h-[60vh]')}>
        {project.columns.map((c) => (
          <Column
            key={c.id}
            project={project}
            column={c}
            tasks={byColumn.get(c.id) ?? []}
            onOpen={onOpen}
            canDrag={project.canEdit && !filtered}
            ctx={ctx}
            lane={lane}
          />
        ))}
      </div>
      <DragOverlay>{active ? <KanbanCardView task={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
