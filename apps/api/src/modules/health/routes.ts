import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['ok', 'unavailable']),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    { schema: { response: { 200: healthResponse, 503: healthResponse } } },
    async (request, reply) => {
      try {
        await app.db.execute(sql`select 1`);
        return { status: 'ok' as const, database: 'ok' as const };
      } catch (error) {
        request.log.error(error, 'health: banco indisponível');
        return reply.status(503).send({ status: 'degraded', database: 'unavailable' });
      }
    },
  );
};
