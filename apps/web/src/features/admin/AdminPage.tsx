import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  CALENDAR_EVENT_KINDS,
  CALENDAR_EVENT_KIND_LABELS,
  DEPARTMENT_COLORS,
  DEPARTMENT_COLOR_LABELS,
  calendarEventSchema,
  departmentSchema,
  formatDate,
  formatDateTime,
  type AuditEntryDto,
  type CalendarEventDto,
  type CalendarEventKind,
  type DepartmentColor,
  type DepartmentDto,
  type Paginated,
} from '@hub/shared';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Pagination,
  Select,
  Spinner,
  Switch,
  Tabs,
  Textarea,
  useToast,
} from '@/design-system';
import { api, errorMessage, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { keys, useDepartments } from '@/lib/queries';
import { DEPT_BG, DeptChip, PageHeader } from '@/lib/ui';
import { UsersAdmin } from './UsersAdmin';

type Tab = 'usuarios' | 'departamentos' | 'eventos' | 'auditoria';

/** RNF-15.6: o admin escolhe a cor da paleta, nunca um hex livre. */
function ColorPicker({ value, onChange }: { value: DepartmentColor; onChange: (c: DepartmentColor) => void }) {
  return (
    <div role="radiogroup" aria-label="Cor do departamento" className="flex flex-wrap gap-2">
      {DEPARTMENT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={DEPARTMENT_COLOR_LABELS[c]}
          title={DEPARTMENT_COLOR_LABELS[c]}
          onClick={() => {
            onChange(c);
          }}
          className={cn('size-8 cursor-pointer rounded-full border-2', DEPT_BG[c], value === c ? 'border-navy-900 ring-2 ring-navy-200' : 'border-white')}
        />
      ))}
    </div>
  );
}

function DepartmentForm({ dept, onClose }: { dept: DepartmentDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: dept?.name ?? '',
    acronym: dept?.acronym ?? '',
    color: dept?.color ?? ('navy'),
    description: dept?.description ?? '',
    acceptsTickets: dept?.acceptsTickets ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const body = { ...form, description: form.description || null };
  const save = useMutation({
    mutationFn: () => (dept ? api.patch(`/departments/${dept.id}`, body) : api.post('/departments', body)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.departments });
      onClose();
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return (
    <Modal
      open
      title={dept ? `Editar ${dept.name}` : 'Novo departamento'}
      onClose={onClose}
      footer={
        <Button
          onClick={() => {
            const parsed = departmentSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
              return;
            }
            save.mutate();
          }}
        >
          Salvar
        </Button>
      }
    >
      <div className="flex flex-col gap-[15px]">
        <Field label="Nome" required>
          <Input data-autofocus value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); }} />
        </Field>
        <Field label="Sigla" required hint="Usada no código das tarefas, ex.: TI-42.">
          <Input value={form.acronym} maxLength={10} onChange={(e) => { setForm({ ...form, acronym: e.target.value.toUpperCase() }); }} />
        </Field>
        <Field label="Cor">
          <ColorPicker value={form.color} onChange={(color) => { setForm({ ...form, color }); }} />
        </Field>
        <Field label="Descrição">
          <Textarea value={form.description} onChange={(e) => { setForm({ ...form, description: e.target.value }); }} />
        </Field>
        <Switch checked={form.acceptsTickets} onChange={(v) => { setForm({ ...form, acceptsTickets: v }); }} label="Aceita chamados de outros departamentos" />
        {!dept && <p className="m-0 text-xs text-muted">Ao salvar, o sistema cria o projeto de atividades, o quadro "Chamados recebidos" e o tipo "Solicitação geral".</p>}
        {error && <p role="alert" className="m-0 text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

function DepartmentsAdmin() {
  const departments = useDepartments(true);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<DepartmentDto | 'new' | null>(null);
  const archive = useMutation({
    mutationFn: (d: DepartmentDto) => api.post(`/departments/${d.id}/archive`, { archived: !d.archivedAt }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.departments }),
  });
  return (
    <Card flush action={<Button icon={<Plus size={14} />} onClick={() => { setEditing('new'); }}>Novo departamento</Button>} title="Departamentos">
      <div className="pt-[15px]">
        <DataTable
          caption="Departamentos"
          rows={departments.data ?? []}
          rowKey={(d) => d.id}
          columns={[
            { key: 'name', header: 'Nome', sortValue: (d) => d.name, render: (d) => <span className="flex items-center gap-2"><DeptChip acronym={d.acronym} color={d.color} />{d.name}</span> },
            { key: 'managers', header: 'Gestores', render: (d) => d.managers.map((m) => m.name).join(', ') || <span className="text-faint">Nenhum</span> },
            { key: 'members', header: 'Membros', sortValue: (d) => d.memberCount, render: (d) => d.memberCount },
            { key: 'tickets', header: 'Chamados', render: (d) => (d.acceptsTickets ? 'Aceita' : 'Não aceita') },
            { key: 'status', header: 'Situação', render: (d) => (d.archivedAt ? <Badge>Arquivado</Badge> : <Badge tone="success" dot>Ativo</Badge>) },
            {
              key: 'actions',
              header: 'Ações',
              render: (d) => (
                <span className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(d); }}>Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => { archive.mutate(d); }}>{d.archivedAt ? 'Restaurar' : 'Arquivar'}</Button>
                </span>
              ),
            },
          ]}
        />
      </div>
      {editing && <DepartmentForm dept={editing === 'new' ? null : editing} onClose={() => { setEditing(null); }} />}
    </Card>
  );
}

/** RF-14.13 e RF-14.14: eventos gerais, feriados municipais e recessos. */
export function EventsManager({ departmentId }: { departmentId?: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const departments = useDepartments();
  const events = useQuery({
    queryKey: ['calendar-events', departmentId],
    queryFn: () => api.get<CalendarEventDto[]>(`/calendar-events${qs({ departmentId })}`),
  });
  const [form, setForm] = useState({ title: '', startDate: '', endDate: '', kind: 'event' as CalendarEventKind, departmentId: departmentId ?? '' });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
    void queryClient.invalidateQueries({ queryKey: keys.calendarAny });
  };
  const create = useMutation({
    mutationFn: () => {
      const body = { ...form, endDate: form.endDate || form.startDate, departmentId: form.departmentId || null };
      const parsed = calendarEventSchema.safeParse(body);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Confira os campos.');
      return api.post('/calendar-events', body);
    },
    onSuccess: () => {
      setForm({ ...form, title: '', startDate: '', endDate: '' });
      refresh();
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/calendar-events/${id}`), onSuccess: refresh, onError: (e) => { toast(errorMessage(e), 'danger'); } });

  return (
    <Card title="Eventos do calendário">
      <form
        className="mb-5 flex flex-wrap items-end gap-[15px]"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Título" className="min-w-48 flex-1">
          <Input value={form.title} onChange={(e) => { setForm({ ...form, title: e.target.value }); }} />
        </Field>
        <Field label="Início">
          <Input type="date" value={form.startDate} onChange={(e) => { setForm({ ...form, startDate: e.target.value }); }} />
        </Field>
        <Field label="Fim">
          <Input type="date" value={form.endDate} onChange={(e) => { setForm({ ...form, endDate: e.target.value }); }} />
        </Field>
        <Field label="Tipo" className="w-36">
          <Select value={form.kind} options={CALENDAR_EVENT_KINDS.map((k) => ({ value: k, label: CALENDAR_EVENT_KIND_LABELS[k] }))} onChange={(e) => { setForm({ ...form, kind: e.target.value as CalendarEventKind }); }} />
        </Field>
        {!departmentId && (
          <Field label="Departamento" className="w-44">
            <Select placeholder="Geral (todos)" value={form.departmentId} options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))} onChange={(e) => { setForm({ ...form, departmentId: e.target.value }); }} />
          </Field>
        )}
        <Button type="submit" disabled={!form.title.trim() || !form.startDate}>
          Adicionar
        </Button>
      </form>
      {events.isPending ? (
        <Spinner />
      ) : (
        <DataTable
          caption="Eventos"
          rows={events.data ?? []}
          rowKey={(e) => e.id}
          empty={<EmptyState title="Nenhum evento" />}
          columns={[
            { key: 'title', header: 'Título', render: (e) => e.title },
            { key: 'when', header: 'Data', sortValue: (e) => e.startDate, render: (e) => (e.endDate !== e.startDate ? `${formatDate(e.startDate)} a ${formatDate(e.endDate)}` : formatDate(e.startDate)) },
            { key: 'kind', header: 'Tipo', render: (e) => CALENDAR_EVENT_KIND_LABELS[e.kind] },
            { key: 'scope', header: 'Abrangência', render: (e) => departments.data?.find((d) => d.id === e.departmentId)?.name ?? 'Geral' },
            {
              key: 'remove',
              header: '',
              render: (e) => (
                <IconButton label={`Excluir ${e.title}`} onClick={() => { remove.mutate(e.id); }}>
                  <Trash2 size={14} />
                </IconButton>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}

/** RF-11.2: log de auditoria (só admin). */
function AuditLog() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const log = useQuery({
    queryKey: ['audit', page, action],
    queryFn: () => api.get<Paginated<AuditEntryDto>>(`/audit${qs({ page, action })}`),
  });
  const actions = ['login', 'login_failed', 'user_created', 'user_updated', 'role_changed', 'user_deactivated', 'user_activated', 'password_reset', 'password_changed', 'member_added', 'member_removed', 'department_created'];
  return (
    <Card flush title="Log de auditoria" action={<div className="w-52"><Select aria-label="Ação" placeholder="Todas as ações" value={action} options={actions.map((a) => ({ value: a, label: a }))} onChange={(e) => { setAction(e.target.value); setPage(1); }} /></div>}>
      <div className="pt-[15px]">
        {log.isPending ? (
          <Spinner />
        ) : (
          <>
            <DataTable
              caption="Auditoria"
              rows={log.data?.items ?? []}
              rowKey={(e) => e.id}
              empty={<EmptyState title="Sem registros" />}
              columns={[
                { key: 'when', header: 'Quando', render: (e) => formatDateTime(e.createdAt) },
                { key: 'actor', header: 'Quem', render: (e) => e.actor?.name ?? '—' },
                { key: 'action', header: 'Ação', render: (e) => <code className="text-xs">{e.action}</code> },
                { key: 'target', header: 'Alvo', render: (e) => e.target ?? '—' },
                { key: 'ip', header: 'IP', render: (e) => e.ip ?? '—' },
              ]}
            />
            <Pagination page={page} pages={Math.ceil((log.data?.total ?? 0) / (log.data?.pageSize ?? 50))} onChange={setPage} />
          </>
        )}
      </div>
    </Card>
  );
}

export function AdminPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('aba') as Tab | null) ?? 'usuarios';
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Administração" subtitle="Usuários, departamentos, eventos e auditoria." />
      <Tabs
        label="Administração"
        active={tab}
        onChange={(t) => {
          setParams({ aba: t });
        }}
        tabs={[
          { id: 'usuarios', label: 'Usuários' },
          { id: 'departamentos', label: 'Departamentos' },
          { id: 'eventos', label: 'Eventos e feriados' },
          { id: 'auditoria', label: 'Auditoria' },
        ]}
      />
      {tab === 'usuarios' && <UsersAdmin />}
      {tab === 'departamentos' && <DepartmentsAdmin />}
      {tab === 'eventos' && <EventsManager />}
      {tab === 'auditoria' && <AuditLog />}
    </div>
  );
}
