import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_PASSWORD, SEED_USERS } from '@hub/db/seed';
import { buildApp, type App } from '../src/app';
import type { Mail } from '../src/lib/mailer';
import { dbAvailable, testDb, testEnv } from './helpers';

const headers = { 'x-requested-with': 'hub' };

describe.skipIf(!dbAvailable)('API', () => {
  const { db, close } = testDb();
  const sent: Mail[] = [];
  let app: App;

  beforeAll(async () => {
    app = await buildApp({
      db,
      env: testEnv,
      mailer: { send: (m) => { sent.push(m); return Promise.resolve(); } },
      realtime: { subscribe: () => () => undefined },
    });
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  const login = async (email: string, password = SEED_PASSWORD) =>
    app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { email, password } });

  const cookieOf = (res: Awaited<ReturnType<typeof login>>) => {
    const c = res.cookies.find((x) => x.name === 'hub_session');
    return c ? `hub_session=${c.value}` : '';
  };

  it('GET /api/health responde ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('rota inexistente devolve erro no formato padrão', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nao-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Rota não encontrada.' } });
  });

  it('bloqueia POST sem o cabeçalho anti-CSRF', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.c', password: 'x' } });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('csrf');
  });

  it('rotas protegidas exigem sessão', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/my-tasks' });
    expect(res.statusCode).toBe(401);
  });

  it('login correto cria sessão httpOnly e /auth/me devolve o perfil', async () => {
    const res = await login(SEED_USERS.colabTi.email);
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'hub_session');
    expect(cookie?.httpOnly).toBe(true);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieOf(res) } });
    expect(me.json()).toMatchObject({ email: SEED_USERS.colabTi.email, role: 'colaborador' });
  });

  it('bloqueia após 5 tentativas erradas (RF-3.7)', async () => {
    const email = SEED_USERS.colabCtrl.email;
    for (let i = 0; i < 4; i++) {
      expect((await login(email, 'errada123')).statusCode).toBe(401);
    }
    expect((await login(email, 'errada123')).statusCode).toBe(423);
    expect((await login(email)).statusCode).toBe(423);
  });

  it('colaborador não acessa a administração de usuários', async () => {
    const cookie = cookieOf(await login(SEED_USERS.colabTi.email));
    const res = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('admin cria usuário e o convite é enviado; o link define a senha (RF-3.3, RF-4.2)', async () => {
    const cookie = cookieOf(await login(SEED_USERS.admin.email));
    const depts = await app.inject({ method: 'GET', url: '/api/departments', headers: { cookie } });
    const ti = depts.json<{ id: string; acronym: string }[]>().find((d) => d.acronym === 'TI');
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { ...headers, cookie },
      payload: {
        name: 'Gabriela Nova',
        email: 'gabriela.nova@unimais.edu.br',
        role: 'colaborador',
        departments: [{ departmentId: ti?.id, isPrimary: true }],
      },
    });
    expect(res.statusCode).toBe(201);
    const mail = sent.at(-1);
    const token = /token=([\w-]+)/.exec(mail?.text ?? '')?.[1];
    expect(token).toBeTruthy();

    const weak = await app.inject({
      method: 'POST', url: '/api/auth/password/reset', headers, payload: { token, password: 'curta' },
    });
    expect(weak.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST', url: '/api/auth/password/reset', headers, payload: { token, password: 'NovaSenha123' },
    });
    expect(ok.statusCode).toBe(200);
    expect((await login('gabriela.nova@unimais.edu.br', 'NovaSenha123')).statusCode).toBe(200);
  });

  it('usuário desativado não entra e perde as sessões (RF-3.6)', async () => {
    const userCookie = cookieOf(await login(SEED_USERS.observador.email));
    const adminCookie = cookieOf(await login(SEED_USERS.admin.email));
    const list = await app.inject({ method: 'GET', url: '/api/users?q=observador', headers: { cookie: adminCookie } });
    const id = list.json<{ items: { id: string }[] }>().items[0]?.id;
    await app.inject({ method: 'POST', url: `/api/users/${id ?? ''}/deactivate`, headers: { ...headers, cookie: adminCookie } });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: userCookie } });
    expect(me.statusCode).toBe(401);
    expect((await login(SEED_USERS.observador.email)).statusCode).toBe(401);
    await app.inject({ method: 'POST', url: `/api/users/${id ?? ''}/activate`, headers: { ...headers, cookie: adminCookie } });
  });

  it('quadro, criação e movimentação de tarefa pela API', async () => {
    const cookie = cookieOf(await login(SEED_USERS.colabTi.email));
    const project = await app.inject({ method: 'GET', url: '/api/projects/by-key/TI', headers: { cookie } });
    const detail = project.json<{ id: string; columns: { id: string }[] }>();
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { ...headers, cookie },
      payload: { projectId: detail.id, title: 'Teste de integração' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const task = created.json<{ id: string; code: string }>();
    expect(task.code).toMatch(/^TI-\d+$/);
    const moved = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/move`,
      headers: { ...headers, cookie },
      payload: { columnId: detail.columns[1]?.id },
    });
    expect(moved.statusCode).toBe(200);
    const history = await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/history`, headers: { cookie } });
    expect(history.json<{ action: string }[]>().map((h) => h.action)).toContain('updated');
  });

  it('calendário geral e painel respondem', async () => {
    const cookie = cookieOf(await login(SEED_USERS.admin.email));
    const cal = await app.inject({ method: 'GET', url: '/api/calendar?from=2026-01-01&to=2028-12-31', headers: { cookie } });
    expect(cal.statusCode).toBe(200);
    expect(cal.json<{ kind: string }[]>().some((i) => i.kind === 'event')).toBe(true);
    const dash = await app.inject({ method: 'GET', url: '/api/dashboards?from=2026-01-01&to=2028-12-31', headers: { cookie } });
    expect(dash.statusCode).toBe(200);
  });
});
