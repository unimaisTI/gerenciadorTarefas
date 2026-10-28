import { useMutation } from '@tanstack/react-query';
import { Plus, Unlink } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  TASK_LINK_KINDS,
  TASK_LINK_LABELS,
  formatNumber,
  type TaskDetailDto,
  type TaskLinkKind,
} from '@hub/shared';
import { Badge, Button, IconButton, Input, Select, useToast } from '@/design-system';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

/** Vínculos entre tarefas (RF-6.6): "bloqueia / é bloqueada por", "relacionada a", "duplicada de". */
export function Links({ task, onChanged }: { task: TaskDetailDto; onChanged: () => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<TaskLinkKind>('blocks');
  const [code, setCode] = useState('');
  const add = useMutation({
    mutationFn: () => api.post(`/tasks/${task.id}/links`, { targetCode: code.trim(), kind }),
    onSuccess: () => {
      setCode('');
      setAdding(false);
      onChanged();
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/task-links/${id}`),
    onSuccess: onChanged,
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });

  if (!task.links.length && !task.canEdit) return null;
  return (
    <section aria-labelledby="links-title" className="flex flex-col gap-2.5">
      <h3 id="links-title" className="m-0 text-base font-semibold">Vínculos</h3>
      {task.links.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {task.links.map((l) => {
            const [outgoing, incoming] = TASK_LINK_LABELS[l.kind];
            const blocking = l.kind === 'blocks' && l.direction === 'incoming' && !l.task.done;
            return (
              <li key={l.id} className="flex items-center gap-2.5 rounded-sm border border-subtle bg-white px-2.5 py-1.5 text-sm">
                <span className={cn('w-36 shrink-0 text-xs', blocking ? 'font-semibold text-warning-ink' : 'text-muted')}>
                  {l.direction === 'outgoing' ? outgoing : incoming}
                </span>
                <Link to={`/tarefas/${l.task.code}`} className={cn('min-w-0 flex-1 truncate', l.task.done && 'text-muted line-through')}>
                  <span className="mr-1.5 text-xs font-semibold text-navy-700">{l.task.code}</span>
                  {l.task.title}
                </Link>
                {l.task.done && <Badge tone="success">Concluída</Badge>}
                {task.canEdit && (
                  <IconButton label={`Desfazer vínculo com ${l.task.code}`} onClick={() => { remove.mutate(l.id); }}>
                    <Unlink size={14} />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {task.canEdit &&
        (adding ? (
          <form
            className="flex flex-wrap gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) add.mutate();
            }}
          >
            <div className="w-48">
              <Select
                aria-label="Tipo de vínculo"
                value={kind}
                options={TASK_LINK_KINDS.map((k) => ({ value: k, label: `Esta tarefa ${TASK_LINK_LABELS[k][0]}` }))}
                onChange={(e) => { setKind(e.target.value as TaskLinkKind); }}
              />
            </div>
            <div className="w-40">
              <Input autoFocus aria-label="Código da outra tarefa" placeholder="Ex.: TI-12" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); }} />
            </div>
            <Button type="submit" size="md" disabled={!code.trim() || add.isPending}>Vincular</Button>
            <Button variant="ghost" onClick={() => { setAdding(false); }}>Cancelar</Button>
          </form>
        ) : (
          <div>
            <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => { setAdding(true); }}>
              Adicionar vínculo
            </Button>
          </div>
        ))}
    </section>
  );
}

function hours(h: number) {
  if (h < 1) return `${formatNumber(Math.round(h * 60))} min`;
  if (h < 48) return `${formatNumber(Math.round(h * 10) / 10)} h`;
  return `${formatNumber(Math.round(h / 24 * 10) / 10)} dias`;
}

/** Quanto tempo a tarefa ficou em cada coluna (para achar onde o trabalho parou). */
export function ColumnTimes({ times }: { times: TaskDetailDto['columnTimes'] }) {
  if (!times.length) return null;
  const max = Math.max(...times.map((t) => t.hours), 0.01);
  return (
    <div className="mb-[15px] rounded-sm border border-subtle bg-white p-[15px]">
      <h4 className="mt-0 mb-2.5 text-sm font-semibold">Tempo em cada coluna</h4>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {times.map((t) => (
          <li key={t.column} className="flex items-center gap-2.5 text-sm">
            <span className="w-32 shrink-0 truncate">{t.column}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-pill bg-gray-100">
              <span className="block h-full rounded-pill bg-navy-400" style={{ width: `${String(Math.max(3, (t.hours / max) * 100))}%` }} />
            </span>
            <span className="w-20 shrink-0 text-right text-xs text-muted">{hours(t.hours)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
