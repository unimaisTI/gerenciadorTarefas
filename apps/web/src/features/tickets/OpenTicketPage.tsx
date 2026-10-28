import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  openTicketSchema,
  parseDriveLink,
  type Priority,
  type RichNode,
  type UserRef,
} from '@hub/shared';
import { AlertBanner, Button, Card, Field, IconButton, Input, Select, useToast } from '@/design-system';
import { PeoplePicker } from '@/components/PeoplePicker';
import { RichTextEditor } from '@/components/RichTextEditor';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys, useDepartments, useTicketTypes } from '@/lib/queries';
import { PageHeader } from '@/lib/ui';
import { DueDateWarning } from '../tasks/DueDateWarning';

/** RF-7.1: departamento de destino, tipo, título, descrição, prioridade, prazo desejado e anexos. */
export function OpenTicketPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { viewer } = useAuth();
  const departments = useDepartments();
  const [target, setTarget] = useState('');
  const types = useTicketTypes(target || undefined);
  const [typeId, setTypeId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState<RichNode | null>(null);
  const [priority, setPriority] = useState<Priority>('medium');
  const [desired, setDesired] = useState('');
  const [approver, setApprover] = useState<UserRef | null>(null);
  const [links, setLinks] = useState<{ url: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const targets = (departments.data ?? []).filter((d) => d.acceptsTickets && !viewer.departmentIds.includes(d.id));
  const typeOptions = types.data ?? [];
  const effectiveType = typeId || (typeOptions.length === 1 ? typeOptions[0]?.id ?? '' : '');

  const body = {
    targetDepartmentId: target,
    ticketTypeId: effectiveType,
    title,
    description,
    priority,
    desiredDueDate: desired || null,
    approverId: approver?.id ?? null,
    attachments: links.filter((l) => l.url.trim()).map((l) => ({ url: l.url.trim(), name: l.name.trim() || null })),
  };

  const open = useMutation({
    mutationFn: () => api.post<{ code: string; taskCode: string }>('/tickets', body),
    onSuccess: (r) => {
      toast(`Chamado ${r.code} aberto.`);
      void queryClient.invalidateQueries({ queryKey: keys.ticketsAny });
      void navigate(`/tarefas/${r.taskCode}`);
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });

  const submit = () => {
    const parsed = openTicketSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os campos.');
      return;
    }
    if (body.attachments.some((a) => !parseDriveLink(a.url))) {
      setError('Os anexos precisam ser links do Google Drive ou Google Docs.');
      return;
    }
    setError(null);
    open.mutate();
  };

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="Abrir chamado" subtitle="Peça algo a outro departamento. Você acompanha tudo em Meus chamados." />
      <Card>
        <form
          className="flex flex-col gap-[15px]"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid grid-cols-1 gap-[15px] sm:grid-cols-2">
            <Field label="Departamento de destino" required>
              <Select
                placeholder="Escolha"
                value={target}
                options={targets.map((d) => ({ value: d.id, label: `${d.name} (${d.acronym})` }))}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setTypeId('');
                }}
              />
            </Field>
            <Field label="Tipo de chamado" required>
              <Select
                disabled={!target}
                placeholder={target ? 'Escolha' : 'Escolha o departamento primeiro'}
                value={effectiveType}
                options={typeOptions.map((t) => ({ value: t.id, label: t.name }))}
                onChange={(e) => {
                  setTypeId(e.target.value);
                }}
              />
            </Field>
          </div>
          <Field label="Título" required>
            <Input value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); }} />
          </Field>
          <Field label="Descrição">
            <RichTextEditor label="Descrição" value={null} onChange={setDescription} placeholder="O que você precisa, para quando e por quê" minHeight={140} />
          </Field>
          <div className="grid grid-cols-1 gap-[15px] sm:grid-cols-2">
            <Field label="Prioridade">
              <Select value={priority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} onChange={(e) => { setPriority(e.target.value as Priority); }} />
            </Field>
            <Field label="Prazo desejado">
              <Input type="date" value={desired} onChange={(e) => { setDesired(e.target.value); }} />
              <DueDateWarning date={desired} />
            </Field>
            <Field label="Aprovador" hint="Opcional: além de você e do seu gestor, quem pode aprovar a entrega.">
              <PeoplePicker label="Aprovador" value={approver} onChange={setApprover} departmentIds={viewer.departmentIds} />
            </Field>
          </div>

          <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
            <legend className="mb-1.5 text-sm font-medium text-strong">Anexos (links do Google Drive)</legend>
            {links.map((l, i) => (
              <div key={i} className="flex flex-wrap gap-2.5">
                <div className="min-w-60 flex-[2]">
                  <Input
                    aria-label={`Link ${String(i + 1)}`}
                    type="url"
                    placeholder="https://drive.google.com/..."
                    invalid={Boolean(l.url.trim()) && !parseDriveLink(l.url)}
                    value={l.url}
                    onChange={(e) => {
                      setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)));
                    }}
                  />
                </div>
                <div className="min-w-40 flex-1">
                  <Input
                    aria-label={`Nome do link ${String(i + 1)}`}
                    placeholder="Nome de exibição"
                    value={l.name}
                    onChange={(e) => {
                      setLinks(links.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)));
                    }}
                  />
                </div>
                <IconButton label={`Remover link ${String(i + 1)}`} onClick={() => { setLinks(links.filter((_, j) => j !== i)); }}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            ))}
            <div>
              <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => { setLinks([...links, { url: '', name: '' }]); }}>
                Adicionar link
              </Button>
            </div>
            {links.length > 0 && <AlertBanner tone="info">Confira se o arquivo está compartilhado com o departamento.</AlertBanner>}
          </fieldset>

          {error && <AlertBanner tone="danger" title="Não foi possível abrir">{error}</AlertBanner>}
          <div className="flex justify-end gap-2.5">
            <Button variant="ghost" onClick={() => void navigate(-1)}>
              Cancelar
            </Button>
            <Button type="submit" variant="accent" disabled={open.isPending}>
              Abrir chamado
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
