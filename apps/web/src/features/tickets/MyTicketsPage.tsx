import { useQuery } from '@tanstack/react-query';
import { Inbox, Send } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { formatDate, revisionLabel, type TicketListItemDto } from '@hub/shared';
import { Badge, Button, Card, DataTable, EmptyState, Spinner, Tabs } from '@/design-system';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys } from '@/lib/queries';
import { DueDate, PageHeader, PriorityBadge, TicketStatusBadge } from '@/lib/ui';

type Tab = 'opened' | 'approval' | 'closed';

export function TicketTable({ tickets, caption }: { tickets: TicketListItemDto[]; caption: string }) {
  const navigate = useNavigate();
  return (
    <DataTable
      caption={caption}
      rows={tickets}
      rowKey={(t) => t.id}
      onRowClick={(t) => void navigate(`/tarefas/${t.code}`)}
      columns={[
        { key: 'code', header: 'Código', sortValue: (t) => Number(t.code.slice(3)), render: (t) => <span className="font-semibold text-navy-700">{t.code}</span> },
        {
          key: 'title',
          header: 'Título',
          sortValue: (t) => t.title,
          render: (t) => (
            <span className="flex flex-wrap items-center gap-1.5 whitespace-normal">
              {t.title}
              {revisionLabel(t.revisionCount) && <Badge tone="danger">{revisionLabel(t.revisionCount)}</Badge>}
            </span>
          ),
        },
        { key: 'route', header: 'De → Para', render: (t) => `${t.requesterDepartment.acronym} → ${t.targetDepartment.acronym}` },
        { key: 'status', header: 'Status', sortValue: (t) => t.status, render: (t) => <TicketStatusBadge status={t.status} /> },
        { key: 'priority', header: 'Prioridade', render: (t) => <PriorityBadge priority={t.priority} /> },
        { key: 'assignee', header: 'Responsável', sortValue: (t) => t.assignee?.name ?? null, render: (t) => t.assignee?.name ?? <span className="text-faint">A definir</span> },
        { key: 'due', header: 'Prazo', sortValue: (t) => t.dueDate ?? t.desiredDueDate, render: (t) => <DueDate date={t.dueDate ?? t.desiredDueDate} done={['approved', 'rejected', 'cancelled'].includes(t.status)} /> },
        { key: 'submitted', header: 'Aberto em', sortValue: (t) => t.submittedAt, render: (t) => formatDate(t.submittedAt) },
      ]}
    />
  );
}

/** Seção 7, Telas: "Abertos por mim", "Aguardando minha aprovação" e "Encerrados". */
export function MyTicketsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { viewer } = useAuth();
  const tab = (params.get('aba') as Tab | null) ?? 'opened';
  const list = useQuery({
    queryKey: keys.myTickets(tab),
    queryFn: () => api.get<TicketListItemDto[]>(`/tickets/mine?tab=${tab}`),
  });
  const approval = useQuery({
    queryKey: keys.myTickets('approval'),
    queryFn: () => api.get<TicketListItemDto[]>('/tickets/mine?tab=approval'),
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Meus chamados"
        subtitle="Chamados que você abriu ou que aguardam a sua aprovação."
        actions={
          viewer.role !== 'observador' && (
            <Button variant="primary" icon={<Send size={14} />} onClick={() => void navigate('/chamados/novo')}>
              Abrir chamado
            </Button>
          )
        }
      />
      <Tabs
        label="Meus chamados"
        active={tab}
        onChange={(t) => {
          setParams({ aba: t });
        }}
        tabs={[
          { id: 'opened', label: 'Abertos por mim' },
          { id: 'approval', label: 'Aguardando minha aprovação', ...(approval.data && { count: approval.data.length }) },
          { id: 'closed', label: 'Encerrados' },
        ]}
      />
      {list.isPending ? (
        <Spinner />
      ) : list.data?.length ? (
        <Card flush>
          <TicketTable tickets={list.data} caption="Chamados" />
        </Card>
      ) : (
        <Card>
          <EmptyState icon={<Inbox size={32} strokeWidth={1.5} />} title="Nenhum chamado aqui" />
        </Card>
      )}
    </div>
  );
}
