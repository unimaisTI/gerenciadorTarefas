import { useQueryClient } from '@tanstack/react-query';
import { LogOut, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ROLE_LABELS } from '@hub/shared';
import { Avatar } from '@/design-system';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function UserMenu() {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    queryClient.clear();
    void navigate('/entrar', { replace: true });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Menu do usuário"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="flex cursor-pointer items-center gap-2.5 rounded-pill border-0 bg-transparent p-0.5 hover:bg-navy-050"
      >
        <Avatar name={me.name} src={me.avatarUrl} size={34} />
        <span className="hidden flex-col text-left leading-tight md:flex">
          <span className="text-sm font-semibold text-strong">{me.name.split(' ')[0]}</span>
          <span className="text-2xs text-muted">{ROLE_LABELS[me.role]}</span>
        </span>
      </button>
      {open && (
        <div className="absolute top-12 right-0 z-40 w-56 overflow-hidden rounded-md border border-subtle bg-card py-1 shadow-lg">
          <div className="border-b border-subtle px-[15px] py-2.5">
            <div className="truncate text-sm font-semibold text-strong">{me.name}</div>
            <div className="truncate text-xs text-muted">{me.email}</div>
          </div>
          <Link
            to="/perfil"
            onClick={() => {
              setOpen(false);
            }}
            className="flex items-center gap-2.5 px-[15px] py-2.5 text-sm text-body no-underline hover:bg-navy-050 hover:text-navy-700"
          >
            <UserRound size={16} aria-hidden="true" /> Meu perfil
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-[15px] py-2.5 text-left text-sm text-body hover:bg-navy-050 hover:text-navy-700"
          >
            <LogOut size={16} aria-hidden="true" /> Sair
          </button>
        </div>
      )}
    </div>
  );
}
