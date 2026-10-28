import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  createTaskSchema,
  type Priority,
  type ProjectDetailDto,
  type RichNode,
  type TaskDetailDto,
  type UserRef,
} from '@hub/shared';
import { Button, Field, Input, Modal, Select, useToast } from '@/design-system';
import { PeoplePicker } from '@/components/PeoplePicker';
import { RichTextEditor } from '@/components/RichTextEditor';
import { api, errorMessage } from '@/lib/api';
import { keys } from '@/lib/queries';
import { useEpics, useTemplates } from '../board/projectQueries';
import { DueDateWarning } from './DueDateWarning';

/** RF-6.1: formulário completo de tarefa. */
export function NewTaskModal({
  open,
  project,
  onClose,
  defaultDueDate,
}: {
  open: boolean;
  project: ProjectDetailDto;
  onClose: () => void;
  defaultDueDate?: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [columnId, setColumnId] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [assignee, setAssignee] = useState<UserRef | null>(null);
  const [dueDate, setDueDate] = useState(defaultDueDate ?? '');
  const [startDate, setStartDate] = useState('');
  const [description, setDescription] = useState<RichNode | null>(null);
  const [epicId, setEpicId] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const templates = useTemplates(open ? project.id : undefined);
  const epics = useEpics(open ? project.id : undefined);
  const openEpics = (epics.data ?? []).filter((e) => e.status === 'open');

  // RF-6.8: o modelo preenche título, prioridade e descrição (inclusive checklist).
  const applyTemplate = (id: string) => {
    const t = templates.data?.find((x) => x.id === id);
    if (!t) return;
    setTitle(t.title);
    setPriority(t.priority);
    setDescription(t.description);
    setEditorKey((k) => k + 1);
  };

  const reset = () => {
    setTitle('');
    setAssignee(null);
    setDueDate(defaultDueDate ?? '');
    setStartDate('');
    setDescription(null);
    setEpicId('');
    setEditorKey((k) => k + 1);
    setError(null);
  };

  const body = {
    projectId: project.id,
    columnId: columnId || project.columns[0]?.id,
    title,
    priority,
    assigneeId: assignee?.id ?? null,
    dueDate: dueDate || null,
    startDate: startDate || null,
    description,
    epicId: epicId || null,
  };

  const create = useMutation({
    mutationFn: () => api.post<TaskDetailDto>('/tasks', body),
    onSuccess: (t) => {
      toast(`Tarefa ${t.code} criada.`);
      void queryClient.invalidateQueries({ queryKey: keys.board(project.id) });
      void queryClient.invalidateQueries({ queryKey: keys.calendarAny });
      reset();
      onClose();
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });

  const submit = () => {
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
      return;
    }
    if (startDate && dueDate && startDate > dueDate) {
      setError('A data de início não pode ser depois do prazo.');
      return;
    }
    create.mutate();
  };

  return (
    <Modal
      open={open}
      title="Nova tarefa"
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={create.isPending} onClick={submit}>
            Criar tarefa
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-[15px]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {(templates.data?.length ?? 0) > 0 && (
          <Field label="Usar modelo">
            <Select
              placeholder="Nenhum"
              value=""
              options={(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
              onChange={(e) => {
                applyTemplate(e.target.value);
              }}
            />
          </Field>
        )}
        <Field label="Título" required>
          <Input data-autofocus value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); }} />
        </Field>
        <div className="grid grid-cols-1 gap-[15px] sm:grid-cols-2">
          <Field label="Coluna">
            <Select value={columnId || project.columns[0]?.id} options={project.columns.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => { setColumnId(e.target.value); }} />
          </Field>
          <Field label="Prioridade">
            <Select value={priority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} onChange={(e) => { setPriority(e.target.value as Priority); }} />
          </Field>
          <Field label="Responsável">
            <PeoplePicker label="Responsável" value={assignee} onChange={setAssignee} departmentIds={[project.departmentId]} />
          </Field>
          <Field label="Prazo">
            <Input type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); }} />
            <DueDateWarning date={dueDate} />
          </Field>
          <Field label="Início">
            <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); }} />
          </Field>
          {openEpics.length > 0 && (
            <Field label="Épico">
              <Select placeholder="Nenhum" value={epicId} options={openEpics.map((e) => ({ value: e.id, label: e.name }))} onChange={(e) => { setEpicId(e.target.value); }} />
            </Field>
          )}
        </div>
        <Field label="Descrição">
          <RichTextEditor key={editorKey} label="Descrição" value={description} onChange={setDescription} placeholder="Detalhes, links e checklist" />
        </Field>
        {error && <p role="alert" className="m-0 text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
