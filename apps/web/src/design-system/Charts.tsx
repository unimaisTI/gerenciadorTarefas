import { formatNumber } from '@hub/shared';
import { cn } from '@/lib/cn';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Cor (classe Tailwind de fundo) opcional por barra, ex. cor do departamento. */
  colorClass?: string;
  suffix?: string;
}

/**
 * Barras horizontais (StatCard + BarChart do design system, RF-10.18). Cada barra é um botão
 * quando há onSelect, para abrir a lista que forma o número (RF-10.11). Valor sempre em texto.
 */
export function HBarChart({
  data,
  max,
  onSelect,
  empty = 'Sem dados no período.',
}: {
  data: BarDatum[];
  max?: number;
  onSelect?: (d: BarDatum) => void;
  empty?: string;
}) {
  if (!data.length) return <p className="m-0 py-5 text-center text-sm text-muted">{empty}</p>;
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {data.map((d) => {
        const content = (
          <>
            <span className="w-36 shrink-0 truncate text-left text-sm text-body" title={d.label}>
              {d.label}
            </span>
            <span className="h-3 flex-1 overflow-hidden rounded-pill bg-gray-100">
              <span
                className={cn('block h-full rounded-pill', d.colorClass ?? 'bg-navy-700')}
                style={{ width: `${Math.max(2, (d.value / top) * 100)}%` }}
              />
            </span>
            <span className="w-14 shrink-0 text-right text-sm font-semibold text-strong">
              {formatNumber(d.value)}
              {d.suffix}
            </span>
          </>
        );
        return (
          <li key={d.key}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => {
                  onSelect(d);
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-xs border-0 bg-transparent p-0.5 hover:bg-navy-050"
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center gap-2.5 p-0.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface LineSeries {
  label: string;
  values: number[];
  colorVar: string;
  dashed?: boolean;
}

/** Linha com uma ou duas séries (componente novo com os tokens do design system). */
export function LineChart({ labels, series, height = 200 }: { labels: string[]; series: LineSeries[]; height?: number }) {
  if (!labels.length) return <p className="m-0 py-5 text-center text-sm text-muted">Sem dados no período.</p>;
  const width = 600;
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => pad.l + (labels.length === 1 ? 0 : (i * (width - pad.l - pad.r)) / (labels.length - 1));
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const ticks = [0, Math.round(max / 2), max];
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={series.map((s) => s.label).join(' e ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--gray-200)" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--gray-500)">
              {formatNumber(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={l + String(i)} x={x(i)} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--gray-500)">
            {l}
          </text>
        ))}
        {series.map((s) => (
          <g key={s.label}>
            <polyline
              fill="none"
              stroke={`var(${s.colorVar})`}
              strokeWidth="2.5"
              strokeDasharray={s.dashed ? '6 4' : undefined}
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
            />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill={`var(${s.colorVar})`}>
                <title>{`${s.label} — ${labels[i] ?? ''}: ${formatNumber(v)}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="flex justify-center gap-5 pt-1 text-xs text-muted">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden="true">
              <line x1="0" x2="18" y1="3" y2="3" stroke={`var(${s.colorVar})`} strokeWidth="2.5" strokeDasharray={s.dashed ? '4 3' : undefined} />
            </svg>
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Matriz solicitante × executor (componente novo). Linhas = quem pede; colunas = quem executa. */
export function FlowMatrix({
  departments,
  counts,
  onSelect,
}: {
  departments: { id: string; acronym: string }[];
  counts: number[][];
  onSelect?: (fromId: string, toId: string) => void;
}) {
  if (!departments.length) return <p className="m-0 py-5 text-center text-sm text-muted">Sem chamados no período.</p>;
  const max = Math.max(1, ...counts.flat());
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <caption className="pb-2 text-left text-xs text-muted">Linhas: quem pede · Colunas: quem executa</caption>
        <thead>
          <tr>
            <th scope="col" className="p-2" />
            {departments.map((d) => (
              <th key={d.id} scope="col" className="u-label p-2 text-center">
                {d.acronym}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {departments.map((from, i) => (
            <tr key={from.id}>
              <th scope="row" className="u-label p-2 text-right">
                {from.acronym}
              </th>
              {departments.map((to, j) => {
                const n = counts[i]?.[j] ?? 0;
                const strength = n / max;
                return (
                  <td key={to.id} className="p-1">
                    <button
                      type="button"
                      disabled={!n || !onSelect}
                      onClick={() => onSelect?.(from.id, to.id)}
                      aria-label={`${from.acronym} pediu ${n} para ${to.acronym}`}
                      className="flex size-14 cursor-pointer items-center justify-center rounded-sm border border-subtle font-semibold disabled:cursor-default"
                      style={{
                        background: n ? `color-mix(in oklab, var(--navy-700) ${Math.round(12 + strength * 70)}%, white)` : 'var(--gray-050)',
                        color: strength > 0.5 ? 'var(--white)' : 'var(--navy-900)',
                      }}
                    >
                      {formatNumber(n)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
