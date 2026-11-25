import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_PASSWORD, SEED_USERS } from '@hub/db/seed';
import { buildApp, type App } from '../src/app';
import { readGoogleIdToken } from '../src/modules/auth/google';
import { originChecker } from '../src/plugins/auth';
import { dbAvailable, testDb, testEnv } from './helpers';

const headers = { 'x-requested-with': 'hub' };
const CLIENT_ID = 'cliente-teste.apps.googleusercontent.com';

function fakeIdToken(claims: Record<string, unknown>) {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.assinatura`;
}

const validClaims = (nonce: string, email: string) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 300,
  email,
  email_verified: true,
  nonce,
});

describe('origens aceitas contra CSRF', () => {
  it('em desenvolvimento aceita localhost e IP da rede local; em produção só o APP_URL', () => {
    const dev = originChecker('http://localhost:5173', 'development');
    expect(dev('http://localhost:5173')).toBe(true);
    expect(dev('http://192.168.102.234:5173')).toBe(true);
    expect(dev('http://127.0.0.1:5173')).toBe(true);
    expect(dev('https://192-168-102-234.nip.io:5173')).toBe(true);
    expect(dev('https://8-8-8-8.nip.io')).toBe(false);
    expect(dev('https://site-de-fora.com')).toBe(false);
    const prod = originChecker('https://hub.unimais.edu.br', 'production');
    expect(prod('https://hub.unimais.edu.br')).toBe(true);
    expect(prod('http://192.168.0.10:5173')).toBe(false);
  });
});

describe('token do Google', () => {
  const expected = { clientId: CLIENT_ID, nonce: 'n1', allowedDomains: ['unimais.edu.br'] };

  it('aceita token válido e devolve o e-mail em minúsculas', () => {
    expect(readGoogleIdToken(fakeIdToken(validClaims('n1', 'Admin@Unimais.edu.br')), expected)).toEqual({
      email: 'admin@unimais.edu.br',
    });
  });

  it('recusa nonce, público, emissor, validade e e-mail não verificado', () => {
    const base = validClaims('n1', 'admin@unimais.edu.br');
    for (const claims of [
      { ...base, nonce: 'outro' },
      { ...base, aud: 'outro-cliente' },
      { ...base, iss: 'https://falso.example.com' },
      { ...base, exp: Math.floor(Date.now() / 1000) - 10 },
      { ...base, email_verified: false },
    ]) {
      expect(readGoogleIdToken(fakeIdToken(claims), expected)).toEqual({ error: 'google' });
    }
    expect(readGoogleIdToken('lixo', expected)).toEqual({ error: 'google' });
  });

  it('recusa domínio fora da lista', () => {
    expect(readGoogleIdToken(fakeIdToken(validClaims('n1', 'alguem@gmail.com')), expected)).toEqual({
      error: 'google_dominio',
    });
  });
});

describe.skipIf(!dbAvailable)('Visualizar acesso e login com Google', () => {
  const { db, close } = testDb();
  let app: App;
  /** Resposta que o Google falso dá à troca do código. */
  let nextIdToken = '';

  beforeAll(async () => {
    app = await buildApp({
      db,
      env: {
        ...testEnv,
        GOOGLE_CLIENT_ID: CLIENT_ID,
        GOOGLE_CLIENT_SECRET: 'segredo',
        GOOGLE_REDIRECT_URI: 'http://localhost:5173/api/auth/google/callback',
        GOOGLE_ALLOWED_DOMAINS: 'unimais.edu.br',
      },
      mailer: { send: () => Promise.resolve() },
      realtime: { subscribe: () => () => undefined },
      fetch: () => Promise.resolve(Response.json({ id_token: nextIdToken })),
    });
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  const loginCookie = async (email: string) => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login', headers, payload: { email, password: SEED_PASSWORD },
    });
    const c = res.cookies.find((x) => x.name === 'hub_session');
    return `hub_session=${c?.value ?? ''}`;
  };
  const me = async (cookie: string) =>
    (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json<{
      email: string; role: string; impersonator: { name: string } | null;
    }>();

  it('admin vê como colaborador: mesmas permissões, só leitura, e volta ao sair', async () => {
    const cookie = await loginCookie(SEED_USERS.admin.email);
    const list = await app.inject({ method: 'GET', url: '/api/auth/access-preview/users', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const people = list.json<{ id: string; email: string; role: string }[]>();
    expect(people.every((p) => p.role !== 'admin')).toBe(true);
    const target = people.find((p) => p.email === SEED_USERS.colabTi.email);

    const start = await app.inject({
      method: 'POST', url: '/api/auth/access-preview', headers: { ...headers, cookie }, payload: { userId: target?.id },
    });
    expect(start.statusCode, start.body).toBe(200);
    expect(await me(cookie)).toMatchObject({ email: SEED_USERS.colabTi.email, role: 'colaborador', impersonator: { name: SEED_USERS.admin.name } });

    // Permissão da rota segue o usuário simulado...
    expect((await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } })).statusCode).toBe(403);
    // ...e nada pode ser alterado.
    const write = await app.inject({
      method: 'PATCH', url: '/api/me', headers: { ...headers, cookie }, payload: { phone: '62999990000' },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json<{ error: { code: string } }>().error.code).toBe('access_preview');

    const stop = await app.inject({ method: 'DELETE', url: '/api/auth/access-preview', headers: { ...headers, cookie } });
    expect(stop.statusCode).toBe(200);
    expect(await me(cookie)).toMatchObject({ email: SEED_USERS.admin.email, impersonator: null });

    const audit = await app.inject({ method: 'GET', url: '/api/audit?action=access_preview_started', headers: { cookie } });
    expect(audit.json<{ items: { target: string }[] }>().items[0]?.target).toBe(SEED_USERS.colabTi.email);
  });

  it('quem não é admin não simula, e ninguém simula um admin', async () => {
    const admin = await loginCookie(SEED_USERS.admin.email);
    const people = (await app.inject({ method: 'GET', url: '/api/auth/access-preview/users', headers: { cookie: admin } }))
      .json<{ id: string; email: string }[]>();
    const gestor = people.find((p) => p.email === SEED_USERS.gestorTi.email);

    const colab = await loginCookie(SEED_USERS.colabTi.email);
    const denied = await app.inject({
      method: 'POST', url: '/api/auth/access-preview', headers: { ...headers, cookie: colab }, payload: { userId: gestor?.id },
    });
    expect(denied.statusCode).toBe(403);

    const adminId = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin } })).json<{ id: string }>().id;
    const self = await app.inject({
      method: 'POST', url: '/api/auth/access-preview', headers: { ...headers, cookie: admin }, payload: { userId: adminId },
    });
    expect(self.statusCode).toBe(422);
  });

  it('login com Google: cadastrado entra; não cadastrado volta para o login com aviso', async () => {
    const providers = await app.inject({ method: 'GET', url: '/api/auth/providers' });
    expect(providers.json()).toEqual({ googleUrl: 'http://localhost:5173/api/auth/google' });

    const startLogin = async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/google' });
      expect(res.statusCode).toBe(302);
      const location = new URL(res.headers.location as string);
      expect(location.host).toBe('accounts.google.com');
      const oauth = res.cookies.find((c) => c.name === 'hub_oauth');
      const [, , nonce] = (oauth?.value ?? '').split('.');
      return { state: location.searchParams.get('state'), nonce: nonce ?? '', cookie: `hub_oauth=${oauth?.value ?? ''}` };
    };

    const ok = await startLogin();
    nextIdToken = fakeIdToken(validClaims(ok.nonce, SEED_USERS.gestorTi.email));
    const back = await app.inject({
      method: 'GET', url: `/api/auth/google/callback?code=abc&state=${ok.state ?? ''}`, headers: { cookie: ok.cookie },
    });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe('http://localhost:5173/');
    const session = back.cookies.find((c) => c.name === 'hub_session');
    expect(await me(`hub_session=${session?.value ?? ''}`)).toMatchObject({ email: SEED_USERS.gestorTi.email });

    const unknown = await startLogin();
    nextIdToken = fakeIdToken(validClaims(unknown.nonce, 'nao.cadastrado@unimais.edu.br'));
    const refused = await app.inject({
      method: 'GET', url: `/api/auth/google/callback?code=abc&state=${unknown.state ?? ''}`, headers: { cookie: unknown.cookie },
    });
    expect(refused.headers.location).toBe('http://localhost:5173/entrar?erro=google_nao_cadastrado');

    const forged = await startLogin();
    const wrongState = await app.inject({
      method: 'GET', url: '/api/auth/google/callback?code=abc&state=forjado', headers: { cookie: forged.cookie },
    });
    expect(wrongState.headers.location).toBe('http://localhost:5173/entrar?erro=google');
  });
});
