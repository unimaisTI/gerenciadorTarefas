import { useMutation, useQuery } from '@tanstack/react-query';
import { Lock, Mail } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { forgotPasswordSchema, passwordSchema } from '@hub/shared';
import { Button, Input } from '@/design-system';
import { api, errorMessage } from '@/lib/api';
import { AuthLayout, GlassField } from './AuthLayout';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

// RF-3.4: "Esqueci minha senha". A resposta é a mesma exista ou não o e-mail.
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({ mutationFn: () => api.post('/auth/password/forgot', { email }) });

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Informe um e-mail válido.');
      return;
    }
    setError(null);
    send.mutate();
  };

  return (
    <AuthLayout title="Esqueci minha senha" subtitle="Enviaremos um link para você criar uma nova senha.">
      {send.isSuccess ? (
        <div className="flex flex-col gap-[15px] text-sm">
          <p className="m-0">Se o e-mail estiver cadastrado, você vai receber o link em instantes. Ele vale por 2 horas.</p>
          <Link to="/entrar" className="text-white underline">
            Voltar para o login
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[15px]">
          <GlassField label="E-mail" error={error ?? undefined}>
            <Input
              glass
              type="email"
              autoComplete="username"
              icon={<Mail {...ICON} />}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </GlassField>
          {send.isError && <p role="alert" className="m-0 text-sm">{errorMessage(send.error)}</p>}
          <Button type="submit" variant="inverse" size="lg" block disabled={send.isPending}>
            Enviar link
          </Button>
          <Link to="/entrar" className="text-center text-sm text-white">
            Voltar para o login
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

// RF-3.3 e RF-3.4: definir a senha pelo link do convite ou da redefinição.
export function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const info = useQuery({
    queryKey: ['password-token', token],
    queryFn: () => api.get<{ kind: 'invite' | 'reset'; name: string; email: string }>(`/auth/password/token?token=${encodeURIComponent(token)}`),
    enabled: token.length >= 20,
    retry: false,
  });

  const save = useMutation({
    mutationFn: () => api.post('/auth/password/reset', { token, password }),
    onSuccess: () => {
      void navigate('/entrar', { replace: true });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Senha inválida.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não conferem.');
      return;
    }
    setError(null);
    save.mutate();
  };

  if (!token || info.isError) {
    return (
      <AuthLayout title="Link inválido" subtitle="O link expirou ou já foi usado.">
        <Link to="/esqueci-senha" className="text-sm text-white underline">
          Pedir um novo link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={info.data?.kind === 'invite' ? 'Bem-vindo ao UniMais Hub' : 'Nova senha'}
      subtitle={info.data ? `${info.data.name} · ${info.data.email}` : 'Verificando o link...'}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[15px]">
        <GlassField label="Nova senha">
          <Input
            glass
            type="password"
            autoComplete="new-password"
            icon={<Lock {...ICON} />}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </GlassField>
        <GlassField label="Confirme a senha" error={error ?? undefined}>
          <Input
            glass
            type="password"
            autoComplete="new-password"
            icon={<Lock {...ICON} />}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
            }}
          />
        </GlassField>
        <p className="m-0 text-xs text-white/80">Mínimo de 8 caracteres, com letras e números.</p>
        <Button type="submit" variant="accent" size="lg" block disabled={save.isPending || !info.data}>
          Salvar senha
        </Button>
      </form>
    </AuthLayout>
  );
}
