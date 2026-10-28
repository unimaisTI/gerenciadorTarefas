import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatDateTime, type CommentDto, type RichNode } from '@hub/shared';
import { Avatar, Badge, Button, IconButton, Spinner, Switch, useToast } from '@/design-system';
import { RichTextEditor } from '@/components/RichTextEditor';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys } from '@/lib/queries';
import { AddDriveLink, AttachmentList } from './Attachments';

function isEmpty(doc: RichNode | null) {
  if (!doc) return true;
  const json = JSON.stringify(doc);
  return !json.includes('"text"') && !json.includes('"mention"');
}

function CommentItem({ c, taskId, onChanged }: { c: CommentDto; taskId: string; onChanged: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState<RichNode | null>(c.body);
  const save = useMutation({
    mutationFn: () => api.patch(`/comments/${c.id}`, { body }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/comments/${c.id}`),
    onSuccess: onChanged,
  });
  return (
    <li className="flex gap-2.5">
      <Avatar name={c.author.name} src={c.author.avatarUrl} size={32} />
      <div className="min-w-0 flex-1 rounded-sm border border-subtle bg-white p-[15px]">
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
          <strong className="text-sm text-strong">{c.author.name}</strong>
          <span>{formatDateTime(c.createdAt)}</span>
          {c.editedAt && <span>(editado)</span>}
          {c.visibility === 'internal' && (
            <Badge tone="warning">
              <Lock size={10} aria-hidden="true" /> Interno
            </Badge>
          )}
          {c.canEdit && !editing && (
            <span className="ml-auto flex gap-1">
              <IconButton label="Editar comentário" onClick={() => { setEditing(true); }}>
                <Pencil size={14} />
              </IconButton>
              <IconButton
                label="Excluir comentário"
                onClick={() => {
                  if (window.confirm('Excluir este comentário?')) remove.mutate();
                }}
              >
                <Trash2 size={14} />
              </IconButton>
            </span>
          )}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2.5">
            <RichTextEditor label="Editar comentário" value={body} onChange={setBody} mentions uploadTaskId={taskId} />
            <div className="flex justify-end gap-2.5">
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setBody(c.body); }}>
                Cancelar
              </Button>
              <Button size="sm" disabled={isEmpty(body) || save.isPending} onClick={() => { save.mutate(); }}>
                Salvar
              </Button>
            </div>
          </div>
        ) : (
          <RichTextEditor label="Comentário" value={c.body} editable={false} />
        )}
        <div className="mt-2">
          <AttachmentList items={c.attachments} canRemove={(a) => a.addedBy.id === me.id} onChanged={onChanged} />
          {c.canEdit && <AddDriveLink commentId={c.id} onAdded={onChanged} />}
        </div>
      </div>
    </li>
  );
}

/** RF-8.1 a RF-8.3: comentários com menções; em chamados, públicos ou internos. */
export function Comments({ taskId, canComment, allowInternal }: { taskId: string; canComment: boolean; allowInternal: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState<RichNode | null>(null);
  const [internal, setInternal] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const list = useQuery({
    queryKey: keys.comments(taskId),
    queryFn: () => api.get<CommentDto[]>(`/tasks/${taskId}/comments`),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.comments(taskId) });
  };
  const send = useMutation({
    mutationFn: () => api.post(`/tasks/${taskId}/comments`, { body, visibility: internal ? 'internal' : 'public' }),
    onSuccess: () => {
      setBody(null);
      setEditorKey((k) => k + 1);
      refresh();
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
    },
  });

  return (
    <div className="flex flex-col gap-[15px]">
      {list.isPending ? (
        <Spinner />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[15px] p-0">
          {(list.data ?? []).map((c) => (
            <CommentItem key={c.id} c={c} taskId={taskId} onChanged={refresh} />
          ))}
          {!list.data?.length && <li className="text-sm text-muted">Nenhum comentário ainda.</li>}
        </ul>
      )}
      {canComment && (
        <div className="flex flex-col gap-2.5">
          <RichTextEditor
            key={editorKey}
            label="Novo comentário"
            uploadTaskId={taskId}
            placeholder="Escreva um comentário. Digite @ para mencionar alguém; cole prints direto aqui."
            value={null}
            onChange={setBody}
            mentions
            minHeight={72}
          />
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {allowInternal ? (
              <Switch checked={internal} onChange={setInternal} label="Comentário interno (só o departamento executor vê)" />
            ) : (
              <span />
            )}
            <Button disabled={isEmpty(body) || send.isPending} onClick={() => { send.mutate(); }}>
              Comentar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
