import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABELS,
  type ColumnDto,
  type ProjectDetailDto,
  type StatusCategory,
} from '@hub/shared';
import { Button, Field, IconButton, Input, Select, useToast } from '@/design-system';
import { api, errorMessage } from '@/lib/api';
import { keys } from '@/lib/queries';

/** RF-5.6 (aba Colunas de "Configurar"): criar, renomear, reordenar e excluir colunas, cada uma com categoria de status. */
export function ColumnsSettings({ project }: { project: ProjectDetailDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<StatusCategory>('doing');
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.project(project.key) });
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void refresh();
      void queryClient.invalidateQueries({ queryKey: keys.board(project.id) });
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });

  const cols = project.columns;
  const reorder = (index: number, delta: number) => {
    const ids = cols.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(index + delta, 0, moved);
    run.mutate(() => api.put(`/projects/${project.id}/columns/order`, { columnIds: ids }));
  };
  const remove = (c: ColumnDto) => {
    const others = cols.filter((x) => x.id !== c.id);
    const target = others[0];
    if (!window.confirm(`Excluir a coluna "${c.name}"? Os cartões vão para "${target?.name ?? ''}".`)) return;
    run.mutate(() => api.del(`/columns/${c.id}${target ? `?moveTasksTo=${target.id}` : ''}`));
  };

  return (
    <div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {cols.map((c, i) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2.5">
            <div className="min-w-40 flex-1">
              <Input
                aria-label={`Nome da coluna ${c.name}`}
                defaultValue={c.name}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== c.name) {
                    run.mutate(() => api.patch(`/columns/${c.id}`, { name: e.target.value.trim() }));
                  }
                }}
              />
            </div>
            <div className="w-40">
              <Select
                aria-label={`Categoria da coluna ${c.name}`}
                value={c.statusCategory}
                options={STATUS_CATEGORIES.map((s) => ({ value: s, label: STATUS_CATEGORY_LABELS[s] }))}
                onChange={(e) => {
                  run.mutate(() => api.patch(`/columns/${c.id}`, { statusCategory: e.target.value }));
                }}
              />
            </div>
            <div className="w-24">
              <Input
                type="number"
                min={1}
                aria-label={`Limite de cartões da coluna ${c.name}`}
                placeholder="Limite"
                defaultValue={c.wipLimit ?? ''}
                onBlur={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  if (v !== c.wipLimit) run.mutate(() => api.patch(`/columns/${c.id}`, { wipLimit: v }));
                }}
              />
            </div>
            <IconButton label={`Subir ${c.name}`} disabled={i === 0} onClick={() => { reorder(i, -1); }}>
              <ArrowUp size={15} />
            </IconButton>
            <IconButton label={`Descer ${c.name}`} disabled={i === cols.length - 1} onClick={() => { reorder(i, 1); }}>
              <ArrowDown size={15} />
            </IconButton>
            <IconButton label={`Excluir ${c.name}`} variant="danger" disabled={cols.length <= 1} onClick={() => { remove(c); }}>
              <Trash2 size={15} />
            </IconButton>
          </li>
        ))}
      </ul>
      <form
        className="mt-5 flex flex-wrap items-end gap-2.5 border-t border-subtle pt-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run.mutate(() => api.post(`/projects/${project.id}/columns`, { name: name.trim(), statusCategory: category }));
          setName('');
        }}
      >
        <Field label="Nova coluna" className="min-w-40 flex-1">
          <Input value={name} maxLength={60} onChange={(e) => { setName(e.target.value); }} />
        </Field>
        <Field label="Categoria" className="w-40">
          <Select
            value={category}
            options={STATUS_CATEGORIES.map((s) => ({ value: s, label: STATUS_CATEGORY_LABELS[s] }))}
            onChange={(e) => {
              setCategory(e.target.value as StatusCategory);
            }}
          />
        </Field>
        <Button type="submit" disabled={!name.trim()}>
          Adicionar
        </Button>
      </form>
      <p className="mt-2.5 mb-0 text-xs text-muted">A categoria (a fazer, em andamento, concluído) alimenta os relatórios.</p>
    </div>
  );
}
