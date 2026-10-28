import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number;
  children: ReactNode;
}

/** Foco preso no diálogo e Esc fecha (RNF-10). */
function useDialogFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
        ) ?? [],
      );
    (focusable().find((el) => el.dataset.autofocus !== undefined) ?? focusable()[1] ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab') {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    // A página por trás não rola enquanto o diálogo está aberto.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose]);
  return ref;
}

export function Modal({ open, title, onClose, footer, width = 520, children }: ModalProps) {
  const ref = useDialogFocus(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/42 p-5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-full w-full overflow-y-auto rounded-md bg-card shadow-lg outline-none"
        style={{ maxWidth: width }}
      >
        <header className="flex items-center justify-between gap-[15px] px-5 pt-5">
          <h2 id={titleId} className="m-0 text-[23px] font-bold">
            {title}
          </h2>
          <IconButton label="Fechar" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="p-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2.5 px-5 pb-5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export interface DrawerProps {
  open: boolean;
  label: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}

/** Painel lateral (detalhe da tarefa sem sair do quadro, RF-6.2). */
export function Drawer({ open, label, onClose, width = 720, children }: DrawerProps) {
  const ref = useDialogFocus(open, onClose);
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-40 flex justify-end bg-navy-900/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn('drawer-in h-full w-full overflow-y-auto bg-page shadow-lg outline-none')}
        style={{ maxWidth: width }}
      >
        {children}
      </div>
      <style>{`
        @keyframes drawer-in { from { transform: translateX(40px); opacity: .6 } to { transform: none; opacity: 1 } }
        .drawer-in { animation: drawer-in var(--dur-slow) var(--ease-out) }
      `}</style>
    </div>,
    document.body,
  );
}
