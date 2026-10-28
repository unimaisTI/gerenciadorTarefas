import { useQuery } from '@tanstack/react-query';
import { AlarmClock, CalendarCheck, Inbox } from 'lucide-react';
import { Link } from 'react-router';
import { formatNumber, type HomeDashboardDto } from '@hub/shared';
import { Card, EmptyState, Spinner, StatCard } from '@/design-system';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys } from '@/lib/queries';
import { PageHeader } from '@/lib/ui';
import { NotificationList, useOpenNotification } from '@/app/NotificationBell';
import { TaskTable } from '../tasks/MyTasksPage';
import { TicketTable } from '../tickets/MyTicketsPage';

/** RF-10.1: tarefas de hoje, atrasadas, chamados aguardando aprovação e últimas notificações. */
export function HomePage() {
  const { me } = useAuth();
  const openNotification = useOpenNotification();
  const home = useQuery({ queryKey: keys.home, queryFn: () => api.get<HomeDashboardDto>('/dashboard/home') });
  const d = home.data;
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()));
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={`${greeting}, ${me.name.split(' ')[0] ?? ''}`} subtitle="O que precisa da sua atenção hoje." />
      {home.isPending || !d ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <StatCard label="Para hoje" value={formatNumber(d.today.length)} icon={<CalendarCheck size={18} />} />
            <StatCard
              label="Atrasadas"
              value={formatNumber(d.overdue.length)}
              tone={d.overdue.length ? 'accent' : 'navy'}
              icon={<AlarmClock size={18} />}
              caption={d.overdue.length ? 'Prazo vencido' : 'Nada atrasado'}
            />
            <StatCard
              label="Aguardando minha aprovação"
              value={formatNumber(d.awaitingMyApproval.length)}
              tone={d.awaitingMyApproval.length ? 'warning' : 'navy'}
              icon={<Inbox size={18} />}
            />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
            <div className="flex min-w-0 flex-col gap-5">
              {d.overdue.length > 0 && (
                <Card title="Atrasadas" flush>
                  <TaskTable tasks={d.overdue} caption="Tarefas atrasadas" />
                </Card>
              )}
              <Card title="Minhas tarefas de hoje" flush action={<Link to="/minhas-tarefas" className="text-sm">Ver todas</Link>}>
                {d.today.length ? <TaskTable tasks={d.today} caption="Tarefas de hoje" /> : <EmptyState title="Nada vence hoje" />}
              </Card>
              <Card title="Chamados aguardando minha aprovação" flush>
                {d.awaitingMyApproval.length ? (
                  <TicketTable tickets={d.awaitingMyApproval} caption="Aguardando aprovação" />
                ) : (
                  <EmptyState title="Nenhum chamado aguardando você" />
                )}
              </Card>
            </div>
            <Card title="Últimas notificações" flush>
              <NotificationList items={d.notifications} onOpen={openNotification} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
