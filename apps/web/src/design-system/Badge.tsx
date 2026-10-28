import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'navy' | 'success' | 'warning' | 'danger';

const TONES: Record<BadgeTone, { box: string; dot: string }> = {
  neutral: { box: 'bg-gray-100 text-gray-600', dot: 'bg-gray-600' },
  navy: { box: 'bg-navy-050 text-navy-700', dot: 'bg-navy-700' },
  success: { box: 'bg-success-050 text-success', dot: 'bg-success' },
  warning: { box: 'bg-warning-050 text-warning-ink', dot: 'bg-warning' },
  danger: { box: 'bg-danger-050 text-red-600', dot: 'bg-red-600' },
};

export interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', dot = false, className, children }: BadgeProps) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] whitespace-nowrap rounded-pill px-2.5 py-[3px] text-xs font-medium leading-[1.4]',
        t.box,
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cn('size-1.5 rounded-full', t.dot)} />}
      {children}
    </span>
  );
}
