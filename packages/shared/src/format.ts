// RNF-08: datas dd/mm/aaaa no fuso America/Sao_Paulo; números no padrão brasileiro.

export const TIME_ZONE = 'America/Sao_Paulo';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const numberFormatter = new Intl.NumberFormat('pt-BR');

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Aceita instante (Date/ISO com hora) ou data pura "AAAA-MM-DD". Data pura não passa por fuso:
 * "2026-10-28" é sempre 28/10/2026.
 */
export function formatDate(value: Date | string): string {
  if (typeof value === 'string') {
    const m = DATE_ONLY.exec(value);
    if (m) return `${m[3] ?? ''}/${m[2] ?? ''}/${m[1] ?? ''}`;
  }
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: Date | string): string {
  return dateTimeFormatter.format(new Date(value)).replace(',', '');
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
}

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo. */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

/** Converte um instante na data (AAAA-MM-DD) correspondente em São Paulo. */
export function toIsoDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
  return parts;
}

/** Soma dias a uma data pura AAAA-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** RF-14.15: o prazo cai em fim de semana? (feriados são checados à parte). */
export function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** "2ª revisão" no cartão do chamado (RF-7.7). */
export function revisionLabel(revisionCount: number): string | null {
  return revisionCount > 0 ? `${revisionCount + 1}ª revisão` : null;
}
