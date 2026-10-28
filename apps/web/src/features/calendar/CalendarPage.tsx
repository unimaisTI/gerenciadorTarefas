import ptBrLocale from '@fullcalendar/core/locales/pt-br';
import type { DatesSetArg, EventClickArg, EventDropArg, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import FullCalendar from '@fullcalendar/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import {
  CALENDAR_EVENT_KIND_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  addDays,
  formatNumber,
  permissions,
  type CalendarItemDto,
  type DepartmentColor,
} from '@hub/shared';
import {
  Button,
  Card,
  Checkbox,
  Drawer,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
} from '@/design-system';
import { PeoplePicker } from '@/components/PeoplePicker';
import { api, errorMessage, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { keys, useDepartments, useProjects } from '@/lib/queries';
import { PageHeader, deptColorVar } from '@/lib/ui';
import { DueDateWarning } from '../tasks/DueDateWarning';
import { TaskDetail } from '../tasks/TaskDetail';

type Kind = CalendarItemDto['kind'];
const KIND_LABELS: Record<Exclude<Kind, 'event'>, string> = {
  task: 'Tarefas',
  ticket_received: 'Chamados recebidos',
  ticket_sent: 'Chamados enviados',
};

function toEvent(item: CalendarItemDto): EventInput {
  const color = item.departmentColor ? deptColorVar(item.departmentColor) : 'var(--gray-500)';
  const isEvent = item.kind === 'event';
  return {
    id: `${item.kind}:${item.id}`,
    title: isEvent ? item.title : `${item.code ?? ''} ${item.title}`,
    start: item.start,
    // FullCalendar usa fim exclusivo em eventos de dia inteiro.
    ...(item.end && { end: addDays(item.end, 1) }),
    allDay: true,
    editable: item.canDrag,
    backgroundColor: isEvent ? 'var(--navy-050)' : item.kind === 'ticket_sent' ? 'var(--white)' : color,
    borderColor: item.overdue ? 'var(--red-500)' : isEvent ? 'var(--navy-100)' : color,
    textColor: isEvent || item.kind === 'ticket_sent' ? 'var(--navy-900)' : 'var(--white)',
    classNames: cn(
      `cal-${item.kind}`,
      item.overdue && 'cal-overdue',
      item.done && 'cal-done',
      isEvent && `cal-event-${item.eventKind ?? 'event'}`,
    ).split(' '),
    extendedProps: item,
    display: 'block',
  };
}

export function CalendarPage() {
  const { id: departmentId } = useParams();
  const [, setParams] = useSearchParams();
  const { viewer } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const departments = useDepartments();
  const projects = useProjects(departmentId);
  const calendarRef = useRef<FullCalendar>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [hiddenDepts, setHiddenDepts] = useState<string[]>([]);
  const [kinds, setKinds] = useState<Kind[]>(['task', 'ticket_received', 'ticket_sent', 'event']);
  const [projectId, setProjectId] = useState('');
  const [assignee, setAssignee] = useState<{ id: string; name: string; avatarUrl: string | null } | null>(null);
  const [priority, setPriority] = useState('');
  const [mine, setMine] = useState(false);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ item: CalendarItemDto; newDate: string; revert: () => void } | null>(null);
  const [reason, setReason] = useState('');
  const [create, setCreate] = useState<string | null>(null);
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;

  const dept = departments.data?.find((d) => d.id === departmentId);
  const items = useQuery({
    queryKey: [...keys.calendarAny, departmentId ?? 'geral', range],
    queryFn: () => api.get<CalendarItemDto[]>(`/calendar${qs({ from: range?.from, to: range?.to, departmentId })}`),
    enabled: Boolean(range),
  });

  const filtered = useMemo(
    () =>
      (items.data ?? []).filter((i) => {
        if (!kinds.includes(i.kind)) return false;
        if (i.kind === 'event') return true;
        if (i.departmentId && hiddenDepts.includes(i.departmentId)) return false;
        if (projectId && i.projectId !== projectId) return false;
        if (priority && i.priority !== priority) return false;
        if (assignee && i.assigneeId !== assignee.id) return false;
        if (mine && i.assigneeId !== viewer.id) return false;
        return true;
      }),
    [items.data, kinds, hiddenDepts, projectId, priority, assignee, mine, viewer.id],
  );

  // RF-14.12: resumo do período por departamento.
  const summary = useMemo(() => {
    const map = new Map<string, { acronym: string; color: DepartmentColor; total: number; overdue: number; done: number }>();
    for (const i of filtered) {
      if (i.kind === 'event' || !i.departmentId || !i.departmentAcronym || !i.departmentColor) continue;
      const row = map.get(i.departmentId) ?? { acronym: i.departmentAcronym, color: i.departmentColor, total: 0, overdue: 0, done: 0 };
      row.total += 1;
      if (i.overdue) row.overdue += 1;
      if (i.done) row.done += 1;
      map.set(i.departmentId, row);
    }
    return [...map.values()];
  }, [filtered]);

  const legend = (departments.data ?? []).filter((d) => viewer.seesAllDepartments || viewer.departmentIds.includes(d.id) || (items.data ?? []).some((i) => i.departmentId === d.id));

  const saveDue = useMutation({
    mutationFn: (v: { item: CalendarItemDto; newDate: string; reason?: string }) => {
      const shift = v.item.end ? { startDate: v.newDate, dueDate: addDays(v.newDate, Math.round((Date.parse(v.item.end) - Date.parse(v.item.start)) / 86_400_000)) } : { dueDate: v.newDate };
      return api.patch(`/tasks/${v.item.id}`, { ...shift, ...(v.reason && { dueChangeReason: v.reason }) });
    },
    onSuccess: () => {
      toast('Prazo alterado.');
      void queryClient.invalidateQueries({ queryKey: keys.calendarAny });
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
      void queryClient.invalidateQueries({ queryKey: keys.calendarAny });
    },
  });

  const quickCreate = useMutation({
    mutationFn: (v: { projectId: string; title: string; dueDate: string }) => api.post('/tasks', v),
    onSuccess: () => {
      setCreate(null);
      void queryClient.invalidateQueries({ queryKey: keys.calendarAny });
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  const [newTitle, setNewTitle] = useState('');
  const [newProject, setNewProject] = useState('');
  const creatableProjects = (projects.data ?? []).filter((p) => p.kind === 'regular' && !p.archivedAt && permissions.editTasks(viewer, p.departmentId));

  const onDrop = (arg: EventDropArg) => {
    const item = arg.event.extendedProps as CalendarItemDto;
    const newDate = arg.event.startStr.slice(0, 10);
    if (item.kind === 'ticket_received') {
      setReason('');
      setDrop({ item, newDate, revert: arg.revert });
      return;
    }
    saveDue.mutate({ item, newDate });
  };

  const onClick = (arg: EventClickArg) => {
    const item = arg.event.extendedProps as CalendarItemDto;
    if (item.kind === 'event') {
      toast(`${CALENDAR_EVENT_KIND_LABELS[item.eventKind ?? 'event']}: ${item.title}`, 'info');
      return;
    }
    if (item.code) setOpenCode(item.code);
  };

  const onDateClick = (arg: DateClickArg) => {
    if (!creatableProjects.length) return;
    setNewTitle('');
    setNewProject(creatableProjects[0]?.id ?? '');
    setCreate(arg.dateStr.slice(0, 10));
  };

  const title = dept ? `Calendário de ${dept.name}` : 'Calendário geral';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} subtitle="Prazos de tarefas e chamados, eventos e feriados." />

      {summary.length > 0 && (
        <div className="flex flex-wrap gap-2.5" aria-label="Resumo do período">
          {summary.map((s) => (
            <div key={s.acronym} className="flex items-center gap-2.5 rounded-sm border border-subtle bg-card px-[15px] py-2 text-sm shadow-sm">
              <span className="size-2.5 rounded-full" style={{ background: deptColorVar(s.color) }} aria-hidden="true" />
              <strong>{s.acronym}</strong>
              <span>{formatNumber(s.total)} entregas</span>
              <span className={s.overdue ? 'font-semibold text-red-600' : 'text-muted'}>{formatNumber(s.overdue)} atrasadas</span>
              <span className="text-success">{formatNumber(s.done)} concluídas</span>
            </div>
          ))}
        </div>
      )}

      <Card>
        <div className="mb-[15px] flex flex-wrap items-center gap-2.5">
          {departmentId && (
            <div className="w-48">
              <Select aria-label="Projeto" placeholder="Todos os projetos" value={projectId} options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} onChange={(e) => { setProjectId(e.target.value); }} />
            </div>
          )}
          <div className="w-52">
            <PeoplePicker label="Responsável" placeholder="Responsável" value={assignee} onChange={setAssignee} />
          </div>
          <div className="w-36">
            <Select aria-label="Prioridade" placeholder="Prioridade" value={priority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} onChange={(e) => { setPriority(e.target.value); }} />
          </div>
          {(Object.keys(KIND_LABELS) as Exclude<Kind, 'event'>[]).map((k) => (
            <Checkbox
              key={k}
              label={KIND_LABELS[k]}
              checked={kinds.includes(k)}
              onChange={(e) => {
                setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k));
              }}
            />
          ))}
          <Checkbox label="Só as minhas" checked={mine} onChange={(e) => { setMine(e.target.checked); }} />
        </div>

        {!departmentId && legend.length > 0 && (
          <div className="mb-[15px] flex flex-wrap gap-2" role="group" aria-label="Departamentos (clique para mostrar ou ocultar)">
            {legend.map((d) => {
              const hidden = hiddenDepts.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={!hidden}
                  onClick={() => {
                    setHiddenDepts(hidden ? hiddenDepts.filter((x) => x !== d.id) : [...hiddenDepts, d.id]);
                  }}
                  className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-pill border border-subtle bg-white px-2.5 py-1 text-xs', hidden && 'opacity-50 line-through')}
                >
                  <span className="size-2.5 rounded-full" style={{ background: deptColorVar(d.color) }} aria-hidden="true" />
                  {d.acronym}
                </button>
              );
            })}
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="inline-block h-3 w-5 rounded-xs border border-dashed border-gray-500" aria-hidden="true" /> chamado enviado
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="inline-block h-3 w-5 rounded-xs border-2 border-red-500" aria-hidden="true" /> atrasado
            </span>
          </div>
        )}

        <div className="hub-calendar">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, listPlugin, interactionPlugin]}
            locale={ptBrLocale}
            timeZone="America/Sao_Paulo"
            initialView={isMobile ? 'listMonth' : 'dayGridMonth'}
            headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek,listMonth' }}
            buttonText={{ today: 'Hoje', month: 'Mês', week: 'Semana', list: 'Agenda' }}
            height="auto"
            dayMaxEvents={3}
            moreLinkText={(n) => `+${String(n)} mais`}
            events={filtered.map(toEvent)}
            eventOrder="-cal-event,title"
            editable
            eventDurationEditable={false}
            eventDrop={onDrop}
            eventClick={onClick}
            dateClick={onDateClick}
            datesSet={(arg: DatesSetArg) => {
              setRange({ from: arg.startStr.slice(0, 10), to: arg.endStr.slice(0, 10) });
            }}
            noEventsText="Nada neste período."
          />
        </div>
      </Card>

      <Drawer open={Boolean(openCode)} label="Detalhes" onClose={() => { setOpenCode(null); setParams({}); }}>
        {openCode && <TaskDetail code={openCode} onClose={() => { setOpenCode(null); }} />}
      </Drawer>

      <Modal
        open={drop !== null}
        title="Alterar prazo do chamado"
        onClose={() => {
          drop?.revert();
          setDrop(null);
        }}
        footer={
          <Button
            disabled={!reason.trim()}
            onClick={() => {
              if (drop) saveDue.mutate({ item: drop.item, newDate: drop.newDate, reason: reason.trim() });
              setDrop(null);
            }}
          >
            Salvar
          </Button>
        }
      >
        <div className="flex flex-col gap-[15px]">
          <p className="m-0 text-sm">Novo prazo: <strong>{drop ? drop.newDate.split('-').reverse().join('/') : ''}</strong>. O solicitante será avisado.</p>
          <DueDateWarning date={drop?.newDate} />
          <Field label="Motivo" required>
            <Textarea data-autofocus value={reason} maxLength={500} onChange={(e) => { setReason(e.target.value); }} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={create !== null}
        title="Nova tarefa com prazo"
        onClose={() => { setCreate(null); }}
        footer={
          <Button
            disabled={!newTitle.trim() || !newProject || quickCreate.isPending}
            onClick={() => {
              if (create) quickCreate.mutate({ projectId: newProject, title: newTitle.trim(), dueDate: create });
            }}
          >
            Criar
          </Button>
        }
      >
        <div className="flex flex-col gap-[15px]">
          <p className="m-0 text-sm">Prazo: <strong>{create?.split('-').reverse().join('/')}</strong></p>
          <DueDateWarning date={create} />
          <Field label="Projeto">
            <Select value={newProject} options={creatableProjects.map((p) => ({ value: p.id, label: `${p.departmentName} · ${p.name}` }))} onChange={(e) => { setNewProject(e.target.value); }} />
          </Field>
          <Field label="Título" required>
            <Input data-autofocus value={newTitle} maxLength={200} onChange={(e) => { setNewTitle(e.target.value); }} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
