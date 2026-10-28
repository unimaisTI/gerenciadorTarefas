import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuid } from '@hub/shared';
import { one } from '../../lib/sql';
import { asViewer, requireViewer } from '../../plugins/auth';
import { listNotifications } from './queries';

export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  // RF-8.5: sino com contador de não lidas e a lista.
  app.get(
    '/notifications',
    { schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }) } },
    (request) =>
      asViewer(request, async (tx, viewer) => {
        const [items, unread] = await Promise.all([
          listNotifications(tx, viewer.id, request.query.limit),
          one<{ n: number }>(tx, sql`select count(*)::int as n from notifications where user_id = ${viewer.id} and read_at is null`),
        ]);
        return { items, unread: unread?.n ?? 0 };
      }),
  );

  app.post('/notifications/read-all', (request) =>
    asViewer(request, async (tx, viewer) => {
      await tx.execute(sql`update notifications set read_at = now() where user_id = ${viewer.id} and read_at is null`);
      return { ok: true };
    }),
  );

  app.post('/notifications/:id/read', { schema: { params: z.object({ id: uuid }) } }, (request) =>
    asViewer(request, async (tx) => {
      await tx.execute(sql`update notifications set read_at = now() where id = ${request.params.id} and read_at is null`);
      return { ok: true };
    }),
  );

  // RF-5.10 e RF-8.7: eventos em tempo real (Server-Sent Events).
  app.get('/events', (request, reply) => {
    const viewer = requireViewer(request);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const unsubscribe = app.realtime.subscribe(viewer.id, (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
};
