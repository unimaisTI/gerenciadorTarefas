import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps {
  title?: ReactNode;
  action?: ReactNode;
  /** Sem padding interno (ex.: tabela ocupando o card inteiro). */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

// Borda de 1px E sombra suave, sempre as duas juntas (RNF-15.3).
export function Card({ title, action, flush = false, className, children }: CardProps) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-md border border-subtle bg-card shadow-sm',
        className,
      )}
    >
      {(title ?? action) && (
        <header className="flex items-center justify-between gap-[15px] px-5 pt-5">
          {title && <h2 className="m-0 text-lg font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      <div className={flush ? undefined : 'p-5'}>{children}</div>
    </section>
  );
}
