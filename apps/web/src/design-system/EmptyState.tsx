import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2.5 px-5 py-[50px] text-center',
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="mb-[5px] flex text-navy-200">
          {icon}
        </span>
      )}
      <strong className="font-title text-lg font-semibold text-strong">{title}</strong>
      {description && <span className="max-w-[360px] text-sm text-muted">{description}</span>}
      {action && <div className="pt-2.5">{action}</div>}
    </div>
  );
}
