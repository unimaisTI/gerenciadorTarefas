import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  attachmentSchema,
  commentSchema,
  parseDriveLink,
  permissions,
  richDocMentions,
  richDocToText,
  sanitizeRichDoc,
  updateCommentSchema,
  uuid,
  type AttachmentDto,
  type CommentDto,
} from '@hub/shared';
import { one, rows } from '../../lib/sql';
import { asViewer } from '../../plugins/auth';
import { badRequest, forbidden, notFound, unprocessable } from '../../plugins/errors';
import { ATTACHMENT_COLUMNS, userRef } from '../tasks/queries';
import { notifyTask } from '../tasks/routes';

const idParams = z.object({ id: uuid });

export const commentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/tasks/:id/comments', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const list = await rows<Omit<CommentDto, 'canEdit'> & { authorId: string }>(
        tx,
        sql`select cm.id, ${userRef('u')} as author, cm.author_id as "authorId", cm.body, cm.visibility,
              app.iso(cm.edited_at) as "editedAt", app.iso(cm.created_at) as "createdAt",
              coalesce((select json_agg(x order by x."createdAt") from (
                select ${ATTACHMENT_COLUMNS} from attachments at join users au on au.id = at.added_by
                where at.comment_id = cm.id) x), '[]') as attachments
            from comments cm join users u on u.id = cm.author_id
            where cm.task_id = ${request.params.id}
            order by cm.created_at`,
      );
      return list.map(({ authorId, ...c }) => ({ ...c, canEdit: authorId === viewer.id }));
    }),
  );

  // RF-8.1 a RF-8.3: texto rico, menções e visibilidade pública/interna.
  app.post('/tasks/:id/comments', { schema: { params: idParams, body: commentSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      if (!permissions.comment(viewer)) throw forbidden();
      const taskId = request.params.id;
      const body = sanitizeRichDoc(request.body.body);
      const text = richDocToText(body);
      if (!text) throw badRequest('Escreva o comentário.');
      const created = await one<{ id: string }>(
        tx,
        sql`insert into comments (task_id, author_id, body, body_text, visibility)
            values (${taskId}, ${viewer.id}, ${JSON.stringify(body)}::jsonb, ${text}, ${request.body.visibility})
            returning id`,
      );
      if (!created) throw new Error('Falha ao comentar');

      const internal = request.body.visibility === 'internal';
      const mentions = richDocMentions(body).filter((id) => id !== viewer.id);
      const watchers = await rows<{ userId: string }>(
        tx,
        sql`select user_id as "userId" from task_watchers where task_id = ${taskId}`,
      );
      const payload = { internal, excerpt: text.slice(0, 140) };
      await notifyTask(tx, taskId, 'mentioned', mentions, payload);
      await notifyTask(
        tx,
        taskId,
        'task_commented',
        watchers.map((w) => w.userId).filter((id) => id !== viewer.id && !mentions.includes(id)),
        payload,
      );
      await tx.execute(sql`insert into task_watchers (task_id, user_id) values (${taskId}, ${viewer.id}) on conflict do nothing`);
      return reply.status(201).send({ id: created.id });
    }),
  );

  app.patch('/comments/:id', { schema: { params: idParams, body: updateCommentSchema } }, (request) =>
    asViewer(request, async (tx) => {
      const body = sanitizeRichDoc(request.body.body);
      const updated = await rows<{ id: string }>(
        tx,
        sql`update comments set body = ${JSON.stringify(body)}::jsonb, body_text = ${richDocToText(body)}, edited_at = now()
            where id = ${request.params.id} and deleted_at is null returning id`,
      );
      if (!updated.length) throw forbidden('Só o autor edita o comentário.');
      return { ok: true };
    }),
  );

  app.delete('/comments/:id', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx) => {
      const deleted = await rows<{ id: string }>(
        tx,
        sql`update comments set deleted_at = now() where id = ${request.params.id} and deleted_at is null returning id`,
      );
      if (!deleted.length) throw forbidden('Só o autor exclui o comentário.');
      return { ok: true };
    }),
  );

  // RF-9.1 e RF-9.2: link do Google Drive/Docs com nome de exibição opcional.
  app.post('/attachments', { schema: { body: attachmentSchema } }, (request, reply) =>
    asViewer(request, async (tx, viewer) => {
      const parsed = parseDriveLink(request.body.url);
      if (!parsed) throw unprocessable('Use um link do Google Drive ou Google Docs (https://drive.google.com ou https://docs.google.com).');
      const created = await one<AttachmentDto>(
        tx,
        sql`with ins as (
              insert into attachments (task_id, comment_id, url, provider, drive_file_id, name, mime_type, added_by)
              values (${request.body.taskId ?? null}, ${request.body.commentId ?? null}, ${parsed.url}, 'gdrive',
                      ${parsed.driveFileId}, ${request.body.name ?? null}, ${parsed.kind}, ${viewer.id})
              returning *)
            select ${ATTACHMENT_COLUMNS} from ins at join users au on au.id = at.added_by`,
      );
      return reply.status(201).send(created);
    }),
  );

  app.delete('/attachments/:id', { schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx) => {
      const deleted = await rows<{ id: string }>(tx, sql`delete from attachments where id = ${request.params.id} returning id`);
      if (!deleted.length) throw notFound('Anexo não encontrado ou sem permissão.');
      return { ok: true };
    }),
  );
};
