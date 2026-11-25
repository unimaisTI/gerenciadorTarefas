import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthProvidersDto } from '@hub/shared';
import type { Env } from '../../env';
import { one } from '../../lib/sql';
import { hashToken, newToken } from '../../lib/tokens';
import { notFound } from '../../plugins/errors';
import { setSessionCookie } from '../../plugins/auth';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
/** Guarda state, verificador PKCE e nonce entre a ida ao Google e a volta (10 minutos). */
const OAUTH_COOKIE = 'hub_oauth';
const OAUTH_COOKIE_PATH = '/api/auth/google';

/** Códigos que a tela de login traduz em mensagem (?erro=...). */
export type GoogleLoginError = 'google' | 'google_dominio' | 'google_nao_cadastrado';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Origem da interface que recebe a volta do Google (onde o cookie de sessão é gravado). */
  origin: string;
  allowedDomains: string[];
}

export function googleConfig(env: Env): GoogleConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const redirectUri = env.GOOGLE_REDIRECT_URI ?? `${env.APP_URL}/api/auth/google/callback`;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri,
    origin: new URL(redirectUri).origin,
    allowedDomains: (env.GOOGLE_ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  };
}

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

const idTokenClaimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
  email: z.string(),
  email_verified: z.boolean().optional(),
  nonce: z.string().optional(),
  hd: z.string().optional(),
});

/**
 * Confere o id_token do Google. A assinatura não é verificada porque o token chega direto do
 * endpoint de token do Google, por HTTPS, em troca do código (OpenID Connect Core, 3.1.3.7);
 * as declarações são todas conferidas aqui. Devolve o e-mail ou o código de erro.
 */
export function readGoogleIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string; allowedDomains: string[]; now?: number },
): { email: string } | { error: GoogleLoginError } {
  const payload = idToken.split('.')[1];
  if (!payload) return { error: 'google' };
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { error: 'google' };
  }
  const parsed = idTokenClaimsSchema.safeParse(json);
  if (!parsed.success) return { error: 'google' };
  const claims = parsed.data;
  const now = expected.now ?? Date.now();
  if (
    !GOOGLE_ISSUERS.has(claims.iss) ||
    claims.aud !== expected.clientId ||
    claims.exp * 1000 <= now ||
    claims.nonce !== expected.nonce ||
    claims.email_verified !== true
  ) {
    return { error: 'google' };
  }
  const email = claims.email.toLowerCase();
  if (expected.allowedDomains.length > 0) {
    const domain = email.split('@')[1] ?? '';
    if (!expected.allowedDomains.includes(domain)) return { error: 'google_dominio' };
  }
  return { email };
}

function pkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export const googleRoutes: FastifyPluginAsyncZod = async (app) => {
  const config = googleConfig(app.env);

  /** Troca o código da volta do Google pelo id_token. Null se o Google recusar ou não responder. */
  async function exchangeCode(
    cfg: GoogleConfig,
    code: string,
    verifier: string,
    log: FastifyBaseLogger,
  ): Promise<string | null> {
    try {
      const res = await app.httpFetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }).toString(),
      });
      const body = tokenResponseSchema.safeParse(await res.json());
      if (res.ok && body.success) return body.data.id_token;
      log.warn({ status: res.status }, 'Google recusou a troca do código');
    } catch (error) {
      log.warn({ err: error }, 'Falha ao falar com o Google');
    }
    return null;
  }

  /** Formas de entrar que a tela de login deve mostrar. */
  app.get('/auth/providers', (): AuthProvidersDto => ({
    googleUrl: config ? `${config.origin}${OAUTH_COOKIE_PATH}` : null,
  }));

  /** Começa o login: grava o state no cookie e manda para a tela de contas do Google. */
  app.get('/auth/google', async (_request, reply) => {
    if (!config) throw notFound('O login com Google não está configurado.');
    const state = newToken();
    const verifier = newToken();
    const nonce = newToken();
    void reply.setCookie(OAUTH_COOKIE, `${state}.${verifier}.${nonce}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: app.env.COOKIE_SECURE,
      path: OAUTH_COOKIE_PATH,
      maxAge: 600,
    });
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    // Com um domínio só, o Google já mostra as contas dele.
    const [onlyDomain] = config.allowedDomains;
    if (config.allowedDomains.length === 1 && onlyDomain) params.set('hd', onlyDomain);
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  app.get(
    '/auth/google/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string().max(2000).optional(),
          state: z.string().max(200).optional(),
          error: z.string().max(200).optional(),
        }),
      },
    },
    async (request, reply) => {
      if (!config) throw notFound('O login com Google não está configurado.');
      const fail = (code: GoogleLoginError) => reply.redirect(`${config.origin}/entrar?erro=${code}`);

      const [state, verifier, nonce] = (request.cookies[OAUTH_COOKIE] ?? '').split('.');
      void reply.clearCookie(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH });
      const { code } = request.query;
      if (request.query.error || !code || !state || !verifier || !nonce || request.query.state !== state) {
        return fail('google');
      }

      const idToken = await exchangeCode(config, code, verifier, request.log);
      if (!idToken) return fail('google');

      const result = readGoogleIdToken(idToken, {
        clientId: config.clientId,
        nonce,
        allowedDomains: config.allowedDomains,
      });
      if ('error' in result) return fail(result.error);

      const token = newToken();
      const login = await one<{ userId: string | null }>(
        app.db,
        sql`select app.auth_login_google(${result.email}, ${hashToken(token)}, ${request.ip}::inet,
                                         ${request.headers['user-agent'] ?? null}) as "userId"`,
      );
      if (!login?.userId) return fail('google_nao_cadastrado');

      setSessionCookie(reply, token, false, app.env.COOKIE_SECURE);
      return reply.redirect(`${config.origin}/`);
    },
  );
};
