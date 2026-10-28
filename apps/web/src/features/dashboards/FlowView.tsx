import { useQuery } from '@tanstack/react-query';
import { formatNumber, type FlowDashboardDto } from '@hub/shared';
import { Card, EmptyState, HBarChart, LineChart, Spinner, StatCard } from '@/design-system';
import { api, qs } from '@/lib/api';
import type { DashboardFilters } from './DashboardView';

/** Aba "Fluxo": onde o trabalho para, quanto demora e se o estoque aberto cresce. */
export function FlowView({ filters, big = false }: { filters: DashboardFilters; big?: boolean }) {
  const flow = useQuery({
    queryKey: ['dashboards', 'flow', filters],
    queryFn: () => api.get<FlowDashboardDto>(`/dashboards/flow${qs({ ...filters })}`),
    refetchInterval: 5 * 60_000,
  });
  if (flow.isPending) return <Spinner />;
  const d = flow.data;
  if (!d) return <EmptyState title="Não foi possível carregar o fluxo" />;
  const avgLead = d.leadTimeByWeek.length
    ? d.leadTimeByWeek.reduce((s, p) => s + p.value, 0) / d.leadTimeByWeek.length
    : 0;
  const slowest = d.timeInColumn[0];
  const statClass = big ? '[&_strong]:text-[50px]' : '';
  // Rótulos do eixo: no máximo ~10 para não embolar.
  const step = Math.max(1, Math.ceil(d.cfd.length / 10));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatCard className={statClass} label="Lead time médio" value={formatNumber(Math.round(avgLead * 10) / 10)} unit="dias" caption="Da criação à conclusão" />
        <StatCard
          className={statClass}
          label="Coluna mais lenta"
          value={slowest ? formatNumber(slowest.hours) : '—'}
          unit={slowest ? 'h em média' : undefined}
          caption={slowest ? slowest.label : 'Sem movimentações no período'}
          tone="warning"
        />
        <StatCard
          className={statClass}
          label="Chamados dentro do SLA"
          value={d.slaMetPct == null ? '—' : `${formatNumber(d.slaMetPct)}%`}
          caption={`${formatNumber(d.slaTotal)} entregues com SLA no período`}
          tone="success"
        />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Tempo médio em cada coluna (horas)">
          <HBarChart data={d.timeInColumn.map((t) => ({ key: t.label, label: t.label, value: t.hours, suffix: ' h' }))} />
        </Card>
        <Card title="Lead time por semana (dias)">
          <LineChart labels={d.leadTimeByWeek.map((p) => p.label)} series={[{ label: 'Dias', values: d.leadTimeByWeek.map((p) => p.value), colorVar: '--navy-700' }]} />
        </Card>
        <Card title="Fluxo acumulado: criadas × concluídas" className="xl:col-span-2">
          <LineChart
            labels={d.cfd.map((p, i) => (i % step === 0 ? p.day : ''))}
            series={[
              { label: 'Criadas (acumulado)', values: d.cfd.map((p) => p.created), colorVar: '--navy-700' },
              { label: 'Concluídas (acumulado)', values: d.cfd.map((p) => p.done), colorVar: '--success', dashed: true },
            ]}
            height={240}
          />
          <p className="mt-2.5 mb-0 text-xs text-muted">A distância entre as linhas é o trabalho em aberto. Se ela cresce, entra mais do que sai.</p>
        </Card>
      </div>
    </div>
  );
}
