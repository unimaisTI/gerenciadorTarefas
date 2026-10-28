import { useQuery } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import { useNavigate } from 'react-router';
import { addDays, todayIso, type MyTaskDto } from '@hub/shared';
import { Card, DataTable, EmptyState, Spinner } from '@/design-system';
import { api } from '@/lib/api';
import { keys } from '@/lib/queries';
import { DueDate, PageHeader, PriorityBadge, TicketStatusBadge } from '@/lib/ui';

export function TaskTable({ tasks, caption }: { tasks: MyTaskDto[]; caption: string }) {
  const navigate = useNavigate();
  return (
    <DataTable
      caption={caption}
      rows={tasks}
      rowKey={(t) => t.id}
      onRowClick={(t) => void navigate(`/tarefas/${t.code}`)}
      columns={[
        { key: 'code', header: 'Código', sortValue: (t) => t.code, render: (t) => <span className="font-semibold text-navy-700">{t.ticket?.code ?? t.code}</span> },
        { key: 'title', header: 'Título', sortValue: (t) => t.title, render: (t) => <span className="whitespace-normal">{t.title}</span> },
        { key: 'project', header: 'Projeto', sortValue: (t) => t.projectName, render: (t) => `${t.departmentAcronym} · ${t.projectName}` },
        { key: 'status', header: 'Status', render: (t) => (t.ticket ? <TicketStatusBadge status={t.ticket.status} /> : null) },
        { key: 'priority', header: 'Prioridade', render: (t) => <PriorityBadge priority={t.priority} /> },
        { key: 'due', header: 'Prazo', sortValue: (t) => t.dueDate, render: (t) => <DueDate date={t.dueDate} time={t.dueTime} /> },
      ]}
    />
  );
}

/** RF-5.14: tudo atribuído ao usuário, de todos os projetos, agrupado por prazo. */
export function MyTasksPage() {
  const tasks = useQuery({ queryKey: keys.myTasks, queryFn: () => api.get<MyTaskDto[]>('/my-tasks') });
  const today = todayIso();
  const weekEnd = addDays(today, 7);
  const groups: { title: string; filter: (t: MyTaskDto) => boolean }[] = [
    { title: 'Atrasadas', filter: (t) => t.dueDate !== null && t.dueDate < today },
    { title: 'Hoje', filter: (t) => t.dueDate === today },
    { title: 'Próximos 7 dias', filter: (t) => t.dueDate !== null && t.dueDate > today && t.dueDate <= weekEnd },
    { title: 'Mais adiante', filter: (t) => t.dueDate !== null && t.dueDate > weekEnd },
    { title: 'Sem prazo', filter: (t) => t.dueDate === null },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Minhas tarefas" subtitle="Tudo o que está atribuído a você e ainda não foi concluído." />
      {tasks.isPending ? (
        <Spinner />
      ) : !tasks.data?.length ? (
        <Card>
          <EmptyState icon={<ListChecks size={32} strokeWidth={1.5} />} title="Nada pendente" description="Você não tem tarefas abertas atribuídas." />
        </Card>
      ) : (
        groups.map((g) => {
          const items = tasks.data.filter(g.filter);
          if (!items.length) return null;
          return (
            <Card key={g.title} title={`${g.title} (${String(items.length)})`} flush>
              <TaskTable tasks={items} caption={g.title} />
            </Card>
          );
        })
      )}
    </div>
  );
}
