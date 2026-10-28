import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UPLOAD_MAX_BYTES, permissions, uuid, type UploadedFileDto } from '@hub/shared';
import { one } from '../../lib/sql';
import { asViewer } from '../../plugins/auth';
import { forbidden, notFound, unprocessable } from '../../plugins/errors';

/** Tipo real pelo conteúdo (assinatura do arquivo), nunca pelo cabeçalho enviado. */
export function detectImageType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/**
 * Imagens enviadas (prints colados em tarefas, chamados e comentários). Ficam no disco do
 * servidor (UPLOAD_DIR); a leitura passa pela API e segue a visibilidade da tarefa (RLS).
 */
export const fileRoutes: FastifyPluginAsyncZod = async (app) => {
  const root = resolve(app.env.UPLOAD_DIR);

  app.addContentTypeParser(/^image\//, { parseAs: 'buffer', bodyLimit: UPLOAD_MAX_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  app.post(
    '/files',
    {
      bodyLimit: UPLOAD_MAX_BYTES,
      schema: {
        querystring: z.object({
          taskId: uuid,
          name: z.string().trim().min(1).max(200).default('imagem'),
          /** true = também aparece em "Anexos" da tarefa. */
          attach: z.coerce.boolean().default(false),
        }),
      },
    },
    (request, reply) =>
      asViewer(request, async (tx, viewer) => {
        if (!permissions.comment(viewer)) throw forbidden();
        const body = request.body;
        if (!Buffer.isBuffer(body) || body.length === 0) throw unprocessable('Envie uma imagem.');
        const mime = detectImageType(body);
        if (!mime) throw unprocessable('Formato não aceito. Use PNG, JPG, GIF ou WEBP.');

        const id = randomUUID();
        const storageKey = `${new Date().toISOString().slice(0, 7)}/${id}.${EXT[mime] ?? 'bin'}`;
        const { taskId, name, attach } = request.query;
        // O insert passa pelo RLS: só envia quem pode ver a tarefa.
        await tx.execute(sql`
          insert into files (id, task_id, uploaded_by, name, mime_type, size_bytes, storage_key)
          values (${id}, ${taskId}, ${viewer.id}, ${name}, ${mime}, ${body.length}, ${storageKey})`);
        const url = `/api/files/${id}`;
        if (attach) {
          await tx.execute(sql`
            insert into attachments (task_id, url, provider, file_id, name, mime_type, added_by)
            values (${taskId}, ${url}, 'upload', ${id}, ${name}, 'image', ${viewer.id})`);
        }
        const path = join(root, storageKey);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, body);
        const result: UploadedFileDto = { id, url, name };
        return reply.status(201).send(result);
      }),
  );

  app.get('/files/:id', { schema: { params: z.object({ id: uuid }) } }, async (request, reply) => {
    const file = await asViewer(request, (tx) =>
      one<{ mimeType: string; storageKey: string; name: string }>(
        tx,
        sql`select mime_type as "mimeType", storage_key as "storageKey", name from files where id = ${request.params.id}`,
      ),
    );
    if (!file) throw notFound('Imagem não encontrada ou sem acesso.');
    const path = resolve(root, file.storageKey);
    if (!path.startsWith(root)) throw notFound();
    return reply
      .header('Content-Type', file.mimeType)
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=86400')
      .send(createReadStream(path));
  });
};
