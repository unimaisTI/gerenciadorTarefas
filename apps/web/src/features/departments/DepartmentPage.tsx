import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, CalendarDays, ChartColumn, Plus, Trash2, UserMinus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ROLE_LABELS,
  formatDate,
  formatNumber,
  permissions,
  projectSchema,
  type DepartmentDto,
  type DepartmentMemberDto,
  type ProjectDto,
  type UserRef,
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
  IconButton,
  Input,
  Modal,
  Spinner,
  Switch,
  Textarea,
  useToast,
} from '@/design-system';
import { PeoplePicker } from '@/components/PeoplePicker';
import { api, errorMessage, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys, useTicketTypes } from '@/lib/queries';
import { DeptChip, PageHeader } from '@/lib/ui';
import { EventsManager } from '../admin/AdminPage';

function NewProjectModal({ dept, open, onClose }: { dept: DepartmentDto; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [members, setMembers] = useState<UserRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const body = {
    departmentId: dept.id,
    name,
    key: key || `${dept.acronym}-`,
    description: description || null,
    startDate: startDate || null,
    endDate: endDate || null,
    memberIds: members.map((m) => m.id),
  };
  const create = useMutation({
    mutationFn: () => api.post('/projects', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.projectsAny });
      onClose();
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return (
    <Modal
      open={open}
      title="Novo projeto"
      onClose={onClose}
      footer={
        <Button
          onClick={() => {
            const parsed = projectSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
              return;
            }
            create.mutate();
          }}
          disabled={create.isPending}
        >
          Criar projeto
        </Button>
      }
    >
      <div className="flex flex-col gap-[15px]">
        <Field label="Nome" required>
          <Input data-autofocus value={name} maxLength={120} onChange={(e) => { setName(e.target.value); }} />
        </Field>
        <Field label="Chave" required hint={`Prefixo dos códigos das tarefas, ex.: ${dept.acronym}-EVT gera ${dept.acronym}-EVT-1.`}>
          <Input value={key} placeholder={`${dept.acronym}-EVT`} maxLength={21} onChange={(e) => { setKey(e.target.value.toUpperCase()); }} />
        </Field>
        <Field label="Descrição">
          <Textarea value={description} maxLength={2000} onChange={(e) => { setDescription(e.target.value); }} />
        </Field>
        <div className="grid grid-cols-2 gap-[15px]">
          <Field label="Início">
            <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); }} />
          </Field>
          <Field label="Fim">
            <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); }} />
          </Field>
        </div>
        <Field label="Membros convidados" hint="Membros do departamento já têm acesso.">
          <PeoplePicker
            label="Adicionar membro"
            value={null}
            onChange={(u) => {
              if (u && !members.some((m) => m.id === u.id)) setMembers([...members, u]);
            }}
          />
        </Field>
        {members.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <Badge key={m.id} tone="navy">
                {m.name}
                <button type="button" aria-label={`Remover ${m.name}`} className="cursor-pointer border-0 bg-transparent p-0 text-inherit" onClick={() => { setMembers(members.filter((x) => x.id !== m.id)); }}>
                  ×
                </button>
              </Badge>
            ))}
          </div>
        )}
        {error && <p role="alert" className="m-0 text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

function Members({ dept }: { dept: DepartmentDto }) {
  const { viewer } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const members = useQuery({
    queryKey: keys.members(dept.id),
    queryFn: () => api.get<DepartmentMemberDto[]>(`/departments/${dept.id}/members`),
  });
  const canManage = permissions.addMembers(viewer, dept.id);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.members(dept.id) });
    void queryClient.invalidateQueries({ queryKey: keys.departments });
  };
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  return (
    <Card
      title="Membros"
      flush
      action={
        canManage && (
          <div className="w-64">
            <PeoplePicker
              label="Adicionar membro"
              placeholder="Adicionar membro"
              value={null}
              onChange={(u) => {
                if (u) run.mutate(() => api.post(`/departments/${dept.id}/members`, { userId: u.id }));
              }}
            />
          </div>
        )
      }
    >
      <div className="pt-[15px]">
        {members.isPending ? (
          <Spinner />
        ) : (
          <DataTable
            caption="Membros do departamento"
            rows={members.data ?? []}
            rowKey={(m) => m.id}
            columns={[
              { key: 'name', header: 'Nome', sortValue: (m) => m.name, render: (m) => <span className="flex items-center gap-2"><Avatar name={m.name} src={m.avatarUrl} size={24} />{m.name}{!m.isActive && <Badge>Inativo</Badge>}</span> },
              { key: 'role', header: 'Perfil', render: (m) => ROLE_LABELS[m.role] },
              {
                key: 'manager',
                header: 'Gestor',
                render: (m) =>
                  viewer.role === 'admin' && (m.role === 'gestor' || m.role === 'admin') ? (
                    <Switch
                      label={<span className="sr-only">Gestor de {dept.acronym}</span>}
                      checked={m.isManager}
                      onChange={(v) => {
                        run.mutate(() => api.post(`/departments/${dept.id}/members`, { userId: m.id, isManager: v }));
                      }}
                    />
                  ) : m.isManager ? (
                    <Badge tone="navy">Gestor</Badge>
                  ) : null,
              },
              {
                key: 'remove',
                header: '',
                render: (m) =>
                  canManage && (!m.isManager || viewer.role === 'admin') ? (
                    <IconButton
                      label={`Remover ${m.name} do departamento`}
                      onClick={() => {
                        if (window.confirm(`Remover ${m.name} de ${dept.name}?`)) run.mutate(() => api.del(`/departments/${dept.id}/members/${m.id}`));
                      }}
                    >
                      <UserMinus size={15} />
                    </IconButton>
                  ) : null,
              },
            ]}
          />
        )}
      </div>
    </Card>
  );
}

/** RF-4.10: tipos de chamado parametrizáveis sem mudar código. */
function TicketTypes({ dept }: { dept: DepartmentDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const types = useTicketTypes(dept.id, true);
  const [name, setName] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.ticketTypes(dept.id) });
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => void refresh(),
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  return (
    <Card title="Tipos de chamado">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {(types.data ?? []).map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2.5 text-sm">
            <span className={`flex-1 ${t.isActive ? '' : 'text-muted line-through'}`}>{t.name}</span>
            <label className="flex items-center gap-1 text-xs text-muted">
              SLA
              <input
                type="number"
                min={1}
                max={2000}
                aria-label={`SLA em horas de ${t.name}`}
                defaultValue={t.slaHours ?? ''}
                placeholder="—"
                className="h-8 w-16 rounded-xs border border-subtle px-1.5 text-sm text-body"
                onBlur={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  if (v !== t.slaHours) run.mutate(() => api.patch(`/ticket-types/${t.id}`, { slaHours: v }));
                }}
              />
              h
            </label>
            <Switch label={<span className="sr-only">Ativo: {t.name}</span>} checked={t.isActive} onChange={(v) => { run.mutate(() => api.patch(`/ticket-types/${t.id}`, { isActive: v })); }} />
          </li>
        ))}
      </ul>
      <form
        className="mt-[15px] flex gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run.mutate(() => api.post(`/departments/${dept.id}/ticket-types`, { name: name.trim() }));
          setName('');
        }}
      >
        <Input aria-label="Novo tipo de chamado" placeholder="Novo tipo" value={name} maxLength={120} onChange={(e) => { setName(e.target.value); }} />
        <IconButton label="Adicionar tipo" variant="soft" type="submit">
          <Plus size={16} />
        </IconButton>
      </form>
    </Card>
  );
}

export function DepartmentPage() {
  const { id = '' } = useParams();
  const { viewer } = useAuth();
  const queryClient = useQueryClient();
  const [newProject, setNewProject] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const dept = useQuery({ queryKey: keys.department(id), queryFn: () => api.get<DepartmentDto>(`/departments/${id}`) });
  const projects = useQuery({
    queryKey: [...keys.projects(id), showArchived],
    queryFn: () => api.get<ProjectDto[]>(`/projects${qs({ departmentId: id, includeArchived: showArchived })}`),
  });
  const archive = useMutation({
    mutationFn: (p: ProjectDto) => api.post(`/projects/${p.id}/archive`, { archived: !p.archivedAt }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.projectsAny }),
  });

  if (dept.isPending) return <Spinner />;
  const d = dept.data;
  if (!d) return <Card><EmptyState title="Departamento não encontrado" /></Card>;
  const canManage = permissions.manageProjects(viewer, d.id);
  const canReports = permissions.viewDepartmentReports(viewer, d.id);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={d.name}
        subtitle={d.description ?? undefined}
        actions={
          <>
            <DeptChip acronym={d.acronym} color={d.color} />
            <Link to={`/departamentos/${d.id}/calendario`} className="inline-flex items-center gap-1.5 text-sm">
              <CalendarDays size={15} aria-hidden="true" /> Calendário
            </Link>
            {canReports && (
              <Link to={`/departamentos/${d.id}/painel`} className="inline-flex items-center gap-1.5 text-sm">
                <ChartColumn size={15} aria-hidden="true" /> Painel
              </Link>
            )}
            {permissions.restoreTask(viewer, d.id) && (
              <Link to={`/departamentos/${d.id}/lixeira`} className="inline-flex items-center gap-1.5 text-sm">
                <Trash2 size={15} aria-hidden="true" /> Lixeira
              </Link>
            )}
            {canManage && (
              <Button icon={<Plus size={14} />} onClick={() => { setNewProject(true); }}>
                Novo projeto
              </Button>
            )}
          </>
        }
      />
      <Card
        title="Projetos e quadros"
        action={<Checkbox label="Mostrar arquivados" checked={showArchived} onChange={(e) => { setShowArchived(e.target.checked); }} />}
      >
        <ul className="m-0 grid list-none grid-cols-1 gap-[15px] p-0 md:grid-cols-2">
          {(projects.data ?? []).map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-2.5 rounded-sm border border-subtle p-[15px]">
              <div className="min-w-0">
                <Link to={`/projetos/${p.key}`} className="font-semibold">
                  {p.name}
                </Link>
                <div className="text-xs text-muted">
                  {p.key} · {formatNumber(p.openTaskCount)} abertas
                  {p.kind === 'tickets' && ' · quadro de chamados'}
                  {p.endDate && ` · até ${formatDate(p.endDate)}`}
                </div>
                {p.archivedAt && <Badge>Arquivado</Badge>}
              </div>
              {canManage && p.kind === 'regular' && (
                <IconButton label={p.archivedAt ? `Restaurar ${p.name}` : `Arquivar ${p.name}`} onClick={() => { archive.mutate(p); }}>
                  {p.archivedAt ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <Members dept={d} />
        {canManage && <TicketTypes dept={d} />}
      </div>
      {canManage && <EventsManager departmentId={d.id} />}
      {canManage && <NewProjectModal dept={d} open={newProject} onClose={() => { setNewProject(false); }} />}
    </div>
  );
}
