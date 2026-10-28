import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useParams } from 'react-router';
import { formatDateTime, type TrashItemDto } from '@hub/shared';
import { Button, Card, DataTable, EmptyState, Spinner, useToast } from '@/design-system';
import { api, errorMessage } from '@/lib/api';
import { PageHeader } from '@/lib/ui';

/** RF-11.3: lixeira de 30 dias; gestor e admin restauram. */
export function TrashPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const trash = useQuery({ queryKey: ['trash', id], queryFn: () => api.get<TrashItemDto[]>(`/departments/${id}/trash`) });
  const restore = useMutation({
    mutationFn: (taskId: string) => api.post(`/tasks/${taskId}/restore`),
    onSuccess: () => {
      toast('Tarefa restaurada.');
      void queryClient.invalidateQueries({ queryKey: ['trash', id] });
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Lixeira" subtitle="Tarefas excluídas nos últimos 30 dias. Depois disso saem da lista, mas continuam guardadas." />
      {trash.isPending ? (
        <Spinner />
      ) : (
        <Card flush>
          <DataTable
            caption="Lixeira"
            rows={trash.data ?? []}
            rowKey={(t) => t.id}
            empty={<EmptyState icon={<Trash2 size={32} strokeWidth={1.5} />} title="Lixeira vazia" />}
            columns={[
              { key: 'code', header: 'Código', render: (t) => <span className="font-semibold text-navy-700">{t.code}</span> },
              { key: 'title', header: 'Título', render: (t) => t.title },
              { key: 'project', header: 'Projeto', render: (t) => t.projectName },
              { key: 'deleted', header: 'Excluída em', sortValue: (t) => t.deletedAt, render: (t) => `${formatDateTime(t.deletedAt)}${t.deletedBy ? ` por ${t.deletedBy.name}` : ''}` },
              {
                key: 'restore',
                header: '',
                render: (t) => (
                  <Button size="sm" variant="outline" icon={<RotateCcw size={13} />} onClick={() => { restore.mutate(t.id); }}>
                    Restaurar
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
