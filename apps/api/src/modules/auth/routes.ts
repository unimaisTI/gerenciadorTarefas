import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { dummyPasswordHash, hashPassword, verifyPassword, withUser } from '@hub/db';
import {
  forgotPasswordSchema,
  formatDateTime,
  loginSchema,
  resetPasswordSchema,
} from '@hub/shared';
import { resetEmail } from '../../lib/emails';
import { one } from '../../lib/sql';
import { hashToken, newToken } from '../../lib/tokens';
import { HttpError } from '../../plugins/errors';
import {
  clearSessionCookie,
  requireViewer,
  setSessionCookie,
} from '../../plugins/auth';
import { getUser } from '../users/queries';

const INVALID_LOGIN = 'E-mail ou senha incorretos.';

function lockedMessage(until: string) {
  return `Muitas tentativas erradas. Tente de novo após ${formatDateTime(until).slice(11)}.`;
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { env } = app;

  app.post('/auth/login', { schema: { body: loginSchema } }, async (request, reply) => {
    const { email, password, remember } = request.body;
    const ip = request.ip;
    const ua = request.headers['user-agent'] ?? null;

    const locked = await one<{ until: string | null }>(
      app.db,
      sql`select app.iso(app.auth_lockout_until(${email})) as until`,
    );
    if (locked?.until) throw new HttpError(423, 'locked', lockedMessage(locked.until));

    const login = await one<{ userId: string; passwordHash: string | null; isActive: boolean }>(
      app.db,
      sql`select user_id as "userId", password_hash as "passwordHash", is_active as "isActive"
          from app.auth_get_login(${email})`,
    );
    // Sempre verifica um hash, mesmo sem usuário, para não revelar quais e-mails existem.
    const ok = await verifyPassword(login?.passwordHash ?? (await dummyPasswordHash()), password);

    if (!login || !login.passwordHash || !login.isActive || !ok) {
      const failed = await one<{ until: string | null }>(
        app.db,
        sql`select app.iso(app.auth_login_failed(${email}, ${ip}::inet, ${ua})) as until`,
      );
      if (failed?.until) throw new HttpError(423, 'locked', lockedMessage(failed.until));
      throw new HttpError(401, 'invalid_credentials', INVALID_LOGIN);
    }

    const token = newToken();
    await app.db.execute(
      sql`select app.auth_login_succeeded(${login.userId}, ${hashToken(token)}, ${remember}, ${ip}::inet, ${ua})`,
    );
    setSessionCookie(reply, token, remember, env.COOKIE_SECURE);
    const me = await withUser(app.db, login.userId, (tx) => getUser(tx, login.userId));
    return me;
  });

  app.post('/auth/logout', async (request, reply) => {
    if (request.sessionTokenHash) {
      await app.db.execute(sql`select app.session_delete(${request.sessionTokenHash})`);
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/auth/me', async (request) => {
    const viewer = requireViewer(request);
    const me = await withUser(app.db, viewer.id, (tx) => getUser(tx, viewer.id));
    if (!me) throw new HttpError(401, 'unauthenticated', 'Sua sessão expirou. Entre novamente.');
    return me;
  });

  // RF-3.4: resposta igual exista ou não o e-mail.
  app.post('/auth/password/forgot', { schema: { body: forgotPasswordSchema } }, async (request) => {
    const token = newToken();
    const result = await one<{ name: string | null }>(
      app.db,
      sql`select app.auth_request_reset(${request.body.email}, ${hashToken(token)}) as name`,
    );
    if (result?.name) {
      const url = `${env.APP_URL}/definir-senha?token=${token}`;
      await app.mailer.send(resetEmail(request.body.email, result.name, url));
    }
    return { ok: true };
  });

  app.get(
    '/auth/password/token',
    { schema: { querystring: z.object({ token: z.string().min(20).max(200) }) } },
    async (request) => {
      const info = await one<{ kind: 'invite' | 'reset'; name: string; email: string }>(
        app.db,
        sql`select kind, name, email from app.auth_peek_token(${hashToken(request.query.token)})`,
      );
      if (!info) throw new HttpError(400, 'invalid_token', 'Link inválido ou expirado. Peça um novo.');
      return info;
    },
  );

  app.post('/auth/password/reset', { schema: { body: resetPasswordSchema } }, async (request) => {
    const passwordHash = await hashPassword(request.body.password);
    const result = await one<{ userId: string | null }>(
      app.db,
      sql`select app.auth_consume_token(${hashToken(request.body.token)}, ${passwordHash}) as "userId"`,
    );
    if (!result?.userId) throw new HttpError(400, 'invalid_token', 'Link inválido ou expirado. Peça um novo.');
    return { ok: true };
  });
};
