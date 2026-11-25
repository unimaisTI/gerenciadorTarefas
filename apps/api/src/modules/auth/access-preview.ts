import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { withUser } from '@hub/db';
import { accessPreviewSchema, type UserDto } from '@hub/shared';
import { HttpError } from '../../plugins/errors';
import { requireRealAdmin } from '../../plugins/auth';
import { listUsers } from '../users/queries';

/**
 * "Visualizar acesso" (Administração): o admin escolhe um usuário e passa a ver o sistema como
 * ele. A troca fica na sessão; o plugin de autenticação roda tudo como o usuário escolhido e
 * bloqueia qualquer alteração. A API checa o admin aqui e a função SQL checa de novo.
 */
export const accessPreviewRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Quem pode ser simulado: usuários ativos que não são admin. */
  app.get('/auth/access-preview/users', async (request) => {
    const admin = requireRealAdmin(request);
    const users = await withUser(app.db, admin.id, (tx) =>
      listUsers(tx, sql`u.is_active and u.role <> 'admin'`, 500, 0),
    );
    return users.map(({ total: _total, ...user }): UserDto => user);
  });

  app.post('/auth/access-preview', { schema: { body: accessPreviewSchema } }, async (request) => {
    requireRealAdmin(request);
    await setPreview(request.sessionTokenHash, request.body.userId, request.ip, request.headers['user-agent']);
    return { ok: true as const };
  });

  app.delete('/auth/access-preview', async (request) => {
    requireRealAdmin(request);
    await setPreview(request.sessionTokenHash, null, request.ip, request.headers['user-agent']);
    return { ok: true as const };
  });

  async function setPreview(tokenHash: string | null, target: string | null, ip: string, ua: string | undefined) {
    if (!tokenHash) throw new HttpError(401, 'unauthenticated', 'Sua sessão expirou. Entre novamente.');
    await app.db.execute(
      sql`select app.session_impersonate(${tokenHash}, ${target}::uuid, ${ip}::inet, ${ua ?? null})`,
    );
  }
};
