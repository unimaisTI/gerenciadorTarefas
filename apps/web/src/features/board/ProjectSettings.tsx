import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_TRIGGERS,
  AUTOMATION_TRIGGER_LABELS,
  DEPARTMENT_COLORS,
  DEPARTMENT_COLOR_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_FREQUENCY_LABELS,
  WEEKDAY_LABELS,
  automationRuleSchema,
  epicSchema,
  formatDate,
  recurrenceSchema,
  taskTemplateSchema,
  type AutomationAction,
  type AutomationRuleDto,
  type AutomationTrigger,
  type DepartmentColor,
  type Priority,
  type ProjectDetailDto,
  type RecurrenceDto,
  type RecurrenceFrequency,
  type RichNode,
  type UserRef,
} from '@hub/shared';
import {
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Spinner,
  Switch,
  Tabs,
  useToast,
} from '@/design-system';
import { PeoplePicker } from '@/components/PeoplePicker';
import { RichTextEditor } from '@/components/RichTextEditor';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { DEPT_BG } from '@/lib/ui';
import { ColumnsSettings } from './ColumnsSettings';
import { projectKeys, useEpics, useTemplates } from './projectQueries';

type Tab = 'colunas' | 'epicos' | 'modelos' | 'recorrentes' | 'automacoes';

function useAction(invalidate: readonly unknown[]) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invalidate });
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
}

function FormError({ error }: { error: string | null }) {
  return error ? <p role="alert" className="m-0 text-sm text-red-600">{error}</p> : null;
}

function EpicsTab({ project }: { project: ProjectDetailDto }) {
  const epics = useEpics(project.id);
  const run = useAction(projectKeys.epics(project.id));
  const [name, setName] = useState('');
  const [color, setColor] = useState<DepartmentColor>('indigo');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-[15px]">
      <p className="m-0 text-sm text-muted">Épicos agrupam tarefas de uma mesma entrega maior (ex.: "Migração do e-mail").</p>
      {epics.isPending ? (
        <Spinner />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(epics.data ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2.5 rounded-sm border border-subtle px-[15px] py-2">
              <span className={cn('size-3 rounded-full', DEPT_BG[e.color])} aria-hidden="true" />
              <span className={cn('flex-1 text-sm', e.status === 'done' && 'text-muted line-through')}>{e.name}</span>
              <span className="text-xs text-muted">
                {e.doneCount}/{e.taskCount} concluídas
              </span>
              <Switch
                label={<span className="sr-only">Épico {e.name} concluído</span>}
                checked={e.status === 'done'}
                onChange={(v) => {
                  run.mutate(() => api.patch(`/epics/${e.id}`, { status: v ? 'done' : 'open' }));
                }}
              />
              <IconButton
                label={`Excluir épico ${e.name}`}
                onClick={() => {
                  if (window.confirm(`Excluir o épico "${e.name}"? As tarefas continuam, só saem do épico.`)) run.mutate(() => api.del(`/epics/${e.id}`));
                }}
              >
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
          {!epics.data?.length && <li className="text-sm text-muted">Nenhum épico ainda.</li>}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2.5 border-t border-subtle pt-[15px]"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = epicSchema.safeParse({ name, color });
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
            return;
          }
          setError(null);
          run.mutate(() => api.post(`/projects/${project.id}/epics`, parsed.data));
          setName('');
        }}
      >
        <Field label="Novo épico" className="min-w-48 flex-1">
          <Input value={name} maxLength={120} onChange={(e) => { setName(e.target.value); }} />
        </Field>
        <Field label="Cor" className="w-40">
          <Select value={color} options={DEPARTMENT_COLORS.map((c) => ({ value: c, label: DEPARTMENT_COLOR_LABELS[c] }))} onChange={(e) => { setColor(e.target.value as DepartmentColor); }} />
        </Field>
        <Button type="submit" disabled={!name.trim()}>Adicionar</Button>
      </form>
      <FormError error={error} />
    </div>
  );
}

function TemplatesTab({ project }: { project: ProjectDetailDto }) {
  const templates = useTemplates(project.id);
  const run = useAction(projectKeys.templates(project.id));
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [description, setDescription] = useState<RichNode | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-[15px]">
      <p className="m-0 text-sm text-muted">Modelos preenchem a nova tarefa com título, prioridade e descrição (inclusive checklist).</p>
      {templates.isPending ? (
        <Spinner />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(templates.data ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-2.5 rounded-sm border border-subtle px-[15px] py-2 text-sm">
              <strong className="flex-1">{t.name}</strong>
              <span className="truncate text-muted">{t.title}</span>
              <Badge>{PRIORITY_LABELS[t.priority]}</Badge>
              <IconButton label={`Excluir modelo ${t.name}`} onClick={() => { run.mutate(() => api.del(`/templates/${t.id}`)); }}>
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
          {!templates.data?.length && <li className="text-sm text-muted">Nenhum modelo ainda.</li>}
        </ul>
      )}
      <form
        className="flex flex-col gap-2.5 border-t border-subtle pt-[15px]"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = taskTemplateSchema.safeParse({ name, title, priority, description });
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
            return;
          }
          setError(null);
          run.mutate(() => api.post(`/projects/${project.id}/templates`, parsed.data));
          setName('');
          setTitle('');
          setDescription(null);
          setEditorKey((k) => k + 1);
        }}
      >
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Field label="Nome do modelo" required>
            <Input value={name} maxLength={80} onChange={(e) => { setName(e.target.value); }} />
          </Field>
          <Field label="Título da tarefa" required className="sm:col-span-2">
            <Input value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); }} />
          </Field>
        </div>
        <Field label="Prioridade" className="w-40">
          <Select value={priority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} onChange={(e) => { setPriority(e.target.value as Priority); }} />
        </Field>
        <RichTextEditor key={editorKey} label="Descrição do modelo" value={null} onChange={setDescription} placeholder="Ex.: checklist de passos" minHeight={80} />
        <div>
          <Button type="submit">Salvar modelo</Button>
        </div>
        <FormError error={error} />
      </form>
    </div>
  );
}

function describeRecurrence(r: Pick<RecurrenceDto, 'frequency' | 'weekday' | 'monthDay'>) {
  if (r.frequency === 'weekly') return `Toda ${(WEEKDAY_LABELS[r.weekday ?? 1] ?? "").toLowerCase()}`;
  if (r.frequency === 'monthly') return `Todo dia ${String(r.monthDay ?? 1)}`;
  return 'Todo dia';
}

function RecurrencesTab({ project }: { project: ProjectDetailDto }) {
  const list = useQuery({
    queryKey: projectKeys.recurrences(project.id),
    queryFn: () => api.get<RecurrenceDto[]>(`/projects/${project.id}/recurrences`),
  });
  const run = useAction(projectKeys.recurrences(project.id));
  const [form, setForm] = useState({
    title: '',
    frequency: 'monthly' as RecurrenceFrequency,
    weekday: 1,
    monthDay: 1,
    dueOffsetDays: 0,
    priority: 'medium' as Priority,
  });
  const [assignee, setAssignee] = useState<UserRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-[15px]">
      <p className="m-0 text-sm text-muted">A tarefa é criada automaticamente na data, na primeira coluna "a fazer" (ex.: "Backup mensal").</p>
      {list.isPending ? (
        <Spinner />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(list.data ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2.5 rounded-sm border border-subtle px-[15px] py-2 text-sm">
              <strong className="min-w-40 flex-1">{r.title}</strong>
              <span className="text-muted">{describeRecurrence(r)}</span>
              <span className="text-xs text-muted">Próxima: {formatDate(r.nextRunOn)}</span>
              {r.assignee && <span className="text-xs text-muted">para {r.assignee.name}</span>}
              <Switch label={<span className="sr-only">Ativa: {r.title}</span>} checked={r.isActive} onChange={(v) => { run.mutate(() => api.patch(`/recurrences/${r.id}`, { isActive: v })); }} />
              <IconButton label={`Excluir recorrência ${r.title}`} onClick={() => { run.mutate(() => api.del(`/recurrences/${r.id}`)); }}>
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
          {!list.data?.length && <li className="text-sm text-muted">Nenhuma tarefa recorrente.</li>}
        </ul>
      )}
      <form
        className="grid grid-cols-1 gap-2.5 border-t border-subtle pt-[15px] sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const body = {
            title: form.title,
            frequency: form.frequency,
            weekday: form.frequency === 'weekly' ? form.weekday : null,
            monthDay: form.frequency === 'monthly' ? form.monthDay : null,
            dueOffsetDays: form.dueOffsetDays,
            priority: form.priority,
            assigneeId: assignee?.id ?? null,
          };
          const parsed = recurrenceSchema.safeParse(body);
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
            return;
          }
          setError(null);
          run.mutate(() => api.post(`/projects/${project.id}/recurrences`, parsed.data));
          setForm({ ...form, title: '' });
        }}
      >
        <Field label="Título" required className="sm:col-span-2">
          <Input value={form.title} maxLength={200} onChange={(e) => { setForm({ ...form, title: e.target.value }); }} />
        </Field>
        <Field label="Repetir">
          <Select value={form.frequency} options={RECURRENCE_FREQUENCIES.map((f) => ({ value: f, label: RECURRENCE_FREQUENCY_LABELS[f] }))} onChange={(e) => { setForm({ ...form, frequency: e.target.value as RecurrenceFrequency }); }} />
        </Field>
        {form.frequency === 'weekly' && (
          <Field label="Dia da semana">
            <Select value={String(form.weekday)} options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: WEEKDAY_LABELS[d] ?? '' }))} onChange={(e) => { setForm({ ...form, weekday: Number(e.target.value) }); }} />
          </Field>
        )}
        {form.frequency === 'monthly' && (
          <Field label="Dia do mês" hint="De 1 a 28, para existir em todo mês.">
            <Input type="number" min={1} max={28} value={form.monthDay} onChange={(e) => { setForm({ ...form, monthDay: Number(e.target.value) }); }} />
          </Field>
        )}
        <Field label="Prazo (dias depois de criada)">
          <Input type="number" min={0} max={365} value={form.dueOffsetDays} onChange={(e) => { setForm({ ...form, dueOffsetDays: Number(e.target.value) }); }} />
        </Field>
        <Field label="Prioridade">
          <Select value={form.priority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} onChange={(e) => { setForm({ ...form, priority: e.target.value as Priority }); }} />
        </Field>
        <Field label="Responsável">
          <PeoplePicker label="Responsável" value={assignee} onChange={setAssignee} departmentIds={[project.departmentId]} />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit">Criar recorrência</Button>
        </div>
        <div className="sm:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </div>
  );
}

function describeRule(r: AutomationRuleDto, project: ProjectDetailDto) {
  const when =
    r.trigger === 'task_moved'
      ? `Quando entrar em "${project.columns.find((c) => c.id === r.columnId)?.name ?? '?'}"`
      : `Quando for criada${r.triggerPriority ? ` com prioridade ${PRIORITY_LABELS[r.triggerPriority]}` : ''}`;
  const then: Record<AutomationAction, string> = {
    notify_user: `avisar ${r.actionUser?.name ?? '?'}`,
    notify_watchers: 'avisar os participantes',
    notify_reporter: 'avisar quem criou',
    assign_user: `atribuir a ${r.actionUser?.name ?? '?'}`,
    set_priority: `mudar a prioridade para ${r.actionPriority ? PRIORITY_LABELS[r.actionPriority] : '?'}`,
  };
  return `${when}, ${then[r.action]}.`;
}

function AutomationsTab({ project }: { project: ProjectDetailDto }) {
  const list = useQuery({
    queryKey: projectKeys.automations(project.id),
    queryFn: () => api.get<AutomationRuleDto[]>(`/projects/${project.id}/automations`),
  });
  const run = useAction(projectKeys.automations(project.id));
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<AutomationTrigger>('task_moved');
  const [columnId, setColumnId] = useState(project.columns.at(-1)?.id ?? '');
  const [triggerPriority, setTriggerPriority] = useState('');
  const [action, setAction] = useState<AutomationAction>('notify_reporter');
  const [user, setUser] = useState<UserRef | null>(null);
  const [actionPriority, setActionPriority] = useState<Priority>('high');
  const [error, setError] = useState<string | null>(null);
  const needsUser = action === 'notify_user' || action === 'assign_user';

  return (
    <div className="flex flex-col gap-[15px]">
      <p className="m-0 text-sm text-muted">Regras simples que o sistema executa sozinho, em qualquer tela ou integração.</p>
      {list.isPending ? (
        <Spinner />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(list.data ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2.5 rounded-sm border border-subtle px-[15px] py-2 text-sm">
              <span className="min-w-60 flex-1">
                <strong className="block">{r.name}</strong>
                <span className="text-muted">{describeRule(r, project)}</span>
              </span>
              <Switch label={<span className="sr-only">Ativa: {r.name}</span>} checked={r.isActive} onChange={(v) => { run.mutate(() => api.patch(`/automations/${r.id}`, { isActive: v })); }} />
              <IconButton label={`Excluir automação ${r.name}`} onClick={() => { run.mutate(() => api.del(`/automations/${r.id}`)); }}>
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
          {!list.data?.length && <li className="text-sm text-muted">Nenhuma automação.</li>}
        </ul>
      )}
      <form
        className="grid grid-cols-1 gap-2.5 border-t border-subtle pt-[15px] sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const body = {
            name,
            trigger,
            columnId: trigger === 'task_moved' ? columnId : null,
            triggerPriority: trigger === 'task_created' && triggerPriority ? triggerPriority : null,
            action,
            actionUserId: needsUser ? (user?.id ?? null) : null,
            actionPriority: action === 'set_priority' ? actionPriority : null,
          };
          const parsed = automationRuleSchema.safeParse(body);
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
            return;
          }
          setError(null);
          run.mutate(() => api.post(`/projects/${project.id}/automations`, parsed.data));
          setName('');
        }}
      >
        <Field label="Nome da regra" required className="sm:col-span-2">
          <Input value={name} maxLength={80} placeholder="Ex.: Avisar quem pediu ao concluir" onChange={(e) => { setName(e.target.value); }} />
        </Field>
        <Field label="Quando">
          <Select value={trigger} options={AUTOMATION_TRIGGERS.map((t) => ({ value: t, label: AUTOMATION_TRIGGER_LABELS[t] }))} onChange={(e) => { setTrigger(e.target.value as AutomationTrigger); }} />
        </Field>
        {trigger === 'task_moved' ? (
          <Field label="Coluna">
            <Select value={columnId} options={project.columns.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => { setColumnId(e.target.value); }} />
          </Field>
        ) : (
          <Field label="Com prioridade">
            <Select placeholder="Qualquer" value={triggerPriority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} onChange={(e) => { setTriggerPriority(e.target.value); }} />
          </Field>
        )}
        <Field label="Então">
          <Select value={action} options={AUTOMATION_ACTIONS.map((a) => ({ value: a, label: AUTOMATION_ACTION_LABELS[a] }))} onChange={(e) => { setAction(e.target.value as AutomationAction); }} />
        </Field>
        {needsUser && (
          <Field label="Pessoa">
            <PeoplePicker label="Pessoa" value={user} onChange={setUser} {...(action === 'assign_user' && { departmentIds: [project.departmentId] })} />
          </Field>
        )}
        {action === 'set_priority' && (
          <Field label="Nova prioridade">
            <Select value={actionPriority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} onChange={(e) => { setActionPriority(e.target.value as Priority); }} />
          </Field>
        )}
        <div className="sm:col-span-2">
          <Button type="submit">Criar automação</Button>
        </div>
        <div className="sm:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </div>
  );
}

/** "Configurar" do projeto: colunas, épicos, modelos, recorrência e automações. */
export function ProjectSettingsModal({ open, project, onClose }: { open: boolean; project: ProjectDetailDto; onClose: () => void }) {
  const regular = project.kind === 'regular';
  const tabs: { id: Tab; label: string }[] = [
    ...(project.canManage && regular ? [{ id: 'colunas' as const, label: 'Colunas' }] : []),
    { id: 'epicos', label: 'Épicos' },
    ...(regular ? [{ id: 'modelos' as const, label: 'Modelos' }, { id: 'recorrentes' as const, label: 'Recorrentes' }] : []),
    ...(project.canManage ? [{ id: 'automacoes' as const, label: 'Automações' }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'epicos');
  return (
    <Modal open={open} title={`Configurar ${project.name}`} onClose={onClose} width={760}>
      <div className="flex flex-col gap-5">
        <Tabs label="Configurações do projeto" active={tab} onChange={setTab} tabs={tabs} />
        {tab === 'colunas' && <ColumnsSettings project={project} />}
        {tab === 'epicos' && <EpicsTab project={project} />}
        {tab === 'modelos' && <TemplatesTab project={project} />}
        {tab === 'recorrentes' && <RecurrencesTab project={project} />}
        {tab === 'automacoes' && <AutomationsTab project={project} />}
      </div>
    </Modal>
  );
}
