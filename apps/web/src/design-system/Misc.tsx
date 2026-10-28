import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}

/** Avatar com iniciais quando não há foto. */
export function Avatar({ name, src, size = 28, className }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return src ? (
    <img
      src={src}
      alt={name}
      title={name}
      className={cn('shrink-0 rounded-full object-cover', className)}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-navy-100 font-semibold text-navy-700',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
    >
      {initials}
    </span>
  );
}

export interface TabsProps<T extends string> {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
  label: string;
}

export function Tabs<T extends string>({ tabs, active, onChange, label }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-subtle">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          onClick={() => {
            onChange(t.id);
          }}
          className={cn(
            '-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-[15px] py-2.5 text-sm transition-colors',
            t.id === active
              ? 'border-navy-700 font-semibold text-navy-700'
              : 'border-transparent text-muted hover:text-navy-700',
          )}
        >
          {t.label}
          {t.count != null && (
            <span className="ml-1.5 rounded-pill bg-navy-050 px-1.5 text-xs text-navy-700">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2.5 p-5 text-sm text-muted">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-navy-100 border-t-navy-700"
      />
      {label}
    </div>
  );
}

// Avisos rápidos ("Tarefa salva", erros da API).
interface Toast {
  id: number;
  tone: 'success' | 'danger' | 'info';
  text: string;
}
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed right-5 bottom-5 z-[60] flex max-w-sm flex-col gap-2.5">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'danger' ? 'alert' : 'status'}
            className={cn(
              'rounded-sm border-l-[3px] bg-card px-5 py-3 text-sm shadow-lg',
              t.tone === 'success' && 'border-success',
              t.tone === 'danger' && 'border-red-500',
              t.tone === 'info' && 'border-navy-400',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
