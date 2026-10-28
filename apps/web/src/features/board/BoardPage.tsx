import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Bookmark, LayoutGrid, Plus, Rows3, Settings2, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  SWIMLANES,
  SWIMLANE_LABELS,
  formatDate,
  type ProjectDetailDto,
  type SavedFilterDto,
  type Swimlane,
  type TaskCardDto,
  type UserRef,
} from '@hub/shared';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  useToast,
  type Column,
} from '@/design-system';
import { PeoplePicker } from '@/components/PeoplePicker';
import { api, errorMessage, qs } from '@/lib/api';
import { useHotkey } from '@/lib/hotkeys';
import { keys } from '@/lib/queries';
import { DueDate, PageHeader, PriorityBadge, TicketStatusBadge } from '@/lib/ui';
import { NewTaskModal } from '../tasks/NewTaskModal';
import { TaskDetail } from '../tasks/TaskDetail';
import { KanbanBoard } from './KanbanBoard';
import type { QuickEditContext } from './KanbanCard';
import { ProjectSettingsModal } from './ProjectSettings';
import { useEpics } from './projectQueries';

type View = 'board' | 'list' | 'backlog';

interface Filters {
  assigneeId: string;
  priority: string;
  labelId: string;
  epicId: string;
  due: string;
  q: string;
  mine: boolean;
}

const EMPTY: Filters = { assigneeId: '', priority: '', labelId: '', epicId: '', due: '', q: '', mine: false };

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferência de visão é só conveniência.
  }
}

/** Filtros salvos: pessoais ou compartilhados com o departamento. */
function SavedFilters({ project, filters, onApply }: { project: ProjectDetailDto; filters: Filters; onApply: (f: Filters) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const list = useQuery({
    queryKey: ['saved-filters', project.id],
    queryFn: () => api.get<SavedFilterDto[]>(`/saved-filters?projectId=${project.id}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['saved-filters', project.id] });
  const save = useMutation({
    mutationFn: () =>
      api.post('/saved-filters', {
        projectId: project.id,
        name,
        isShared: shared,
        filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== false)),
      }),
    onSuccess: () => {
      setSaving(false);
      setName('');
      void refresh();
      toast('Filtro salvo.');
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/saved-filters/${id}`), onSuccess: () => void refresh() });
  const items = list.data ?? [];
  const active = JSON.stringify(filters) !== JSON.stringify(EMPTY);

  return (
    <div className="flex items-center gap-2">
      {items.length > 0 && (
        <div className="w-48">
          <Select
            aria-label="Filtros salvos"
            placeholder="Filtros salvos"
            value=""
            options={items.map((f) => ({ value: f.id, label: `${f.name}${f.isShared ? ' (equipe)' : ''}` }))}
            onChange={(e) => {
              const f = items.find((x) => x.id === e.target.value);
              if (f) onApply({ ...EMPTY, ...(f.filters as Partial<Filters>) });
            }}
          />
        </div>
      )}
      {active && (
        <Button variant="ghost" size="sm" icon={<Bookmark size={13} />} onClick={() => { setSaving(true); }}>
          Salvar filtro
        </Button>
      )}
      <Modal
        open={saving}
        title="Salvar filtro"
        onClose={() => { setSaving(false); }}
        footer={<Button disabled={!name.trim() || save.isPending} onClick={() => { save.mutate(); }}>Salvar</Button>}
      >
        <div className="flex flex-col gap-[15px]">
          <Field label="Nome" required>
            <Input data-autofocus value={name} maxLength={60} placeholder="Ex.: Urgentes da equipe" onChange={(e) => { setName(e.target.value); }} />
          </Field>
          <Checkbox label="Compartilhar com o departamento" checked={shared} onChange={(e) => { setShared(e.target.checked); }} />
          {items.filter((f) => f.isMine).length > 0 && (
            <div>
              <p className="mt-0 mb-1.5 text-sm font-medium text-strong">Meus filtros</p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {items.filter((f) => f.isMine).map((f) => (
                  <li key={f.id} className="flex items-center justify-between text-sm">
                    {f.name}
                    <Button variant="ghost" size="sm" onClick={() => { remove.mutate(f.id); }}>Excluir</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

function FiltersBar({
  project,
  filters,
  onChange,
  epics,
  searchRef,
}: {
  project: ProjectDetailDto;
  filters: Filters;
  onChange: (f: Filters) => void;
  epics: { id: string; name: string }[];
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    onChange({ ...filters, [k]: v });
  };
  return (
    <div className="flex flex-wrap items-center gap-2.5" role="search" aria-label="Filtros do quadro">
      <div className="w-56">
        <Input ref={searchRef} aria-label="Buscar no quadro" placeholder="Buscar no quadro (f)" value={filters.q} onChange={(e) => { set('q', e.target.value); }} />
      </div>
      <div className="w-44">
        <Select aria-label="Responsável" placeholder="Responsável" value={filters.assigneeId} options={project.members.map((m) => ({ value: m.id, label: m.name }))} onChange={(e) => { set('assigneeId', e.target.value); }} />
      </div>
      <div className="w-36">
        <Select aria-label="Prioridade" placeholder="Prioridade" value={filters.priority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} onChange={(e) => { set('priority', e.target.value); }} />
      </div>
      {epics.length > 0 && (
        <div className="w-40">
          <Select aria-label="Épico" placeholder="Épico" value={filters.epicId} options={epics.map((e) => ({ value: e.id, label: e.name }))} onChange={(e) => { set('epicId', e.target.value); }} />
        </div>
      )}
      {project.labels.length > 0 && (
        <div className="w-36">
          <Select aria-label="Etiqueta" placeholder="Etiqueta" value={filters.labelId} options={project.labels.map((l) => ({ value: l.id, label: l.name }))} onChange={(e) => { set('labelId', e.target.value); }} />
        </div>
      )}
      <div className="w-44">
        <Select
          aria-label="Prazo"
          placeholder="Prazo"
          value={filters.due}
          options={[
            { value: 'overdue', label: 'Atrasadas' },
            { value: 'this_week', label: 'Vencem esta semana' },
          ]}
          onChange={(e) => { set('due', e.target.value); }}
        />
      </div>
      <Checkbox label="Só as minhas" checked={filters.mine} onChange={(e) => { set('mine', e.target.checked); }} />
      {JSON.stringify(filters) !== JSON.stringify(EMPTY) && (
        <Button variant="ghost" size="sm" onClick={() => { onChange(EMPTY); }}>Limpar filtros</Button>
      )}
      <SavedFilters project={project} filters={filters} onApply={onChange} />
    </div>
  );
}

/** Barra de ações em massa (lista e backlog). */
function BulkBar({
  project,
  selected,
  epics,
  inBacklog,
  onDone,
}: {
  project: ProjectDetailDto;
  selected: string[];
  epics: { id: string; name: string }[];
  inBacklog: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [assignee, setAssignee] = useState<UserRef | null>(null);
  const run = useMutation({
    mutationFn: (change: Record<string, unknown>) => api.post<{ updated: number; skipped: number }>('/tasks/bulk', { taskIds: selected, ...change }),
    onSuccess: (r) => {
      toast(`${String(r.updated)} tarefa(s) atualizada(s)${r.skipped ? `; ${String(r.skipped)} sem permissão ou chamado` : ''}.`);
      void queryClient.invalidateQueries({ queryKey: keys.board(project.id) });
      onDone();
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  if (!selected.length) return null;
  return (
    <div role="toolbar" aria-label="Ações em massa" className="sticky top-[76px] z-20 flex flex-wrap items-center gap-2.5 rounded-sm border border-navy-200 bg-navy-050 px-[15px] py-2.5">
      <strong className="text-sm text-navy-700">{selected.length} selecionada(s)</strong>
      <div className="w-56">
        <Select
          aria-label="Mover para a coluna"
          placeholder={inBacklog ? 'Enviar ao quadro em...' : 'Mover para...'}
          value=""
          options={project.columns.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => { if (e.target.value) run.mutate({ columnId: e.target.value }); }}
        />
      </div>
      <div className="w-36">
        <Select aria-label="Mudar prioridade" placeholder="Prioridade" value="" options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} onChange={(e) => { if (e.target.value) run.mutate({ priority: e.target.value }); }} />
      </div>
      {epics.length > 0 && (
        <div className="w-40">
          <Select aria-label="Mudar épico" placeholder="Épico" value="" options={[{ value: 'none', label: 'Sem épico' }, ...epics.map((e) => ({ value: e.id, label: e.name }))]} onChange={(e) => { if (e.target.value) run.mutate({ epicId: e.target.value === 'none' ? null : e.target.value }); }} />
        </div>
      )}
      <div className="w-52">
        <PeoplePicker
          label="Atribuir a"
          placeholder="Atribuir a..."
          value={assignee}
          departmentIds={[project.departmentId]}
          onChange={(u) => {
            setAssignee(null);
            if (u) run.mutate({ assigneeId: u.id });
          }}
        />
      </div>
      {!inBacklog && (
        <Button variant="outline" size="sm" icon={<Archive size={13} />} onClick={() => { run.mutate({ inBacklog: true }); }}>
          Mandar para o backlog
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        icon={<Trash2 size={13} />}
        onClick={() => {
          if (window.confirm(`Mover ${String(selected.length)} tarefa(s) para a lixeira?`)) run.mutate({ delete: true });
        }}
      >
        Excluir
      </Button>
    </div>
  );
}

// RF-5.13: lista com ordenação; também é a base do backlog. Com seleção para ações em massa.
function TaskTableView({
  project,
  tasks,
  onOpen,
  selected,
  onSelect,
}: {
  project: ProjectDetailDto;
  tasks: TaskCardDto[];
  onOpen: (t: TaskCardDto) => void;
  selected: string[];
  onSelect: (ids: string[]) => void;
}) {
  const columnName = (id: string) => project.columns.find((c) => c.id === id)?.name ?? '';
  const priorityRank = { low: 0, medium: 1, high: 2, urgent: 3 } as const;
  const allSelected = tasks.length > 0 && tasks.every((t) => selected.includes(t.id));
  const toggle = (id: string) => {
    onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };
  const columns: Column<TaskCardDto>[] = [
    ...(project.canEdit
      ? [
          {
            key: 'select',
            header: (
              <input
                type="checkbox"
                aria-label="Selecionar todas"
                checked={allSelected}
                onChange={() => { onSelect(allSelected ? [] : tasks.map((t) => t.id)); }}
                className="size-4 accent-navy-700"
              />
            ),
            render: (t: TaskCardDto) => (
              <input
                type="checkbox"
                aria-label={`Selecionar ${t.code}`}
                checked={selected.includes(t.id)}
                onClick={(e) => { e.stopPropagation(); }}
                onChange={() => { toggle(t.id); }}
                className="size-4 accent-navy-700"
              />
            ),
          },
        ]
      : []),
    { key: 'code', header: 'Código', sortValue: (t) => t.ticket?.code ?? t.code, render: (t) => <span className="font-semibold text-navy-700">{t.ticket?.code ?? t.code}</span> },
    { key: 'title', header: 'Título', sortValue: (t) => t.title.toLowerCase(), render: (t) => <span className="whitespace-normal">{t.title}{t.epic && <span className="ml-1.5 text-xs text-muted">· {t.epic.name}</span>}</span> },
    { key: 'status', header: 'Status', sortValue: (t) => columnName(t.columnId), render: (t) => (t.ticket ? <TicketStatusBadge status={t.ticket.status} /> : columnName(t.columnId)) },
    { key: 'assignee', header: 'Responsável', sortValue: (t) => t.assignee?.name ?? null, render: (t) => (t.assignee ? <span className="flex items-center gap-2"><Avatar name={t.assignee.name} src={t.assignee.avatarUrl} size={22} />{t.assignee.name}</span> : <span className="text-faint">—</span>) },
    { key: 'priority', header: 'Prioridade', sortValue: (t) => priorityRank[t.priority], render: (t) => <PriorityBadge priority={t.priority} /> },
    { key: 'due', header: 'Prazo', sortValue: (t) => t.dueDate, render: (t) => <DueDate date={t.dueDate} done={t.statusCategory === 'done'} /> },
  ];
  return (
    <Card flush>
      <DataTable caption={`Tarefas de ${project.name}`} rows={tasks} rowKey={(t) => t.id} onRowClick={onOpen} empty={<EmptyState title="Nenhuma tarefa" />} columns={columns} />
    </Card>
  );
}

function BacklogQuickAdd({ project, inputRef }: { project: ProjectDetailDto; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [title, setTitle] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();
  const create = useMutation({
    mutationFn: () => api.post('/tasks', { projectId: project.id, title, inBacklog: true }),
    onSuccess: () => {
      setTitle('');
      void queryClient.invalidateQueries({ queryKey: keys.board(project.id) });
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  return (
    <form
      className="flex gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) create.mutate();
      }}
    >
      <div className="max-w-xl flex-1">
        <Input ref={inputRef} aria-label="Nova tarefa no backlog" placeholder="Nova tarefa no backlog: título e Enter (c)" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); }} />
      </div>
      <Button type="submit" variant="outline" icon={<Plus size={14} />} disabled={!title.trim()}>
        Adicionar
      </Button>
    </form>
  );
}

/** Raias (swimlanes): o quadro repetido por responsável, prioridade ou épico. */
function laneGroups(tasks: TaskCardDto[], lane: Swimlane): { key: string; title: string; tasks: TaskCardDto[] }[] {
  if (lane === 'none') return [{ key: 'all', title: '', tasks }];
  const map = new Map<string, { title: string; tasks: TaskCardDto[] }>();
  const add = (key: string, title: string, t: TaskCardDto) => {
    const g = map.get(key) ?? { title, tasks: [] };
    g.tasks.push(t);
    map.set(key, g);
  };
  for (const t of tasks) {
    if (lane === 'assignee') add(t.assignee?.id ?? '~', t.assignee?.name ?? 'Sem responsável', t);
    if (lane === 'priority') add(t.priority, PRIORITY_LABELS[t.priority], t);
    if (lane === 'epic') add(t.epic?.id ?? '~', t.epic?.name ?? 'Sem épico', t);
  }
  const order = lane === 'priority' ? ['urgent', 'high', 'medium', 'low'] : null;
  return [...map.entries()]
    .sort(([a, ga], [b, gb]) => (order ? order.indexOf(a) - order.indexOf(b) : a === '~' ? 1 : b === '~' ? -1 : ga.title.localeCompare(gb.title)))
    .map(([key, g]) => ({ key, ...g }));
}

export function BoardPage() {
  const { key = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [view, setView] = useState<View>(() => (storageGet('hub:view') as View | null) ?? 'board');
  const [lane, setLane] = useState<Swimlane>(() => (storageGet('hub:lane') as Swimlane | null) ?? 'none');
  const [selected, setSelected] = useState<string[]>([]);
  const [newTask, setNewTask] = useState(false);
  const [settings, setSettings] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const backlogRef = useRef<HTMLInputElement>(null);
  const openCode = params.get('tarefa');

  const project = useQuery({
    queryKey: keys.project(key.toUpperCase()),
    queryFn: () => api.get<ProjectDetailDto>(`/projects/by-key/${encodeURIComponent(key)}`),
  });
  const p = project.data;
  const epics = useEpics(p?.id);
  const openEpics = useMemo(() => (epics.data ?? []).filter((e) => e.status === 'open'), [epics.data]);
  const isBacklog = view === 'backlog';
  const tasks = useQuery({
    queryKey: [...keys.board(p?.id ?? ''), filters, isBacklog],
    queryFn: () => api.get<TaskCardDto[]>(`/projects/${p?.id ?? ''}/tasks${qs({ ...filters, backlog: isBacklog })}`),
    enabled: Boolean(p),
  });

  const changeView = (v: View) => {
    setView(v);
    setSelected([]);
    storageSet('hub:view', v);
  };
  const canCreate = Boolean(p?.canEdit && p.kind === 'regular');
  useHotkey('c', () => {
    if (isBacklog) backlogRef.current?.focus();
    else setNewTask(true);
  }, canCreate);
  useHotkey('b', () => { changeView(isBacklog ? 'board' : 'backlog'); }, p?.kind === 'regular');
  useHotkey('f', () => searchRef.current?.focus());

  if (project.isPending) return <Spinner />;
  if (!p) {
    return (
      <Card>
        <EmptyState title="Projeto não encontrado" description="Ele pode ter sido arquivado ou você não tem acesso." action={<Link to="/departamentos">Ver departamentos</Link>} />
      </Card>
    );
  }

  const open = (t: TaskCardDto) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tarefa', t.code);
      return next;
    });
  };
  const close = () => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('tarefa');
      return next;
    });
  };
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY);
  const ctx: QuickEditContext = { departmentId: p.departmentId, epics: openEpics, canEdit: p.canEdit };
  const list = tasks.data ?? [];
  const views: { id: View; label: string; icon: React.ReactNode }[] = [
    { id: 'board', label: 'Quadro', icon: <LayoutGrid size={14} /> },
    { id: 'list', label: 'Lista', icon: <Rows3 size={14} /> },
    ...(p.kind === 'regular' ? [{ id: 'backlog' as const, label: 'Backlog', icon: <Archive size={14} /> }] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={p.name}
        subtitle={`${p.departmentName} · ${p.key}${p.endDate ? ` · até ${formatDate(p.endDate)}` : ''}`}
        actions={
          <>
            <div className="flex rounded-pill border border-subtle bg-card p-0.5" role="group" aria-label="Visão">
              {views.map((v) => (
                <Button key={v.id} size="sm" variant={view === v.id ? 'primary' : 'ghost'} aria-pressed={view === v.id} icon={v.icon} onClick={() => { changeView(v.id); }}>
                  {v.label}
                </Button>
              ))}
            </div>
            {view === 'board' && (
              <div className="w-40">
                <Select
                  aria-label="Raias"
                  value={lane}
                  options={SWIMLANES.filter((l) => l !== 'epic' || openEpics.length).map((l) => ({ value: l, label: SWIMLANE_LABELS[l] }))}
                  onChange={(e) => {
                    setLane(e.target.value as Swimlane);
                    storageSet('hub:lane', e.target.value);
                  }}
                />
              </div>
            )}
            {p.canEdit && (
              <Button variant="outline" icon={<Settings2 size={14} />} onClick={() => { setSettings(true); }}>
                Configurar
              </Button>
            )}
            {canCreate && !isBacklog && (
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => { setNewTask(true); }}>
                Nova tarefa
              </Button>
            )}
            {p.kind === 'tickets' && <Link to="/chamados/novo" className="text-sm">Abrir chamado para outro departamento</Link>}
          </>
        }
      />
      <FiltersBar project={p} filters={filters} onChange={setFilters} epics={openEpics} searchRef={searchRef} />
      {isBacklog && canCreate && <BacklogQuickAdd project={p} inputRef={backlogRef} />}
      {view !== 'board' && p.canEdit && (
        <BulkBar project={p} selected={selected} epics={openEpics} inBacklog={isBacklog} onDone={() => { setSelected([]); }} />
      )}
      {filtered && view === 'board' && <p className="m-0 text-xs text-muted">Com filtros ativos, arrastar fica desligado.</p>}
      {isBacklog && <p className="m-0 text-xs text-muted">O backlog guarda o que ainda não entrou no quadro. Selecione e use "Enviar ao quadro em..." para puxar o trabalho.</p>}

      {tasks.isPending ? (
        <Spinner />
      ) : view === 'board' ? (
        lane === 'none' ? (
          <KanbanBoard project={p} tasks={list} filtered={filtered} onOpen={open} ctx={ctx} />
        ) : (
          <div className="flex flex-col gap-5">
            {laneGroups(list, lane).map((g) => (
              <section key={g.key} aria-label={`Raia ${g.title}`} className="flex flex-col gap-2.5">
                <h2 className="m-0 flex items-center gap-2 text-base font-semibold">
                  {g.title}
                  <span className="rounded-pill bg-gray-200 px-2 text-xs text-gray-600">{g.tasks.length}</span>
                </h2>
                <KanbanBoard project={p} tasks={g.tasks} filtered={filtered} onOpen={open} ctx={ctx} lane={g.key} />
              </section>
            ))}
            {!list.length && <EmptyState title="Nenhuma tarefa no quadro" />}
          </div>
        )
      ) : (
        <TaskTableView project={p} tasks={list} onOpen={open} selected={selected} onSelect={setSelected} />
      )}

      <Drawer open={Boolean(openCode)} label="Detalhes da tarefa" onClose={close}>
        {openCode && <TaskDetail code={openCode} onClose={close} />}
      </Drawer>
      <NewTaskModal open={newTask} project={p} onClose={() => { setNewTask(false); }} />
      {p.canEdit && <ProjectSettingsModal open={settings} project={p} onClose={() => { setSettings(false); }} />}
    </div>
  );
}
