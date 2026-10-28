import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  formatDate,
  formatNumber,
  type DashboardDto,
  type DrilldownItemDto,
  type MetricDto,
} from '@hub/shared';
import {
  Card,
  DataTable,
  EmptyState,
  FlowMatrix,
  HBarChart,
  LineChart,
  Modal,
  Spinner,
  StatCard,
} from '@/design-system';
import { api, qs } from '@/lib/api';
import { DEPT_BG } from '@/lib/ui';
import { FlowView } from './FlowView';

export type DashboardTab = 'geral' | 'departamento' | 'chamados' | 'pessoas' | 'fluxo';

export interface DashboardFilters {
  from: string;
  to: string;
  departmentId?: string | undefined;
  projectId?: string | undefined;
}

/** RF-10.10: comparação com o período anterior, em texto (ex.: "+12% em relação a ..."). */
function comparison(m: MetricDto, previousLabel: string): string {
  if (m.previous === null || m.previous === 0) {
    return m.previous === 0 && m.value > 0 ? `novo em relação a ${previousLabel}` : `sem base em ${previousLabel}`;
  }
  const pct = Math.round(((m.value - m.previous) / m.previous) * 100);
  if (pct === 0) return `igual a ${previousLabel}`;
  return `${pct > 0 ? '+' : ''}${String(pct)}% em relação a ${previousLabel}`;
}

interface Drill {
  title: string;
  metric: string;
  key?: string;
  key2?: string;
}

/** Cartões e gráficos da área de Dashboards (RF-10.8 e tabela de indicadores). */
export function DashboardView({ filters, tab, big = false }: { filters: DashboardFilters; tab: DashboardTab; big?: boolean }) {
  if (tab === 'fluxo') return <FlowView filters={filters} big={big} />;
  return <IndicatorsView filters={filters} tab={tab} big={big} />;
}

function IndicatorsView({ filters, tab, big }: { filters: DashboardFilters; tab: Exclude<DashboardTab, 'fluxo'>; big: boolean }) {
  const navigate = useNavigate();
  const [drill, setDrill] = useState<Drill | null>(null);
  const data = useQuery({
    queryKey: ['dashboards', filters],
    queryFn: () => api.get<DashboardDto>(`/dashboards${qs({ ...filters })}`),
    refetchInterval: 5 * 60_000, // RF-10.17
  });
  const drillData = useQuery({
    queryKey: ['drilldown', filters, drill],
    queryFn: () => api.get<DrilldownItemDto[]>(`/dashboards/drilldown${qs({ ...filters, metric: drill?.metric, key: drill?.key, key2: drill?.key2 })}`),
    enabled: drill !== null,
  });

  if (data.isPending) return <Spinner />;
  const d = data.data;
  if (!d) return <EmptyState title="Não foi possível carregar os indicadores" />;
  const prevLabel = `${formatDate(d.period.previousFrom)} a ${formatDate(d.period.previousTo)}`;
  const statClass = big ? '[&_strong]:text-[50px]' : '';

  const statRow = (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-5">
      <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left" onClick={() => { setDrill({ title: 'Chamados abertos', metric: 'tickets_opened' }); }}>
        <StatCard className={statClass} label="Chamados abertos" value={formatNumber(d.ticketsOpened.value)} caption={comparison(d.ticketsOpened, prevLabel)} />
      </button>
      <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left" onClick={() => { setDrill({ title: 'Chamados aprovados', metric: 'tickets_approved' }); }}>
        <StatCard className={statClass} label="Chamados aprovados" value={formatNumber(d.ticketsApproved.value)} tone="success" caption={comparison(d.ticketsApproved, prevLabel)} />
      </button>
      <StatCard className={statClass} label="Tempo médio de atendimento" value={formatNumber(d.avgResolutionDays.value)} unit="dias úteis" caption={comparison(d.avgResolutionDays, prevLabel)} />
      <StatCard className={statClass} label="Aprovação na 1ª entrega" value={`${formatNumber(d.firstPassApprovalPct.value)}%`} caption={comparison(d.firstPassApprovalPct, prevLabel)} />
      <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left" onClick={() => { setDrill({ title: 'Tarefas atrasadas agora', metric: 'overdue' }); }}>
        <StatCard
          className={statClass}
          label="Tarefas atrasadas agora"
          value={formatNumber(d.overdueNow)}
          tone={d.overdueNow > 0 ? 'accent' : 'navy'}
          caption={`${formatNumber(d.dueNext7Days)} vencem nos próximos 7 dias`}
        />
      </button>
    </div>
  );

  const sections: Record<Exclude<DashboardTab, 'fluxo'>, React.ReactNode> = {
    geral: (
      <>
        {statRow}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card title="Abertas × concluídas por semana">
            <LineChart
              labels={d.openedVsDone.map((w) => w.week)}
              series={[
                { label: 'Abertas', values: d.openedVsDone.map((w) => w.opened), colorVar: '--navy-700' },
                { label: 'Concluídas', values: d.openedVsDone.map((w) => w.done), colorVar: '--success', dashed: true },
              ]}
            />
          </Card>
          <Card title="Entregas no prazo por departamento">
            <HBarChart
              max={100}
              data={d.onTimeByDepartment.map((o) => ({ key: o.departmentId, label: `${o.label} (${formatNumber(o.total)})`, value: o.pct, suffix: '%', colorClass: DEPT_BG[o.color] }))}
            />
          </Card>
          <Card title="Pendências por status">
            <HBarChart data={d.pendingByStatus.map((p) => ({ key: p.label, label: p.label, value: p.value }))} />
          </Card>
          <Card title="Chamados entre departamentos">
            <FlowMatrix
              departments={d.flowMatrix.departments}
              counts={d.flowMatrix.counts}
              onSelect={(from, to) => {
                setDrill({ title: 'Chamados entre departamentos', metric: 'flow', key: from, key2: to });
              }}
            />
          </Card>
        </div>
      </>
    ),
    departamento: (
      <>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard className={statClass} label="Chamados recebidos" value={formatNumber(d.ticketsReceived.value)} caption={comparison(d.ticketsReceived, prevLabel)} />
          <StatCard className={statClass} label="Chamados enviados" value={formatNumber(d.ticketsSent.value)} caption={comparison(d.ticketsSent, prevLabel)} />
          <StatCard className={statClass} label="Devoluções por chamado" value={formatNumber(d.avgReturnsPerTicket.value)} caption={comparison(d.avgReturnsPerTicket, prevLabel)} />
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left" onClick={() => { setDrill({ title: 'Tarefas atrasadas', metric: 'overdue' }); }}>
            <StatCard className={statClass} label="Atrasadas" value={formatNumber(d.overdueNow)} tone={d.overdueNow ? 'accent' : 'navy'} caption={`${formatNumber(d.dueNext7Days)} vencem em 7 dias`} />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card title="Tarefas abertas por status">
            <HBarChart
              data={d.openByStatus.map((s) => ({ key: s.label, label: s.label, value: s.value }))}
              onSelect={(b) => {
                setDrill({ title: `Tarefas: ${b.label}`, metric: 'open_by_status', key: b.label === 'A fazer' ? 'todo' : 'doing' });
              }}
            />
          </Card>
          <Card title="Tempo médio de atendimento por semana (dias úteis)">
            <LineChart labels={d.resolutionByWeek.map((r) => r.label)} series={[{ label: 'Dias úteis', values: d.resolutionByWeek.map((r) => r.value), colorVar: '--navy-700' }]} />
          </Card>
        </div>
      </>
    ),
    chamados: (
      <>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard className={statClass} label="Abertos" value={formatNumber(d.ticketsOpened.value)} caption={comparison(d.ticketsOpened, prevLabel)} />
          <StatCard className={statClass} label="Aprovados" value={formatNumber(d.ticketsApproved.value)} tone="success" caption={comparison(d.ticketsApproved, prevLabel)} />
          <StatCard className={statClass} label="Aprovação na 1ª entrega" value={`${formatNumber(d.firstPassApprovalPct.value)}%`} caption={comparison(d.firstPassApprovalPct, prevLabel)} />
          <StatCard className={statClass} label="Devoluções por chamado" value={formatNumber(d.avgReturnsPerTicket.value)} caption={comparison(d.avgReturnsPerTicket, prevLabel)} />
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card title="Quem pede para quem">
            <FlowMatrix
              departments={d.flowMatrix.departments}
              counts={d.flowMatrix.counts}
              onSelect={(from, to) => {
                setDrill({ title: 'Chamados entre departamentos', metric: 'flow', key: from, key2: to });
              }}
            />
          </Card>
          <Card title="Tipos de chamado mais pedidos">
            <HBarChart data={d.ticketsByType.map((t) => ({ key: t.label, label: t.label, value: t.value }))} />
          </Card>
          <Card title="Tempo médio de atendimento por semana (dias úteis)">
            <LineChart labels={d.resolutionByWeek.map((r) => r.label)} series={[{ label: 'Dias úteis', values: d.resolutionByWeek.map((r) => r.value), colorVar: '--navy-700' }]} />
          </Card>
        </div>
      </>
    ),
    pessoas: (
      <Card title="Carga por responsável (itens abertos com prazo no período)">
        <HBarChart
          data={d.loadByAssignee.map((l) => ({ key: l.userId, label: l.label, value: l.value }))}
          onSelect={(b) => {
            setDrill({ title: `Carga: ${b.label}`, metric: 'by_assignee', key: b.key });
          }}
        />
      </Card>
    ),
  };

  return (
    <div className="flex flex-col gap-5">
      {sections[tab]}
      <Modal open={drill !== null} title={drill?.title ?? ''} onClose={() => { setDrill(null); }} width={820}>
        {drillData.isPending ? (
          <Spinner />
        ) : (
          <DataTable
            caption={drill?.title}
            rows={drillData.data ?? []}
            rowKey={(r) => r.code}
            onRowClick={(r) => void navigate(`/tarefas/${r.code}`)}
            empty={<EmptyState title="Nenhum item" />}
            columns={[
              { key: 'code', header: 'Código', sortValue: (r) => r.code, render: (r) => <span className="font-semibold text-navy-700">{r.code}</span> },
              { key: 'title', header: 'Título', render: (r) => <span className="whitespace-normal">{r.title}</span> },
              { key: 'status', header: 'Status', render: (r) => r.status },
              { key: 'assignee', header: 'Responsável', render: (r) => r.assignee ?? '—' },
              { key: 'due', header: 'Prazo', sortValue: (r) => r.dueDate, render: (r) => (r.dueDate ? formatDate(r.dueDate) : '—') },
            ]}
          />
        )}
      </Modal>
    </div>
  );
}
