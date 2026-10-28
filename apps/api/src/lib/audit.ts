import { sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Transaction } from '@hub/db';

/** RF-11.2: log de auditoria (criação/edição/desativação de usuários, perfis, exclusões...). */
export async function audit(
  tx: Transaction,
  request: FastifyRequest,
  action: string,
  target: string | null,
  details: Record<string, unknown> | null = null,
) {
  await tx.execute(sql`
    insert into audit_log (actor_id, action, target, ip, user_agent, details)
    values (app.current_user_id(), ${action}, ${target}, ${request.ip}::inet,
            ${request.headers['user-agent'] ?? null}, ${details ? JSON.stringify(details) : null}::jsonb)`);
}
