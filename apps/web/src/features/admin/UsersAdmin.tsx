import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailPlus, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  ROLES,
  ROLE_LABELS,
  createUserSchema,
  formatDateTime,
  type DeactivateResultDto,
  type Paginated,
  type Role,
  type UserDto,
} from '@hub/shared';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  Spinner,
  Switch,
  useToast,
} from '@/design-system';
import { api, errorMessage, qs } from '@/lib/api';
import { keys, useDepartments } from '@/lib/queries';

interface FormState {
  name: string;
  email: string;
  jobTitle: string;
  phone: string;
  role: Role;
  seesAllDepartments: boolean;
  departments: { departmentId: string; isPrimary: boolean; isManager: boolean }[];
}

const EMPTY: FormState = { name: '', email: '', jobTitle: '', phone: '', role: 'colaborador', seesAllDepartments: false, departments: [] };

/** RF-4.2 e RF-4.3: criar e editar usuário (perfil e departamentos). */
function UserForm({ user, open, onClose }: { user: UserDto | null; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const departments = useDepartments();
  const [form, setForm] = useState<FormState>(() =>
    user
      ? {
          name: user.name,
          email: user.email,
          jobTitle: user.jobTitle ?? '',
          phone: user.phone ?? '',
          role: user.role,
          seesAllDepartments: user.seesAllDepartments,
          departments: user.memberships.map((m) => ({ departmentId: m.departmentId, isPrimary: m.isPrimary, isManager: m.isManager })),
        }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const body = { ...form, jobTitle: form.jobTitle || null, phone: form.phone || null };
  const save = useMutation({
    mutationFn: () => (user ? api.patch(`/users/${user.id}`, body) : api.post('/users', body)),
    onSuccess: () => {
      toast(user ? 'Usuário atualizado.' : 'Usuário criado. O convite foi enviado por e-mail.');
      void queryClient.invalidateQueries({ queryKey: keys.users });
      void queryClient.invalidateQueries({ queryKey: keys.directory });
      onClose();
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });

  const toggleDept = (id: string, on: boolean) => {
    const list = on
      ? [...form.departments, { departmentId: id, isPrimary: form.departments.length === 0, isManager: false }]
      : form.departments.filter((d) => d.departmentId !== id);
    if (list.length && !list.some((d) => d.isPrimary) && list[0]) list[0] = { ...list[0], isPrimary: true };
    setForm({ ...form, departments: list });
  };
  const canManage = form.role === 'gestor' || form.role === 'admin';

  return (
    <Modal
      open={open}
      title={user ? `Editar ${user.name}` : 'Novo usuário'}
      onClose={onClose}
      width={680}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              const parsed = createUserSchema.safeParse(body);
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
                return;
              }
              setError(null);
              save.mutate();
            }}
          >
            {user ? 'Salvar' : 'Criar e enviar convite'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-[15px] sm:grid-cols-2">
        <Field label="Nome completo" required>
          <Input data-autofocus value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); }} />
        </Field>
        <Field label="E-mail" required>
          <Input type="email" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); }} />
        </Field>
        <Field label="Cargo">
          <Input value={form.jobTitle} onChange={(e) => { setForm({ ...form, jobTitle: e.target.value }); }} />
        </Field>
        <Field label="Telefone / ramal">
          <Input value={form.phone} onChange={(e) => { setForm({ ...form, phone: e.target.value }); }} />
        </Field>
        <Field label="Perfil" required>
          <Select
            value={form.role}
            options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            onChange={(e) => {
              const role = e.target.value as Role;
              setForm({
                ...form,
                role,
                departments: role === 'gestor' || role === 'admin' ? form.departments : form.departments.map((d) => ({ ...d, isManager: false })),
              });
            }}
          />
        </Field>
        {form.role === 'observador' && (
          <div className="flex items-end pb-2">
            <Switch checked={form.seesAllDepartments} onChange={(v) => { setForm({ ...form, seesAllDepartments: v }); }} label="Vê toda a instituição (diretoria)" />
          </div>
        )}
      </div>
      <fieldset className="mt-5 border-0 p-0">
        <legend className="mb-2.5 text-sm font-medium text-strong">Departamentos</legend>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(departments.data ?? []).map((d) => {
            const m = form.departments.find((x) => x.departmentId === d.id);
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-5 rounded-sm border border-subtle px-[15px] py-2">
                <Checkbox label={`${d.name} (${d.acronym})`} checked={Boolean(m)} onChange={(e) => { toggleDept(d.id, e.target.checked); }} />
                {m && (
                  <>
                    <label className="inline-flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        name="primary"
                        checked={m.isPrimary}
                        onChange={() => {
                          setForm({ ...form, departments: form.departments.map((x) => ({ ...x, isPrimary: x.departmentId === d.id })) });
                        }}
                        className="accent-navy-700"
                      />
                      Principal
                    </label>
                    {canManage && (
                      <Checkbox
                        label="Gestor"
                        checked={m.isManager}
                        onChange={(e) => {
                          setForm({ ...form, departments: form.departments.map((x) => (x.departmentId === d.id ? { ...x, isManager: e.target.checked } : x)) });
                        }}
                      />
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
      {error && <p role="alert" className="mt-[15px] mb-0 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

export function UsersAdmin() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const departments = useDepartments();
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserDto | 'new' | null>(null);
  const [deactivated, setDeactivated] = useState<{ user: UserDto; result: DeactivateResultDto } | null>(null);

  const users = useQuery({
    queryKey: [...keys.users, q, departmentId, role, status, page],
    queryFn: () => api.get<Paginated<UserDto>>(`/users${qs({ q, departmentId, role, status, page })}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.users });
  const act = useMutation({
    mutationFn: async (v: { user: UserDto; action: 'deactivate' | 'activate' | 'invite' | 'reset' }) => {
      if (v.action === 'deactivate') {
        const result = await api.post<DeactivateResultDto>(`/users/${v.user.id}/deactivate`);
        setDeactivated({ user: v.user, result });
      } else if (v.action === 'activate') {
        await api.post(`/users/${v.user.id}/activate`);
      } else {
        await api.post(`/users/${v.user.id}/invite`, { kind: v.action === 'invite' ? 'invite' : 'reset' });
        toast(v.action === 'invite' ? 'Convite reenviado.' : 'Link de redefinição enviado; a senha atual foi invalidada.');
      }
    },
    onSuccess: () => void refresh(),
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });

  const data = users.data;
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-end gap-[15px]">
          <Field label="Buscar" className="min-w-56 flex-1">
            <Input icon={<Search size={16} />} placeholder="Nome ou e-mail" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </Field>
          <Field label="Departamento" className="w-48">
            <Select placeholder="Todos" value={departmentId} options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }} />
          </Field>
          <Field label="Perfil" className="w-40">
            <Select placeholder="Todos" value={role} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} onChange={(e) => { setRole(e.target.value); setPage(1); }} />
          </Field>
          <Field label="Situação" className="w-36">
            <Select value={status} options={[{ value: 'active', label: 'Ativos' }, { value: 'inactive', label: 'Inativos' }, { value: 'all', label: 'Todos' }]} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
          </Field>
          <Button icon={<Plus size={14} />} onClick={() => { setEditing('new'); }}>
            Novo usuário
          </Button>
        </div>
      </Card>
      <Card flush>
        {users.isPending ? (
          <Spinner />
        ) : (
          <>
            <DataTable
              caption="Usuários"
              rows={data?.items ?? []}
              rowKey={(u) => u.id}
              empty={<EmptyState title="Nenhum usuário encontrado" />}
              columns={[
                { key: 'name', header: 'Nome', sortValue: (u) => u.name, render: (u) => <span className="flex items-center gap-2"><Avatar name={u.name} src={u.avatarUrl} size={26} /><span><span className="block">{u.name}</span><span className="block text-xs text-muted">{u.email}</span></span></span> },
                { key: 'role', header: 'Perfil', sortValue: (u) => u.role, render: (u) => ROLE_LABELS[u.role] },
                { key: 'depts', header: 'Departamentos', render: (u) => u.memberships.map((m) => `${m.acronym}${m.isManager ? ' (gestor)' : ''}`).join(', ') },
                { key: 'status', header: 'Situação', render: (u) => (u.isActive ? <Badge tone="success" dot>Ativo</Badge> : <Badge dot>Inativo</Badge>) },
                { key: 'login', header: 'Último acesso', sortValue: (u) => u.lastLoginAt, render: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <span className="text-faint">Nunca</span>) },
                {
                  key: 'actions',
                  header: 'Ações',
                  render: (u) => (
                    <span className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(u); }}>Editar</Button>
                      {u.isActive ? (
                        <>
                          <Button size="sm" variant="ghost" icon={<MailPlus size={13} />} onClick={() => { act.mutate({ user: u, action: u.lastLoginAt ? 'reset' : 'invite' }); }}>
                            {u.lastLoginAt ? 'Forçar nova senha' : 'Reenviar convite'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (window.confirm(`Desativar ${u.name}? Histórico e tarefas são preservados.`)) act.mutate({ user: u, action: 'deactivate' });
                            }}
                          >
                            Desativar
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => { act.mutate({ user: u, action: 'activate' }); }}>Reativar</Button>
                      )}
                    </span>
                  ),
                },
              ]}
            />
            <Pagination page={page} pages={Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20))} onChange={setPage} />
          </>
        )}
      </Card>
      {editing && <UserForm key={editing === 'new' ? 'new' : editing.id} user={editing === 'new' ? null : editing} open onClose={() => { setEditing(null); }} />}
      <Modal open={deactivated !== null} title={`${deactivated?.user.name ?? ''} foi desativado`} onClose={() => { setDeactivated(null); }}>
        {deactivated?.result.openTasks.length ? (
          <>
            <p className="mt-0 text-sm">As sessões foram encerradas. Estas tarefas abertas precisam de outro responsável:</p>
            <ul className="m-0 flex flex-col gap-1.5 pl-5 text-sm">
              {deactivated.result.openTasks.map((t) => (
                <li key={t.id}>
                  <Link to={`/tarefas/${t.code}`}>{t.code}</Link> — {t.title} <span className="text-muted">({t.projectName})</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="m-0 text-sm">As sessões foram encerradas. Não havia tarefas abertas com esta pessoa.</p>
        )}
      </Modal>
    </div>
  );
}
