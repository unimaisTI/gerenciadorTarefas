import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  NOTIFICATION_TYPE_LABELS,
  ROLE_LABELS,
  changePasswordSchema,
  type EmailEvent,
  type MeDto,
} from '@hub/shared';
import { Avatar, Button, Card, Field, Input, Spinner, Switch, useToast } from '@/design-system';
import { api, errorMessage } from '@/lib/api';
import { ME_KEY, useAuth } from '@/lib/auth';
import { PageHeader } from '@/lib/ui';

/** RF-4.7: foto, telefone, senha e preferências de notificação (RF-8.10). */
export function ProfilePage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [phone, setPhone] = useState(me.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState(me.avatarUrl ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.patch<MeDto>('/me', { phone: phone || null, avatarUrl: avatarUrl || null }),
    onSuccess: (data) => {
      queryClient.setQueryData(ME_KEY, data);
      toast('Perfil atualizado.');
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  const password = useMutation({
    mutationFn: () => api.post('/me/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      toast('Senha alterada. As outras sessões foram encerradas.');
    },
    onError: (e) => {
      setPwError(errorMessage(e));
    },
  });
  const prefs = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: () => api.get<{ eventType: EmailEvent; emailEnabled: boolean }[]>('/me/notification-prefs'),
  });
  const savePrefs = useMutation({
    mutationFn: (list: { eventType: EmailEvent; emailEnabled: boolean }[]) => api.put('/me/notification-prefs', { prefs: list }),
    onSuccess: (_d, list) => {
      queryClient.setQueryData(['notification-prefs'], list);
    },
  });

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="Meu perfil" />
      <Card title="Dados">
        <div className="mb-5 flex items-center gap-[15px]">
          <Avatar name={me.name} src={avatarUrl || null} size={64} />
          <div>
            <div className="font-semibold text-strong">{me.name}</div>
            <div className="text-sm text-muted">{me.email} · {ROLE_LABELS[me.role]}</div>
            <div className="text-xs text-muted">{me.memberships.map((m) => m.departmentName).join(', ')}</div>
          </div>
        </div>
        <form
          className="grid grid-cols-1 gap-[15px] sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Telefone / ramal">
            <Input value={phone} maxLength={40} onChange={(e) => { setPhone(e.target.value); }} />
          </Field>
          <Field label="Endereço da foto" hint="Link https de uma imagem.">
            <Input type="url" value={avatarUrl} onChange={(e) => { setAvatarUrl(e.target.value); }} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>Salvar</Button>
          </div>
        </form>
      </Card>
      <Card title="Senha">
        <form
          className="grid grid-cols-1 gap-[15px] sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = changePasswordSchema.safeParse({ currentPassword: current, newPassword: next });
            if (!parsed.success) {
              setPwError(parsed.error.issues[0]?.message ?? 'Senha inválida.');
              return;
            }
            setPwError(null);
            password.mutate();
          }}
        >
          <Field label="Senha atual">
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); }} />
          </Field>
          <Field label="Nova senha" hint="Mínimo de 8 caracteres, com letras e números." error={pwError ?? undefined}>
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); }} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={password.isPending}>Alterar senha</Button>
          </div>
        </form>
      </Card>
      <Card title="Notificações por e-mail">
        {prefs.isPending ? (
          <Spinner />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {(prefs.data ?? []).map((p) => (
              <li key={p.eventType}>
                <Switch
                  checked={p.emailEnabled}
                  label={NOTIFICATION_TYPE_LABELS[p.eventType]}
                  onChange={(v) => {
                    savePrefs.mutate((prefs.data ?? []).map((x) => (x.eventType === p.eventType ? { ...x, emailEnabled: v } : x)));
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-[15px] mb-0 text-xs text-muted">As notificações dentro do sistema continuam ativas.</p>
      </Card>
    </div>
  );
}
