import { useMutation } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { ROLE_LABELS } from '@hub/shared';
import { Button } from '@/design-system';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Faixa fixa no topo enquanto o admin está em "Visualizar acesso". */
export function AccessPreviewBar() {
  const { me } = useAuth();
  const stop = useMutation({
    mutationFn: () => api.del('/auth/access-preview'),
    // Recarrega para sair do cache montado com as permissões do usuário simulado.
    onSettled: () => {
      window.location.assign('/admin?aba=acesso');
    },
  });
  if (!me.impersonator) return null;
  const depts = me.memberships.map((m) => m.acronym).join(', ');

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-[15px] gap-y-2 bg-navy-900 px-4 py-2.5 text-sm text-white sm:px-5">
      <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        Visualizando como <strong>{me.name}</strong> ({ROLE_LABELS[me.role]}{depts ? ` · ${depts}` : ''}). Somente leitura.
      </span>
      <Button
        size="sm"
        variant="inverse"
        disabled={stop.isPending}
        onClick={() => {
          stop.mutate();
        }}
      >
        Sair da simulação
      </Button>
    </div>
  );
}
