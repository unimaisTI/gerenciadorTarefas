import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Copy, CopyPlus, Eye, EyeOff, FolderInput, Link2, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  formatDateTime,
  type Priority,
  type RichNode,
  type TaskDetailDto,
  type UpdateTaskInput,
} from '@hub/shared';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Spinner,
  Tabs,
  useToast,
} from '@/design-system';
import { PeoplePicker } from '@/components/PeoplePicker';
import { RichTextEditor } from '@/components/RichTextEditor';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { keys, useProjects } from '@/lib/queries';
import { DEPT_BG } from '@/lib/ui';
import { TicketPanel } from '../tickets/TicketPanel';
import { AddDriveLink, AddImageButton, AttachmentList } from './Attachments';
import { ColumnTimes, Links } from './Links';
import { Comments } from './Comments';
import { DueDateWarning } from './DueDateWarning';
import { History } from './History';

function Subtasks({ task, onChanged }: { task: TaskDetailDto; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const toast = useToast();
  const done = task.columns.find((c) => c.statusCategory === 'done');
  const todo = task.columns.find((c) => c.statusCategory === 'todo') ?? task.columns[0];
  const create = useMutation({
    mutationFn: () => api.post('/tasks', { projectId: task.projectId, parentTaskId: task.id, title, columnId: todo?.id }),
    onSuccess: () => {
      setTitle('');
      onChanged();
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; columnId: string }) => api.patch(`/tasks/${v.id}`, { columnId: v.columnId }),
    onSuccess: onChanged,
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  return (
    <section aria-labelledby="subtasks-title" className="flex flex-col gap-2.5">
      <h3 id="subtasks-title" className="m-0 text-base font-semibold">
        Subtarefas {task.subtasks.length > 0 && <span className="text-sm text-muted">({task.subtaskDone}/{task.subtaskTotal})</span>}
      </h3>
      {task.subtasks.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {task.subtasks.map((s) => {
            const isDone = s.statusCategory === 'done';
            return (
              <li key={s.id} className="flex items-center gap-2.5 rounded-sm border border-subtle bg-white px-2.5 py-1.5">
                <input
                  type="checkbox"
                  aria-label={`Concluir ${s.title}`}
                  checked={isDone}
                  disabled={!task.canEdit || !done || !todo}
                  onChange={() => {
                    const target = isDone ? todo : done;
                    if (target) toggle.mutate({ id: s.id, columnId: target.id });
                  }}
                  className="size-4 accent-navy-700"
                />
                <Link to={`/tarefas/${s.code}`} className={cn('flex-1 truncate text-sm', isDone && 'text-muted line-through')}>
                  <span className="mr-1.5 text-xs font-semibold text-navy-700">{s.code}</span>
                  {s.title}
                </Link>
                <span className="text-xs text-muted">{task.columns.find((c) => c.id === s.columnId)?.name}</span>
                {s.assignee && <Avatar name={s.assignee.name} src={s.assignee.avatarUrl} size={22} />}
              </li>
            );
          })}
        </ul>
      )}
      {task.canEdit && !task.parentTask && (
        <form
          className="flex gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate();
          }}
        >
          <Input aria-label="Nova subtarefa" placeholder="Nova subtarefa" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); }} />
          <IconButton label="Adicionar subtarefa" variant="soft" type="submit">
            <Plus size={16} />
          </IconButton>
        </form>
      )}
    </section>
  );
}

function MoveProjectModal({ task, open, onClose, onMoved }: { task: TaskDetailDto; open: boolean; onClose: () => void; onMoved: (code: string) => void }) {
  const projects = useProjects(task.project.departmentId);
  const [target, setTarget] = useState('');
  const toast = useToast();
  const move = useMutation({
    mutationFn: () => api.post<TaskDetailDto>(`/tasks/${task.id}/move-project`, { projectId: target }),
    onSuccess: (t) => {
      onClose();
      onMoved(t.code);
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  const options = (projects.data ?? []).filter((p) => p.kind === 'regular' && p.id !== task.projectId && !p.archivedAt);
  return (
    <Modal
      open={open}
      title="Mover para outro projeto"
      onClose={onClose}
      footer={<Button disabled={!target || move.isPending} onClick={() => { move.mutate(); }}>Mover</Button>}
    >
      {options.length ? (
        <Field label="Projeto de destino" hint="A tarefa ganha um código novo; etiquetas do projeto antigo são removidas.">
          <Select placeholder="Escolha" value={target} options={options.map((p) => ({ value: p.id, label: p.name }))} onChange={(e) => { setTarget(e.target.value); }} />
        </Field>
      ) : (
        <p className="m-0 text-sm text-muted">Não há outro projeto ativo neste departamento.</p>
      )}
    </Modal>
  );
}

/** RF-6.2: painel com todos os campos, comentários e histórico, sem sair do quadro. */
export function TaskDetail({ code, onClose }: { code: string; onClose?: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useAuth();
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [description, setDescription] = useState<RichNode | null | undefined>(undefined);
  const [moving, setMoving] = useState(false);

  const query = useQuery({
    queryKey: keys.task(code.toUpperCase()),
    queryFn: () => api.get<TaskDetailDto>(`/tasks/${encodeURIComponent(code)}`),
    retry: false,
  });
  const task = query.data;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.taskAny });
    if (task) void queryClient.invalidateQueries({ queryKey: keys.board(task.projectId) });
    void queryClient.invalidateQueries({ queryKey: keys.myTasks });
  };

  const update = useMutation({
    mutationFn: (patch: UpdateTaskInput) => api.patch<TaskDetailDto>(`/tasks/${task?.id ?? ''}`, patch),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.task(code.toUpperCase()), data);
      refresh();
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
      refresh();
    },
  });
  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });

  if (query.isPending) return <Spinner />;
  if (!task) {
    return (
      <div className="p-5">
        <Card>
          <EmptyState title="Tarefa não encontrada" description="Ela pode ter sido excluída ou você não tem acesso." />
        </Card>
      </div>
    );
  }

  const isTicket = Boolean(task.ticketDetail);
  const edit = task.canEdit;
  const descriptionDirty = description !== undefined && JSON.stringify(description) !== JSON.stringify(task.description);
  const copyLink = () => {
    void navigator.clipboard.writeText(`${window.location.origin}/tarefas/${task.code}`).then(() => {
      toast('Link copiado.');
    });
  };

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      {task.deletedAt && (
        <div role="status" className="rounded-sm bg-warning-050 px-[15px] py-2.5 text-sm text-warning-ink">
          Esta tarefa está na lixeira.
        </div>
      )}
      <header className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link to={`/projetos/${task.project.key}`} className="text-muted">
              {task.project.name}
            </Link>
            <span className="text-faint">/</span>
            {task.parentTask && (
              <>
                <Link to={`/tarefas/${task.parentTask.code}`}>{task.parentTask.code}</Link>
                <span className="text-faint">/</span>
              </>
            )}
            <span className="font-semibold text-navy-700">{task.code}</span>
          </div>
          {edit && !isTicket ? (
            <input
              aria-label="Título"
              defaultValue={task.title}
              maxLength={200}
              key={task.title}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== task.title) update.mutate({ title: v });
              }}
              className="mt-1 w-full rounded-xs border border-transparent bg-transparent px-1 font-title text-h4 font-bold text-strong outline-none hover:border-subtle focus:border-navy-400 focus:bg-white"
            />
          ) : (
            <h2 className="m-0 mt-1 text-h4 font-bold">{task.title}</h2>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Copiar link" onClick={copyLink}>
            <Link2 size={16} />
          </IconButton>
          <IconButton
            label={task.isWatching ? 'Deixar de seguir' : 'Seguir'}
            onClick={() => {
              action.mutate(() => api.post(`/tasks/${task.id}/watch`, { watching: !task.isWatching }));
            }}
          >
            {task.isWatching ? <EyeOff size={16} /> : <Eye size={16} />}
          </IconButton>
          {edit && !isTicket && (
            <>
              <IconButton
                label="Duplicar"
                onClick={() => {
                  action.mutate(async () => {
                    const t = await api.post<TaskDetailDto>(`/tasks/${task.id}/duplicate`);
                    toast(`Criada ${t.code}.`);
                  });
                }}
              >
                <CopyPlus size={16} />
              </IconButton>
              <IconButton
                label="Salvar como modelo"
                onClick={() => {
                  const name = window.prompt('Nome do modelo', task.title);
                  if (!name?.trim()) return;
                  action.mutate(async () => {
                    await api.post(`/projects/${task.projectId}/templates`, {
                      name: name.trim().slice(0, 80),
                      title: task.title,
                      description: task.description,
                      priority: task.priority,
                    });
                    toast('Modelo salvo. Use em "Nova tarefa".');
                  });
                }}
              >
                <BookmarkPlus size={16} />
              </IconButton>
              {!task.parentTask && (
                <IconButton label="Mover para outro projeto" onClick={() => { setMoving(true); }}>
                  <FolderInput size={16} />
                </IconButton>
              )}
            </>
          )}
          {task.canDelete && (
            <IconButton
              label="Excluir"
              variant="danger"
              onClick={() => {
                if (!window.confirm('Mover a tarefa para a lixeira? O gestor pode restaurar por 30 dias.')) return;
                action.mutate(async () => {
                  await api.del(`/tasks/${task.id}`);
                  toast('Tarefa movida para a lixeira.');
                  if (onClose) onClose();
                  else void navigate(`/projetos/${task.project.key}`);
                });
              }}
            >
              <Trash2 size={16} />
            </IconButton>
          )}
          {onClose && (
            <IconButton label="Fechar" onClick={onClose}>
              <X size={18} />
            </IconButton>
          )}
        </div>
      </header>

      {isTicket && <TicketPanel task={task} onChanged={refresh} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_260px]">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="desc-title" className="flex flex-col gap-2.5">
            <h3 id="desc-title" className="m-0 text-base font-semibold">Descrição</h3>
            {edit ? (
              <>
                <RichTextEditor
                  label="Descrição"
                  placeholder="Detalhes, links e checklist. Cole prints direto aqui."
                  uploadTaskId={task.id}
                  value={task.description}
                  onChange={setDescription}
                  minHeight={120}
                />
                {descriptionDirty && (
                  <div className="flex justify-end gap-2.5">
                    <Button variant="ghost" size="sm" onClick={() => { setDescription(undefined); }}>
                      Descartar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        update.mutate({ description: description ?? null });
                        setDescription(undefined);
                      }}
                    >
                      Salvar descrição
                    </Button>
                  </div>
                )}
              </>
            ) : task.description ? (
              <div className="rounded-sm border border-subtle bg-white px-[14px] py-2.5">
                <RichTextEditor label="Descrição" value={task.description} editable={false} />
              </div>
            ) : (
              <p className="m-0 text-sm text-muted">Sem descrição.</p>
            )}
          </section>

          {(!isTicket || task.ticketDetail?.viewerSide === 'executor') && <Subtasks task={task} onChanged={refresh} />}

          <Links task={task} onChanged={refresh} />

          <section aria-labelledby="att-title" className="flex flex-col gap-2.5">
            <h3 id="att-title" className="m-0 text-base font-semibold">Anexos</h3>
            <AttachmentList items={task.attachments} canRemove={(a) => edit || a.addedBy.id === me.id} onChanged={refresh} />
            {task.canComment && (
              <div className="flex flex-wrap gap-2.5">
                <AddImageButton taskId={task.id} onAdded={refresh} />
                <AddDriveLink taskId={task.id} onAdded={refresh} />
              </div>
            )}
          </section>

          <section className="flex flex-col gap-[15px]">
            <Tabs
              label="Atividade"
              active={tab}
              onChange={setTab}
              tabs={[
                { id: 'comments', label: 'Comentários', count: task.commentCount },
                { id: 'history', label: 'Histórico' },
              ]}
            />
            {tab === 'comments' ? (
              <Comments taskId={task.id} canComment={task.canComment} allowInternal={isTicket && task.ticketDetail?.viewerSide === 'executor'} />
            ) : (
              <>
                <ColumnTimes times={task.columnTimes} />
                <History taskId={task.id} />
              </>
            )}
          </section>
        </div>

        <aside aria-label="Campos da tarefa" className="flex flex-col gap-[15px]">
          <Field label="Status">
            <Select
              disabled={!edit || isTicket}
              value={task.columnId}
              options={task.columns.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(e) => {
                update.mutate({ columnId: e.target.value });
              }}
            />
          </Field>
          {!isTicket && (
            <Field label="Responsável">
              <PeoplePicker
                label="Responsável"
                disabled={!edit}
                value={task.assignee}
                departmentIds={[task.project.departmentId]}
                onChange={(u) => {
                  update.mutate({ assigneeId: u?.id ?? null });
                }}
              />
            </Field>
          )}
          <Field label="Prioridade">
            <Select
              disabled={!edit}
              value={task.priority}
              options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
              onChange={(e) => {
                update.mutate({ priority: e.target.value as Priority });
              }}
            />
          </Field>
          {!isTicket && (
            <Field label="Prazo">
              <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                <Input
                  type="date"
                  disabled={!edit}
                  defaultValue={task.dueDate ?? ''}
                  key={`due-${task.dueDate ?? ''}`}
                  onBlur={(e) => {
                    if ((e.target.value || null) !== task.dueDate) update.mutate({ dueDate: e.target.value || null });
                  }}
                />
                <Input
                  type="time"
                  aria-label="Hora do prazo"
                  disabled={!edit || !task.dueDate}
                  defaultValue={task.dueTime ?? ''}
                  key={`time-${task.dueTime ?? ''}`}
                  className="px-2"
                  onBlur={(e) => {
                    if ((e.target.value || null) !== task.dueTime) update.mutate({ dueTime: e.target.value || null });
                  }}
                />
              </div>
              <DueDateWarning date={task.dueDate} />
            </Field>
          )}
          {(task.epicsAvailable.length > 0 || task.epic) && (
            <Field label="Épico">
              <Select
                disabled={!edit}
                placeholder="Nenhum"
                value={task.epic?.id ?? ''}
                options={[
                  ...task.epicsAvailable.map((e) => ({ value: e.id, label: e.name })),
                  ...(task.epic && !task.epicsAvailable.some((e) => e.id === task.epic?.id) ? [{ value: task.epic.id, label: task.epic.name }] : []),
                ]}
                onChange={(e) => {
                  update.mutate({ epicId: e.target.value || null });
                }}
              />
            </Field>
          )}
          <Field label="Início">
            <Input
              type="date"
              disabled={!edit}
              defaultValue={task.startDate ?? ''}
              key={`start-${task.startDate ?? ''}`}
              onBlur={(e) => {
                if ((e.target.value || null) !== task.startDate) update.mutate({ startDate: e.target.value || null });
              }}
            />
          </Field>
          <Field label="Estimativa (horas)">
            <Input
              type="number"
              min={0}
              step={0.5}
              disabled={!edit}
              defaultValue={task.estimate ?? ''}
              key={`est-${String(task.estimate)}`}
              onBlur={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value);
                if (v !== task.estimate) update.mutate({ estimate: v });
              }}
            />
          </Field>
          {task.labelsAvailable.length > 0 && (
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
              <legend className="mb-1.5 text-sm font-medium text-strong">Etiquetas</legend>
              <div className="flex flex-wrap gap-1.5">
                {task.labelsAvailable.map((l) => {
                  const on = task.labels.some((x) => x.id === l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={on}
                      disabled={!edit}
                      onClick={() => {
                        const ids = on ? task.labels.filter((x) => x.id !== l.id).map((x) => x.id) : [...task.labels.map((x) => x.id), l.id];
                        update.mutate({ labelIds: ids });
                      }}
                      className={cn(
                        'cursor-pointer rounded-pill border px-2.5 py-0.5 text-xs',
                        on ? cn('border-transparent text-white', DEPT_BG[l.color]) : 'border-subtle bg-white text-body',
                      )}
                    >
                      {l.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-strong">Participantes</span>
            <div className="flex flex-wrap gap-1.5">
              {task.watchers.map((w) => (
                <Avatar key={w.id} name={w.name} src={w.avatarUrl} size={26} />
              ))}
              {!task.watchers.length && <span className="text-xs text-muted">Ninguém segue esta tarefa.</span>}
            </div>
            {edit && (
              <PeoplePicker
                label="Adicionar participante"
                placeholder="Adicionar participante"
                value={null}
                onChange={(u) => {
                  if (u && !task.watchers.some((w) => w.id === u.id)) {
                    update.mutate({ watcherIds: [...task.watchers.map((w) => w.id), u.id] });
                  }
                }}
              />
            )}
          </div>
          <div className="border-t border-subtle pt-[15px] text-xs text-muted">
            <p className="m-0">Criada por {task.reporter.name}</p>
            <p className="m-0">em {formatDateTime(task.createdAt)}</p>
            <p className="m-0">Atualizada em {formatDateTime(task.updatedAt)}</p>
            <Button
              variant="ghost"
              size="sm"
              icon={<Copy size={13} />}
              className="mt-1.5 -ml-2"
              onClick={copyLink}
            >
              Copiar endereço
            </Button>
          </div>
        </aside>
      </div>
      <MoveProjectModal task={task} open={moving} onClose={() => { setMoving(false); }} onMoved={(c) => { void navigate(`/tarefas/${c}`); }} />
    </div>
  );
}
