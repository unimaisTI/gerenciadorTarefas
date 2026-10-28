import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, { box: string; title: string }> = {
  info: { box: 'bg-info-050 border-navy-400', title: 'text-navy-700' },
  success: { box: 'bg-success-050 border-success', title: 'text-success' },
  warning: { box: 'bg-warning-050 border-warning', title: 'text-warning-ink' },
  danger: { box: 'bg-danger-050 border-red-500', title: 'text-red-600' },
};

export interface AlertBannerProps {
  tone?: Tone;
  title?: string;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function AlertBanner({ tone = 'info', title, action, className, children }: AlertBannerProps) {
  const t = TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-[15px] rounded-sm border-l-[3px] px-5 py-[15px]', t.box, className)}
    >
      <div className="flex flex-1 flex-col gap-0.5">
        {title && <strong className={cn('text-sm font-semibold', t.title)}>{title}</strong>}
        {children && <span className="text-sm text-body">{children}</span>}
      </div>
      {action}
    </div>
  );
}
