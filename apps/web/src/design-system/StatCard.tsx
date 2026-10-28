import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'navy' | 'accent' | 'success' | 'warning';

const TONES: Record<Tone, string> = {
  navy: 'text-navy-700',
  accent: 'text-red-500',
  success: 'text-success',
  warning: 'text-warning-ink',
};

export interface StatCardProps {
  label: string;
  value: ReactNode;
  unit?: string;
  caption?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}

export function StatCard({
  label,
  value,
  unit,
  caption,
  tone = 'navy',
  icon,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'flex min-w-[180px] flex-col gap-2.5 rounded-md border border-subtle bg-card p-5 shadow-sm',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2.5">
        <span className="u-label">{label}</span>
        {icon && <span className={cn('flex', TONES[tone])}>{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1.5">
        <strong className={cn('font-title text-h3 font-bold leading-none', TONES[tone])}>
          {value}
        </strong>
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
      {caption && <span className="text-xs text-faint">{caption}</span>}
    </div>
  );
}
