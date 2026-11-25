import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, LogIn, Mail } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { loginSchema, type AuthProvidersDto, type MeDto } from '@hub/shared';
import { Button, Checkbox, Input } from '@/design-system';
import { api, errorMessage } from '@/lib/api';
import { ME_KEY, useMeQuery } from '@/lib/auth';
import { AuthLayout, GlassField } from './AuthLayout';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/** Erros devolvidos pela volta do Google (?erro=...). */
const GOOGLE_ERRORS: Record<string, string> = {
  google: 'Não foi possível entrar com o Google. Tente de novo.',
  google_dominio: 'Use a sua conta institucional do Google.',
  google_nao_cadastrado: 'Esta conta do Google não está cadastrada no UniMais Hub. Peça acesso ao administrador.',
};

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
  const [error, setError] = useState<string | null>(() => GOOGLE_ERRORS[params.get('erro') ?? ''] ?? null);
  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => api.get<AuthProvidersDto>('/auth/providers'),
    staleTime: Infinity,
  });
  const googleUrl = providers.data?.googleUrl;

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
        {googleUrl && (
          <>
            <div className="flex items-center gap-2.5 text-xs text-white/80" aria-hidden="true">
              <span className="h-px flex-1 bg-white/30" />
              ou
              <span className="h-px flex-1 bg-white/30" />
            </div>
            {/* Navegação completa: o Google precisa abrir a própria tela de contas. */}
            <a
              href={googleUrl}
              className="flex h-10 items-center justify-center gap-2.5 rounded-pill border border-white bg-white px-6 text-base font-semibold text-navy-700 no-underline hover:bg-navy-050"
            >
              <LogIn {...ICON} aria-hidden="true" />
              Entrar com Google
            </a>
          </>
        )}
      </form>
    </AuthLayout>
  );
}
