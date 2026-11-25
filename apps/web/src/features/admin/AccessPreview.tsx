import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role, type UserDto } from '@hub/shared';
import { AlertBanner, Avatar, Button, Card, EmptyState, Spinner, useToast } from '@/design-system';
import { api, errorMessage } from '@/lib/api';
import { DeptChip } from '@/lib/ui';

const PREVIEW_ROLES: Role[] = ['gestor', 'colaborador', 'observador'];

/**
 * Administração > Visualizar acesso: o admin escolhe uma pessoa e vê o sistema como ela
 * (mesmas permissões na API e no banco), sem poder alterar nada.
 */
export function AccessPreview() {
  const toast = useToast();
  const users = useQuery({
    queryKey: ['access-preview-users'],
    queryFn: () => api.get<UserDto[]>('/auth/access-preview/users'),
  });
  const start = useMutation({
    mutationFn: (userId: string) => api.post('/auth/access-preview', { userId }),
    // Recarrega a página para nenhuma tela ficar com dados do admin em cache.
    onSuccess: () => {
      window.location.assign('/');
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <AlertBanner title="Como funciona">
        Escolha uma pessoa para ver o sistema exatamente como ela vê: menus, departamentos, tarefas e chamados.
        Durante a simulação nada pode ser alterado, e o início e o fim ficam registrados na auditoria.
      </AlertBanner>
      {users.isPending ? (
        <Spinner />
      ) : (
        PREVIEW_ROLES.map((role) => {
          const people = (users.data ?? []).filter((u) => u.role === role);
          return (
            <Card key={role} title={ROLE_LABELS[role]}>
              <p className="m-0 mb-[15px] text-sm text-muted">{ROLE_DESCRIPTIONS[role]}</p>
              {people.length === 0 ? (
                <EmptyState title={`Nenhum usuário com o perfil ${ROLE_LABELS[role]}`} />
              ) : (
                <ul className="m-0 flex list-none flex-col divide-y divide-subtle p-0">
                  {people.map((u) => (
                    <li key={u.id} className="flex flex-wrap items-center gap-[15px] py-2.5">
                      <Avatar name={u.name} src={u.avatarUrl} size={34} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-semibold text-strong">{u.name}</span>
                        <span className="truncate text-xs text-muted">{u.jobTitle ?? u.email}</span>
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {u.memberships.length === 0 && !u.seesAllDepartments && (
                          <span className="text-xs text-muted">Sem departamento</span>
                        )}
                        {u.seesAllDepartments && <span className="text-xs text-muted">Vê todos os departamentos</span>}
                        {u.memberships.map((m) => (
                          <DeptChip key={m.departmentId} acronym={m.acronym} color={m.color} />
                        ))}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<Eye size={14} strokeWidth={1.75} />}
                        disabled={start.isPending}
                        onClick={() => {
                          start.mutate(u.id);
                        }}
                      >
                        Ver como {u.name.split(' ')[0]}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
