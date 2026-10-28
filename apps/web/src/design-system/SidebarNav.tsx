import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import logoBranca from '@/assets/logo-unimais-branca.png';
import { cn } from '@/lib/cn';

export interface SidebarNavItem {
  to: string;
  label: string;
  icon?: ReactNode;
  badge?: number;
  /** Só marca ativo na rota exata (ex.: "/"). */
  end?: boolean;
}

export interface SidebarNavProps {
  items: SidebarNavItem[];
  footer?: ReactNode;
  className?: string;
}

// Barra navy fixa de 248px; item ativo marcado pelo filete vermelho de 3px (RNF-15.1).
export function SidebarNav({ items, footer, className }: SidebarNavProps) {
  return (
    <nav
      aria-label="Menu principal"
      className={cn(
        'box-border flex w-sidebar shrink-0 flex-col bg-inverse px-[15px] py-5 text-white/72',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-2.5 pb-[30px]">
        <img src={logoBranca} alt="UNIMAIS" className="h-[34px] w-auto" />
      </div>
      <ul className="m-0 flex flex-1 list-none flex-col gap-0.5 p-0">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) =>
                cn(
                  'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2.5 text-sm no-underline',
                  'transition-colors duration-[var(--dur-fast)] ease-out',
                  isActive
                    ? 'bg-white/10 font-semibold text-white shadow-[inset_3px_0_0_0_var(--red-500)] hover:text-white'
                    : 'text-white/72 hover:bg-white/10 hover:text-white',
                )
              }
            >
              {item.icon && (
                <span aria-hidden="true" className="flex w-[18px]">
                  {item.icon}
                </span>
              )}
              {item.label}
              {item.badge != null && item.badge > 0 && (
                <span className="ml-auto rounded-pill bg-red-500 px-[7px] py-px text-2xs text-white">
                  {item.badge}
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
      {footer && <div className="border-t border-white/12 pt-5">{footer}</div>}
    </nav>
  );
}
