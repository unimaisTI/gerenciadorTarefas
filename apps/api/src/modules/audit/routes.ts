import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { permissions, type AuditEntryDto, type Paginated } from '@hub/shared';
import { rows } from '../../lib/sql';
import { asViewer } from '../../plugins/auth';
import { forbidden } from '../../plugins/errors';
import { userRef } from '../tasks/queries';

// RF-11.2: log de auditoria, só para o admin (o RLS também restringe).
export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/audit',
    {
      schema: {
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          action: z.string().max(60).optional(),
        }),
      },
    },
    (request) =>
      asViewer(request, async (tx, viewer) => {
        if (!permissions.viewAuditLog(viewer)) throw forbidden();
        const pageSize = 50;
        const action = request.query.action ?? null;
        const items = await rows<AuditEntryDto & { total: number }>(
          tx,
          sql`select l.id::text, ${userRef('u')} as actor, l.action, l.target, host(l.ip) as ip,
                l.user_agent as "userAgent", l.details, app.iso(l.created_at) as "createdAt",
                count(*) over ()::int as total
              from audit_log l left join users u on u.id = l.actor_id
              where ${action}::text is null or l.action = ${action}
              order by l.created_at desc
              limit ${pageSize} offset ${(request.query.page - 1) * pageSize}`,
        );
        const result: Paginated<AuditEntryDto> = {
          items: items.map(({ total: _t, ...e }) => e),
          total: items[0]?.total ?? 0,
          page: request.query.page,
          pageSize,
        };
        return result;
      }),
  );
};
