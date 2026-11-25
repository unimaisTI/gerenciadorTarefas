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
    /** Em nome de quem a requisição roda (permissões e RLS). */
    viewer: RequestViewer | null;
    /** "Visualizar acesso": o admin dono da sessão, quando ele está vendo como outro usuário. */
    impersonator: RequestViewer | null;
    sessionTokenHash: string | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** O que ainda pode ser feito durante a simulação: sair dela, trocar de usuário ou sair do sistema. */
const ALLOWED_DURING_PREVIEW = new Set([
  'POST /api/auth/logout',
  'POST /api/auth/access-preview',
  'DELETE /api/auth/access-preview',
]);

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
/** <ip-da-rede-com-traços>.nip.io / .sslip.io: domínio que aponta para o IP (login do Google pela rede). */
const PRIVATE_IP_DOMAIN = /^(10|192-168|172-(1[6-9]|2\d|3[01]))(-\d+){2,3}\.(nip|sslip)\.io$/;

/**
 * Origens aceitas nas requisições que alteram dados. Em produção, só a do APP_URL. Fora dela,
 * também localhost, IPs da rede local e <ip>.nip.io, para o IP da máquina poder mudar sem
 * travar o login.
 */
export function originChecker(appUrl: string, nodeEnv: string): (origin: string) => boolean {
  const appOrigin = new URL(appUrl).origin;
  return (origin) => {
    if (origin === appOrigin) return true;
    if (nodeEnv === 'production') return false;
    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return PRIVATE_HOST.test(url.hostname) || PRIVATE_IP_DOMAIN.test(url.hostname);
    } catch {
      return false;
    }
  };
}

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
export function registerAuth(app: FastifyInstance, isAllowedOrigin: (origin: string) => boolean) {
  app.decorateRequest('viewer', null);
  app.decorateRequest('impersonator', null);
  app.decorateRequest('sessionTokenHash', null);

  app.addHook('onRequest', async (request) => {
    const safe = SAFE_METHODS.has(request.method);
    if (!safe) {
      const origin = request.headers.origin;
      if (request.headers['x-requested-with'] !== 'hub' || (origin && !isAllowedOrigin(origin))) {
        throw new HttpError(403, 'csrf', 'Requisição bloqueada por segurança. Recarregue a página.');
      }
    }

    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const tokenHash = hashToken(token);
    const resolved = await one<{ userId: string; actingUserId: string }>(
      app.db,
      sql`select user_id as "userId", acting_user_id as "actingUserId" from app.session_lookup(${tokenHash})`,
    );
    if (!resolved) return;
    request.sessionTokenHash = tokenHash;

    if (resolved.actingUserId === resolved.userId) {
      request.viewer = await loadViewer(app.db, resolved.userId);
      return;
    }
    // Visualizar acesso: tudo roda como o usuário simulado (rota e RLS), e nada pode ser alterado.
    request.impersonator = await loadViewer(app.db, resolved.userId);
    request.viewer = await loadViewer(app.db, resolved.actingUserId);
    if (!safe && !ALLOWED_DURING_PREVIEW.has(`${request.method} ${request.routeOptions.url ?? ''}`)) {
      throw new HttpError(
        403,
        'access_preview',
        'Você está só visualizando o acesso de outro usuário. Saia da simulação para fazer alterações.',
      );
    }
  });
}

/** O admin real da sessão (mesmo durante a simulação). Erra se ele não for admin. */
export function requireRealAdmin(request: FastifyRequest): RequestViewer {
  const real = request.impersonator ?? requireViewer(request);
  if (real.role !== 'admin') {
    throw new HttpError(403, 'forbidden', 'Só administradores podem visualizar o acesso de outro usuário.');
  }
  return real;
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
