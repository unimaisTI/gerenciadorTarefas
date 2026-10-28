import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { isWeekend } from '@hub/shared';
import { api } from '@/lib/api';

/** RF-14.15: avisa (sem bloquear) quando o prazo cai em fim de semana ou feriado. */
export function DueDateWarning({ date }: { date: string | null | undefined }) {
  const holiday = useQuery({
    queryKey: ['holiday', date],
    queryFn: () => api.get<{ holiday: string | null }>(`/calendar/holiday?date=${date ?? ''}`),
    enabled: Boolean(date),
    staleTime: Infinity,
  });
  if (!date) return null;
  const reason = holiday.data?.holiday ?? (isWeekend(date) ? 'fim de semana' : null);
  if (!reason) return null;
  return (
    <span role="status" className="inline-flex items-center gap-1 text-xs text-warning-ink">
      <TriangleAlert size={12} aria-hidden="true" />
      Prazo cai em {reason}.
    </span>
  );
}
