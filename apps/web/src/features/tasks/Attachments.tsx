import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Folder, Image as ImageIcon, Link2, Presentation, Trash2, type LucideIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { DRIVE_KIND_LABELS, parseDriveLink, type AttachmentDto, type DriveFileKind } from '@hub/shared';
import { AlertBanner, Button, Field, IconButton, Input, useToast } from '@/design-system';
import { api, errorMessage } from '@/lib/api';
import { uploadImage } from '@/lib/uploads';

const KIND_ICON: Record<DriveFileKind, LucideIcon> = {
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  form: FileText,
  folder: Folder,
  file: Link2,
  image: ImageIcon,
};

export function AttachmentList({
  items,
  canRemove,
  onChanged,
}: {
  items: AttachmentDto[];
  canRemove: (a: AttachmentDto) => boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/attachments/${id}`),
    onSuccess: onChanged,
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  if (!items.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {items.map((a) => {
        const Icon = KIND_ICON[a.kind];
        return (
          <li key={a.id} className="flex items-center gap-2.5 rounded-sm border border-subtle bg-white px-2.5 py-1.5">
            <Icon size={16} aria-hidden="true" className="text-navy-700" />
            <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 truncate text-sm">
              {a.name ?? DRIVE_KIND_LABELS[a.kind]}
            </a>
            <span className="text-2xs text-muted">{DRIVE_KIND_LABELS[a.kind]}</span>
            {canRemove(a) && (
              <IconButton label={`Remover ${a.name ?? 'anexo'}`} onClick={() => { remove.mutate(a.id); }}>
                <Trash2 size={14} />
              </IconButton>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Envia um print/imagem como anexo da tarefa (até 5 MB). */
export function AddImageButton({ taskId, onAdded }: { taskId: string; onAdded: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" icon={<ImageIcon size={14} />} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Enviando...' : 'Enviar imagem'}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          uploadImage(taskId, file, true)
            .then(onAdded)
            .catch((err: unknown) => {
              toast(errorMessage(err), 'danger');
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      />
    </>
  );
}

/** RF-9.1 a RF-9.3: "Adicionar link" do Google Drive, com nome opcional e aviso de compartilhamento. */
export function AddDriveLink({ taskId, commentId, onAdded }: { taskId?: string; commentId?: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const toast = useToast();
  const valid = url.trim() === '' || parseDriveLink(url) !== null;
  const add = useMutation({
    mutationFn: () => api.post('/attachments', { taskId, commentId, url: url.trim(), name: name.trim() || null }),
    onSuccess: () => {
      setUrl('');
      setName('');
      setOpen(false);
      onAdded();
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  if (!open) {
    return (
      <Button variant="ghost" size="sm" icon={<Link2 size={14} />} onClick={() => { setOpen(true); }}>
        Adicionar link
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2.5 rounded-sm border border-subtle bg-white p-[15px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim() && valid) add.mutate();
      }}
    >
      <Field label="Link do Google Drive" error={valid ? undefined : 'Use um link de drive.google.com ou docs.google.com.'} required>
        <Input autoFocus type="url" invalid={!valid} placeholder="https://drive.google.com/..." value={url} onChange={(e) => { setUrl(e.target.value); }} />
      </Field>
      <Field label="Nome de exibição">
        <Input value={name} maxLength={200} onChange={(e) => { setName(e.target.value); }} />
      </Field>
      <AlertBanner tone="info">Confira se o arquivo está compartilhado com o departamento.</AlertBanner>
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={() => { setOpen(false); }}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!url.trim() || !valid || add.isPending}>
          Adicionar
        </Button>
      </div>
    </form>
  );
}
