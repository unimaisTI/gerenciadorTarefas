import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Mail } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { loginSchema, type MeDto } from '@hub/shared';
import { Button, Checkbox, Input } from '@/design-system';
import { api, errorMessage } from '@/lib/api';
import { ME_KEY, useMeQuery } from '@/lib/auth';
import { AuthLayout, GlassField } from './AuthLayout';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/** Só aceita caminhos internos no ?next= (evita redirecionamento para fora). */
function safeNext(next: string | null) {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMeQuery();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: () => api.post<MeDto>('/auth/login', { email, password, remember }),
    onSuccess: (data) => {
      queryClient.setQueryData(ME_KEY, data);
      void navigate(safeNext(params.get('next')), { replace: true });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });

  if (me.data) return <Navigate to={safeNext(params.get('next'))} replace />;

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password, remember });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
      return;
    }
    setError(null);
    login.mutate();
  };

  return (
    <AuthLayout title="Entrar no UniMais Hub" subtitle="Tarefas e chamados dos departamentos">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[15px]">
        <GlassField label="E-mail">
          <Input
            glass
            type="email"
            autoComplete="username"
            icon={<Mail {...ICON} />}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            required
          />
        </GlassField>
        <GlassField label="Senha">
          <Input
            glass
            type="password"
            autoComplete="current-password"
            icon={<Lock {...ICON} />}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            required
          />
        </GlassField>
        <div className="flex items-center justify-between gap-2.5 text-sm">
          <Checkbox
            label={<span className="text-white">Manter conectado</span>}
            checked={remember}
            onChange={(e) => {
              setRemember(e.target.checked);
            }}
          />
          <Link to="/esqueci-senha" className="text-white underline-offset-2 hover:text-white hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        {error && (
          <p role="alert" className="m-0 rounded-sm bg-red-600/90 px-[15px] py-2.5 text-sm text-white">
            {error}
          </p>
        )}
        <Button type="submit" variant="accent" size="lg" block disabled={login.isPending}>
          {login.isPending ? 'Entrando...' : 'Entrar'}
        </Button>
      </form>
    </AuthLayout>
  );
}
