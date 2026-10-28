import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TopBarProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

// Barra branca de 68px com busca global, sino e avatar (RNF-15.2).
export function TopBar({ title, subtitle, search, actions, className }: TopBarProps) {
  return (
    <header
      className={cn(
        'box-border flex h-topbar items-center gap-5 border-b border-subtle bg-card px-5',
        className,
      )}
    >
      {(title ?? subtitle) && (
        <div className="flex min-w-0 flex-col gap-px">
          {title && <strong className="font-title text-lg font-bold text-strong">{title}</strong>}
          {subtitle && <span className="text-xs text-faint">{subtitle}</span>}
        </div>
      )}
      {search && <div className="max-w-[380px] flex-1">{search}</div>}
      <div className="ml-auto flex items-center gap-2.5">{actions}</div>
    </header>
  );
}
