import {
  Building2,
  CalendarDays,
  ChartColumn,
  House,
  Inbox,
  ListChecks,
  Keyboard,
  Menu,
  Send,
  Settings,
  SquareKanban,
} from 'lucide-react';
import { Fragment, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { permissions } from '@hub/shared';
import { Drawer, IconButton, Modal, SidebarNav, TopBar, type SidebarNavItem } from '@/design-system';
import { SHORTCUTS, useHotkey } from '@/lib/hotkeys';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

function useNavItems(): SidebarNavItem[] {
  const { me, viewer } = useAuth();
  // Um departamento só: o item leva o nome dele e abre direto no quadro Kanban.
  // Dois ou mais (ou nenhum): aparece "Departamentos" para escolher.
  const [only] = me.memberships;
  const departmentItem: SidebarNavItem =
    me.memberships.length === 1 && only
      ? { to: `/projetos/${only.acronym}`, label: only.departmentName, icon: <SquareKanban {...ICON} /> }
      : { to: '/departamentos', label: 'Departamentos', icon: <Building2 {...ICON} /> };
  const items: SidebarNavItem[] = [
    { to: '/', label: 'Início', icon: <House {...ICON} />, end: true },
    departmentItem,
    { to: '/minhas-tarefas', label: 'Minhas tarefas', icon: <ListChecks {...ICON} /> },
    { to: '/chamados', label: 'Meus chamados', icon: <Inbox {...ICON} />, end: true },
  ];
  // Chamado sai de um departamento solicitante: quem não tem departamento (admin geral) não abre.
  if (permissions.openTicket(viewer) && me.memberships.length > 0) {
    items.push({ to: '/chamados/novo', label: 'Abrir chamado', icon: <Send {...ICON} /> });
  }
  items.push({ to: '/calendario', label: 'Calendário', icon: <CalendarDays {...ICON} /> });
  if (permissions.viewDashboards(viewer) || viewer.role === 'observador') {
    items.push({ to: '/dashboards', label: 'Dashboards', icon: <ChartColumn {...ICON} /> });
  }
  if (permissions.manageUsers(viewer)) {
    items.push({ to: '/admin', label: 'Administração', icon: <Settings {...ICON} /> });
  }
  return items;
}

function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="Atalhos de teclado" onClose={onClose} width={440}>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm">
        {SHORTCUTS.map((s) => (
          <Fragment key={s.keys}>
            <dt>
              <kbd className="rounded-xs border border-strong-border bg-gray-050 px-2 py-0.5 font-code text-xs">{s.keys}</kbd>
            </dt>
            <dd className="m-0">{s.description}</dd>
          </Fragment>
        ))}
      </dl>
    </Modal>
  );
}

export function AppLayout() {
  useRealtime();
  const [shortcuts, setShortcuts] = useState(false);
  useHotkey('/', () => document.getElementById('global-search')?.focus());
  useHotkey('?', () => { setShortcuts(true); });
  const items = useNavItems();
  const location = useLocation();
  const [mobileNav, setMobileNav] = useState<string | null>(null);
  // Fecha o menu do celular ao navegar.
  const navOpen = mobileNav === location.pathname;

  return (
    <div className="flex min-h-svh">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2.5">
        Pular para o conteúdo
      </a>
      <SidebarNav items={items} className="sticky top-0 hidden h-svh lg:flex" />
      <Drawer open={navOpen} label="Menu" onClose={() => { setMobileNav(null); }} width={248}>
        <SidebarNav items={items} className="h-full w-full" />
      </Drawer>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          className="sticky top-0 z-30"
          title={
            <span className="flex items-center gap-2.5 lg:hidden">
              <IconButton label="Abrir menu" onClick={() => { setMobileNav(location.pathname); }}>
                <Menu size={18} />
              </IconButton>
            </span>
          }
          search={<GlobalSearch />}
          actions={
            <>
              {/* Sem teclado no celular: o botão só aparece em telas maiores. */}
              <span className="hidden sm:flex">
                <IconButton label="Atalhos de teclado (?)" onClick={() => { setShortcuts(true); }}>
                  <Keyboard size={18} strokeWidth={1.75} />
                </IconButton>
              </span>
              <NotificationBell />
              <UserMenu />
            </>
          }
        />
        <main id="conteudo" className="mx-auto w-full max-w-[1400px] flex-1 p-4 sm:p-5">
          <Outlet />
        </main>
      </div>
      <ShortcutsModal open={shortcuts} onClose={() => { setShortcuts(false); }} />
    </div>
  );
}
