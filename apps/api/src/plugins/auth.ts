import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { withUser, type Database, type Transaction } from '@hub/db';
import type { Role, Viewer } from '@hub/shared';
import { one, rows } from '../lib/sql';
import { hashToken } from '../lib/tokens';
import { HttpError } from './errors';

export const SESSION_COOKIE = 'hub_session';

export interface RequestViewer extends Viewer {
  name: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    viewer: RequestViewer | null;
    sessionTokenHash: string | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function loadViewer(db: Database, userId: string): Promise<RequestViewer | null> {
  return withUser(db, userId, async (tx) => {
    const user = await one<{ id: string; name: string; email: string; role: Role; seesAll: boolean }>(
      tx,
      sql`select id, name, email, role, sees_all_departments as "seesAll"
          from users where id = ${userId} and is_active`,
    );
    if (!user) return null;
    const members = await rows<{ departmentId: string; isManager: boolean }>(
      tx,
      sql`select department_id as "departmentId", is_manager as "isManager"
          from department_members where user_id = ${userId}`,
    );
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      seesAllDepartments: user.seesAll || user.role === 'admin',
      departmentIds: members.map((m) => m.departmentId),
      managedDepartmentIds: members.filter((m) => m.isManager).map((m) => m.departmentId),
    };
  });
}

/**
 * Sessão por cookie httpOnly (SameSite=Lax). Contra CSRF (RNF-03), toda requisição que altera
 * dados precisa do cabeçalho X-Requested-With, que um site de terceiros não consegue enviar
 * sem preflight CORS (e a API não libera CORS), e o Origin, quando vier, tem de ser o da interface.
 */
export function registerAuth(app: FastifyInstance, appOrigin: string) {
  app.decorateRequest('viewer', null);
  app.decorateRequest('sessionTokenHash', null);

  app.addHook('onRequest', async (request) => {
    if (!SAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin;
      if (request.headers['x-requested-with'] !== 'hub' || (origin && origin !== appOrigin)) {
        throw new HttpError(403, 'csrf', 'Requisição bloqueada por segurança. Recarregue a página.');
      }
    }

    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const tokenHash = hashToken(token);
    const resolved = await one<{ userId: string | null }>(
      app.db,
      sql`select app.session_resolve(${tokenHash}) as "userId"`,
    );
    if (!resolved?.userId) return;
    request.sessionTokenHash = tokenHash;
    request.viewer = await loadViewer(app.db, resolved.userId);
  });
}

export function requireViewer(request: FastifyRequest): RequestViewer {
  if (!request.viewer) {
    throw new HttpError(401, 'unauthenticated', 'Sua sessão expirou. Entre novamente.');
  }
  return request.viewer;
}

/** Executa a consulta em nome do usuário logado, sob RLS. */
export function asViewer<T>(
  request: FastifyRequest,
  fn: (tx: Transaction, viewer: RequestViewer) => Promise<T>,
): Promise<T> {
  const viewer = requireViewer(request);
  return withUser(request.server.db, viewer.id, (tx) => fn(tx, viewer));
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  remember: boolean,
  secure: boolean,
) {
  void reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    ...(remember && { maxAge: 60 * 60 * 24 * 30 }),
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  void reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
