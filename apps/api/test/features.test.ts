import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '@hub/db';
import { SEED_PASSWORD, SEED_USERS } from '@hub/db/seed';
import { todayIso } from '@hub/shared';
import { buildApp, type App } from '../src/app';
import { openTicketFromEmail, toInboundTicket } from '../src/lib/inbound-email';
import { as, dbAvailable, pgError, q, testDb, testEnv, userId } from './helpers';

const headers = { 'x-requested-with': 'hub' };
// PNG 1x1 válido.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('toInboundTicket (sem banco)', () => {
  it('extrai e-mail, limpa "Re:"/"Enc:" e corta o título', () => {
    expect(toInboundTicket('Elisa <Elisa@UniMais.edu.br>', 'Re: Enc: Impressora parada', 'Texto')).toEqual({
      fromEmail: 'elisa@unimais.edu.br',
      title: 'Impressora parada',
      body: 'Texto',
    });
    expect(toInboundTicket('sem email', 'x', 'y')).toBeNull();
    expect(toInboundTicket('a@b.co', '', '')?.title).toBe('Chamado recebido por e-mail');
  });
});

describe.skipIf(!dbAvailable)('recursos de gestão', () => {
  const { db, close } = testDb();
  let app: App;
  const project = async (key: string) => {
    const [row] = await as(db, 'admin', (tx) =>
      q<{ id: string; todo: string; done: string }>(
        tx,
        sql`select p.id,
              (select id from board_columns where project_id = p.id order by position limit 1) as todo,
              (select id from board_columns where project_id = p.id and status_category = 'done' limit 1) as done
            from projects p where p.key = ${key}`,
      ),
    );
    if (!row) throw new Error('projeto');
    return row;
  };
  const newTask = async (who: Parameters<typeof as>[1], key: string, title: string) => {
    const p = await project(key);
    const me = await userId(db, who);
    const [t] = await as(db, who, (tx) =>
      q<{ id: string }>(
        tx,
        sql`insert into tasks (project_id, column_id, title, reporter_id, position)
            values (${p.id}, ${p.todo}, ${title}, ${me}, app.position_after_last(${p.todo})) returning id`,
      ),
    );
    return t?.id ?? '';
  };
  const cookie = async (email: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { email, password: SEED_PASSWORD } });
    const c = res.cookies.find((x) => x.name === 'hub_session');
    return `hub_session=${c?.value ?? ''}`;
  };

  beforeAll(async () => {
    app = await buildApp({
      db,
      env: testEnv,
      mailer: { send: () => Promise.resolve() },
      realtime: { subscribe: () => () => undefined },
    });
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  it('automação: ao entrar em Concluído, avisa quem criou', async () => {
    const p = await project('TI');
    const gestor = await userId(db, 'gestorTi');
    await as(db, 'gestorTi', (tx) =>
      tx.execute(sql`insert into automation_rules (project_id, name, trigger, column_id, action, created_by)
                     values (${p.id}, 'Avisar ao concluir', 'task_moved', ${p.done}, 'notify_reporter', ${gestor})`),
    );
    const task = await newTask('colabTi', 'TI', 'Tarefa com automação');
    await as(db, 'gestorTi', (tx) => tx.execute(sql`update tasks set column_id = ${p.done} where id = ${task}`));
    const notes = await as(db, 'colabTi', (tx) =>
      q<{ n: number }>(tx, sql`select count(*)::int as n from notifications where task_id = ${task} and type = 'automation'`),
    );
    expect(notes[0]?.n).toBe(1);
  });

  it('automação: colaborador não configura', async () => {
    const p = await project('TI');
    const me = await userId(db, 'colabTi');
    const err = await pgError(
      as(db, 'colabTi', (tx) =>
        tx.execute(sql`insert into automation_rules (project_id, name, trigger, action, created_by)
                       values (${p.id}, 'x', 'task_created', 'notify_reporter', ${me})`),
      ),
    );
    expect(err).toMatch(/row-level security/i);
  });

  it('automação de atribuição não entra em laço e atribui', async () => {
    const p = await project('CTRL');
    const gestor = await userId(db, 'gestorCtrl');
    const colab = await userId(db, 'colabCtrl');
    await as(db, 'gestorCtrl', (tx) =>
      tx.execute(sql`insert into automation_rules (project_id, name, trigger, trigger_priority, action, action_user_id, created_by)
                     values (${p.id}, 'Urgente para Elisa', 'task_created', 'urgent', 'assign_user', ${colab}, ${gestor})`),
    );
    const [t] = await as(db, 'gestorCtrl', (tx) =>
      q<{ id: string }>(
        tx,
        sql`insert into tasks (project_id, column_id, title, reporter_id, position, priority)
            values (${p.id}, ${p.todo}, 'Urgente!', ${gestor}, app.position_after_last(${p.todo}), 'urgent') returning id`,
      ),
    );
    const [row] = await as(db, 'gestorCtrl', (tx) =>
      q<{ assignee: string | null }>(tx, sql`select assignee_id as assignee from tasks where id = ${t?.id ?? ''}`),
    );
    expect(row?.assignee).toBe(colab);
  });

  it('recorrência: próxima data e criação pelo job', async () => {
    const [d] = await as(db, 'admin', (tx) =>
      q<{ weekly: string; monthly: string; monthlyNext: string }>(
        tx,
        sql`select app.next_recurrence('weekly', 1, null, '2026-10-28')::text as weekly,
                   app.next_recurrence('monthly', null, 5, '2026-10-28')::text as monthly,
                   app.next_recurrence('monthly', null, 28, '2026-10-27')::text as "monthlyNext"`,
      ),
    );
    expect(d).toEqual({ weekly: '2026-11-02', monthly: '2026-11-05', monthlyNext: '2026-10-28' });

    const p = await project('TI');
    const me = await userId(db, 'gestorTi');
    await as(db, 'gestorTi', (tx) =>
      tx.execute(sql`insert into task_recurrences (project_id, title, frequency, next_run_on, created_by, due_offset_days)
                     values (${p.id}, 'Backup mensal', 'daily', ${todayIso()}, ${me}, 2)`),
    );
    const [n] = (await db.execute(sql`select app.job_recurrences() as n`)) as unknown as { n: number }[];
    expect(n?.n).toBeGreaterThanOrEqual(1);
    const created = await as(db, 'gestorTi', (tx) =>
      q<{ due: string }>(tx, sql`select due_date::text as due from tasks where title = 'Backup mensal'`),
    );
    expect(created).toHaveLength(1);
    const [again] = (await db.execute(sql`select app.job_recurrences() as n`)) as unknown as { n: number }[];
    expect(again?.n).toBe(0);
  });

  it('vínculo "bloqueia" marca o cartão como bloqueado e respeita visibilidade', async () => {
    const a = await newTask('colabTi', 'TI', 'Bloqueadora');
    const b = await newTask('colabTi', 'TI', 'Bloqueada');
    const me = await userId(db, 'colabTi');
    await as(db, 'colabTi', (tx) =>
      tx.execute(sql`insert into task_links (source_task_id, target_task_id, kind, created_by) values (${a}, ${b}, 'blocks', ${me})`),
    );
    const c = await cookie(SEED_USERS.colabTi.email);
    const p = await project('TI');
    const board = await app.inject({ method: 'GET', url: `/api/projects/${p.id}/tasks`, headers: { cookie: c } });
    const cards = board.json<{ id: string; blocked: boolean }[]>();
    expect(cards.find((x) => x.id === b)?.blocked).toBe(true);
    expect(cards.find((x) => x.id === a)?.blocked).toBe(false);
    const other = await as(db, 'colabCtrl', (tx) => q<{ n: number }>(tx, sql`select count(*)::int as n from task_links where source_task_id = ${a}`));
    expect(other[0]?.n).toBe(0);
  });

  it('épico de outro projeto é recusado', async () => {
    const ctrl = await project('CTRL');
    const me = await userId(db, 'gestorCtrl');
    const [epic] = await as(db, 'gestorCtrl', (tx) =>
      q<{ id: string }>(tx, sql`insert into epics (project_id, name, created_by) values (${ctrl.id}, 'Fechamento', ${me}) returning id`),
    );
    const task = await newTask('admin', 'TI', 'Tarefa TI');
    const err = await pgError(as(db, 'admin', (tx) => tx.execute(sql`update tasks set epic_id = ${epic?.id ?? ''} where id = ${task}`)));
    expect(err).toMatch(/mesmo projeto/);
  });

  it('imagem: envia, lê com permissão e bloqueia quem não vê a tarefa', async () => {
    const task = await newTask('colabTi', 'TI', 'Com print');
    const c = await cookie(SEED_USERS.colabTi.email);
    const up = await app.inject({
      method: 'POST',
      url: `/api/files?taskId=${task}&name=print.png&attach=true`,
      headers: { ...headers, cookie: c, 'content-type': 'image/png' },
      payload: PNG,
    });
    expect(up.statusCode).toBe(201);
    const { url } = up.json<{ url: string }>();
    const own = await app.inject({ method: 'GET', url, headers: { cookie: c } });
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toBe('image/png');
    const outsider = await app.inject({ method: 'GET', url, headers: { cookie: await cookie(SEED_USERS.colabCtrl.email) } });
    expect(outsider.statusCode).toBe(404);
    const fake = await app.inject({
      method: 'POST',
      url: `/api/files?taskId=${task}`,
      headers: { ...headers, cookie: c, 'content-type': 'image/png' },
      payload: Buffer.from('<svg onload=alert(1)>'),
    });
    expect(fake.statusCode).toBe(422);
  });

  it('SLA: prazo calculado na abertura e aviso ao estourar', async () => {
    const [ti] = await as(db, 'admin', (tx) =>
      q<{ id: string; type: string }>(
        tx,
        sql`select d.id, tt.id as type from departments d join ticket_types tt on tt.department_id = d.id where d.acronym = 'TI'`,
      ),
    );
    await as(db, 'gestorTi', (tx) => tx.execute(sql`update ticket_types set sla_hours = 8 where id = ${ti?.type ?? ''}`));
    const [opened] = await as(db, 'colabCtrl', (tx) =>
      q<{ id: string }>(tx, sql`select app.ticket_open(${ti?.id ?? ''}, ${ti?.type ?? ''}, 'Com SLA', null, '', 'high', null, null) as id`),
    );
    const [k] = await as(db, 'admin', (tx) =>
      q<{ hours: number }>(tx, sql`select extract(epoch from sla_due_at - submitted_at)::int / 3600 as hours from tickets where id = ${opened?.id ?? ''}`),
    );
    expect(k?.hours).toBe(8);
    // Simula o tempo passando (como dono do schema, fora do RLS).
    const owner = createDb(process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/unimais_hub_test', { max: 1 });
    await owner.db.execute(sql`update tickets set sla_due_at = now() - interval '1 hour', submitted_at = now() - interval '9 hours' where id = ${opened?.id ?? ''}`);
    await owner.close();
    await db.execute(sql`select app.job_sla()`);
    const notes = await as(db, 'gestorTi', (tx) =>
      q<{ n: number }>(tx, sql`select count(*)::int as n from notifications n join tickets k on k.task_id = n.task_id
                               where k.id = ${opened?.id ?? ''} and n.type = 'ticket_sla_breached'`),
    );
    expect(notes[0]?.n).toBe(1);
  });

  it('ações em massa: muda a prioridade de vários cartões e manda ao backlog', async () => {
    const a = await newTask('colabTi', 'TI', 'Massa A');
    const b = await newTask('colabTi', 'TI', 'Massa B');
    const c = await cookie(SEED_USERS.colabTi.email);
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk',
      headers: { ...headers, cookie: c },
      payload: { taskIds: [a, b], priority: 'urgent', inBacklog: true },
    });
    expect(res.json()).toEqual({ updated: 2, skipped: 0 });
    const p = await project('TI');
    const backlog = await app.inject({ method: 'GET', url: `/api/projects/${p.id}/tasks?backlog=true`, headers: { cookie: c } });
    expect(backlog.json<{ id: string }[]>().map((t) => t.id)).toEqual(expect.arrayContaining([a, b]));
    const board = await app.inject({ method: 'GET', url: `/api/projects/${p.id}/tasks`, headers: { cookie: c } });
    expect(board.json<{ id: string }[]>().some((t) => t.id === a)).toBe(false);
  });

  it('chamado aberto por e-mail de usuário ativo', async () => {
    const id = await openTicketFromEmail(db, 'TI', {
      fromEmail: SEED_USERS.colabCtrl.email,
      title: 'Mouse quebrado',
      body: 'O mouse da sala 3 parou.',
    });
    expect(id).toBeTruthy();
    expect(await openTicketFromEmail(db, 'TI', { fromEmail: 'desconhecido@x.com', title: 'x', body: '' })).toBeNull();
  });

  it('aba Fluxo dos painéis responde', async () => {
    const c = await cookie(SEED_USERS.admin.email);
    const res = await app.inject({ method: 'GET', url: '/api/dashboards/flow?from=2026-01-01&to=2026-12-31', headers: { cookie: c } });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ cfd: unknown[] }>().cfd.length).toBeGreaterThan(0);
  });
});
