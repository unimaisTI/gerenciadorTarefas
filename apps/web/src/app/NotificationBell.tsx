import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { formatDateTime, type NotificationDto } from '@hub/shared';
import { Avatar, Button, IconButton } from '@/design-system';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { keys } from '@/lib/queries';

export function useNotifications(limit = 30) {
  return useQuery({
    queryKey: [...keys.notifications, limit],
    queryFn: () => api.get<{ items: NotificationDto[]; unread: number }>(`/notifications?limit=${String(limit)}`),
    refetchInterval: 120_000,
  });
}

export function NotificationList({ items, onOpen }: { items: NotificationDto[]; onOpen: (n: NotificationDto) => void }) {
  if (!items.length) return <p className="m-0 p-5 text-center text-sm text-muted">Nenhuma notificação.</p>;
  return (
    <ul className="m-0 list-none p-0">
      {items.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => {
              onOpen(n);
            }}
            className={cn(
              'flex w-full cursor-pointer gap-2.5 border-0 border-b border-subtle bg-transparent px-[15px] py-2.5 text-left hover:bg-navy-050',
              !n.readAt && 'bg-navy-050/60',
            )}
          >
            <Avatar name={n.actor?.name ?? 'UniMais Hub'} src={n.actor?.avatarUrl} size={30} />
            <span className="min-w-0 flex-1">
              <span className={cn('block text-sm', n.readAt ? 'text-body' : 'font-semibold text-strong')}>
                {!n.readAt && <span className="sr-only">Não lida: </span>}
                {n.title}
              </span>
              {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
              <span className="block text-2xs text-faint">{formatDateTime(n.createdAt)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function useOpenNotification() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (n: NotificationDto) => {
    if (!n.readAt) {
      void api.post(`/notifications/${n.id}/read`).then(() => queryClient.invalidateQueries({ queryKey: keys.notifications }));
    }
    if (n.taskCode) void navigate(`/tarefas/${n.taskCode}`);
  };
}

// RF-8.5: sino com contador de não lidas e "marcar todas como lidas".
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const list = useNotifications();
  const openNotification = useOpenNotification();
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.notifications }),
  });
  const unread = list.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <IconButton
        label={unread ? `Notificações, ${String(unread)} não lidas` : 'Notificações'}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <Bell size={18} strokeWidth={1.75} />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] rounded-pill bg-red-500 px-1 text-center text-2xs leading-[18px] font-semibold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </IconButton>
      {open && (
        <div className="absolute top-11 right-0 z-40 w-[min(380px,calc(100vw-32px))] overflow-hidden rounded-md border border-subtle bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-subtle px-[15px] py-2.5">
            <strong className="font-title text-base text-strong">Notificações</strong>
            <Button variant="ghost" size="sm" disabled={!unread || readAll.isPending} onClick={() => { readAll.mutate(); }}>
              Marcar todas como lidas
            </Button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            <NotificationList
              items={list.data?.items ?? []}
              onOpen={(n) => {
                setOpen(false);
                openNotification(n);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
