import { useQuery } from '@tanstack/react-query';
import {
  PRIORITY_LABELS,
  formatDate,
  formatDateTime,
  type ActivityDto,
  type Priority,
} from '@hub/shared';
import { Spinner } from '@/design-system';
import { api } from '@/lib/api';
import { keys } from '@/lib/queries';

const FIELD_LABELS: Record<string, string> = {
  title: 'o título',
  description: 'a descrição',
  column: 'a coluna',
  assignee: 'o responsável',
  priority: 'a prioridade',
  dueDate: 'o prazo',
  startDate: 'a data de início',
  estimate: 'a estimativa',
  project: 'o projeto',
};

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'vazio';
  if (field === 'priority') return PRIORITY_LABELS[value as Priority];
  if ((field === 'dueDate' || field === 'startDate') && typeof value === 'string') return formatDate(value);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : 'alterado';
}

function describe(entry: ActivityDto): string[] {
  const who = entry.actor?.name ?? 'Sistema';
  if (entry.action === 'created') return [`${who} criou a tarefa`];
  if (entry.action === 'deleted') return [`${who} moveu a tarefa para a lixeira`];
  if (entry.action === 'restored') return [`${who} restaurou a tarefa da lixeira`];
  return Object.entries(entry.changes).map(([field, ch]) => {
    if (field === 'column') return `${who} moveu de ${show(field, ch.from)} para ${show(field, ch.to)}`;
    if (field === 'description') return `${who} alterou a descrição`;
    return `${who} mudou ${FIELD_LABELS[field] ?? field} de ${show(field, ch.from)} para ${show(field, ch.to)}`;
  });
}

/** RF-11.1: histórico com campo, antes, depois, quem e quando. */
export function History({ taskId }: { taskId: string }) {
  const history = useQuery({
    queryKey: keys.history(taskId),
    queryFn: () => api.get<ActivityDto[]>(`/tasks/${taskId}/history`),
  });
  if (history.isPending) return <Spinner />;
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {(history.data ?? []).flatMap((entry) =>
        describe(entry).map((line, i) => (
          <li key={`${entry.id}-${String(i)}`} className="flex flex-wrap gap-x-2 border-b border-subtle pb-2 text-sm">
            <span className="text-body">{line}</span>
            <span className="text-xs text-muted">— {formatDateTime(entry.createdAt)}</span>
          </li>
        )),
      )}
    </ol>
  );
}
