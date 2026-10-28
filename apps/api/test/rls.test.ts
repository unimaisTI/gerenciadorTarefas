import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withUser } from '@hub/db';
import { as, dbAvailable, pgError, q, testDb, userId } from './helpers';

// RF-2.1, RF-2.2, RNF-01: as regras valem no banco, não só na API.
describe.skipIf(!dbAvailable)('RLS e permissões no banco', () => {
  const { db, close } = testDb();
  afterAll(close);

  const projectId = async (key: string) => {
    const rows = await as(db, 'admin', (tx) => q<{ id: string }>(tx, sql`select id from projects where key = ${key}`));
    return rows[0]?.id ?? '';
  };
  const firstColumn = async (projectKey: string) => {
    const rows = await as(db, 'admin', (tx) =>
      q<{ id: string }>(
        tx,
        sql`select c.id from board_columns c join projects p on p.id = c.project_id
            where p.key = ${projectKey} order by c.position limit 1`,
      ),
    );
    return rows[0]?.id ?? '';
  };

  it('a conexão da API não ignora RLS e o setting não vaza entre transações', async () => {
    const [role] = (await db.execute(
      sql`select rolbypassrls as bypass, rolsuper as superuser from pg_roles where rolname = current_user`,
    )) as unknown as { bypass: boolean; superuser: boolean }[];
    expect(role).toEqual({ bypass: false, superuser: false });

    await withUser(db, await userId(db, 'colabTi'), () => Promise.resolve());
    const [after] = (await db.execute(sql`select current_setting('app.user_id', true) as v`)) as unknown as {
      v: string | null;
    }[];
    expect(after?.v ?? '').toBe('');
  });

  it('sem usuário na sessão nada é visível', async () => {
    const rows = (await db.execute(sql`select count(*)::int as n from tasks`)) as unknown as { n: number }[];
    expect(rows[0]?.n).toBe(0);
  });

  it('credenciais e sessões não são legíveis pela API', async () => {
    const err = await pgError(as(db, 'admin', (tx) => q(tx, sql`select * from user_credentials`)));
    expect(err).toMatch(/permission denied/i);
  });

  it('colaborador só vê tarefas dos próprios departamentos', async () => {
    const ti = await projectId('TI');
    const visible = await as(db, 'colabCtrl', (tx) =>
      q<{ n: number }>(tx, sql`select count(*)::int as n from tasks where project_id = ${ti}`),
    );
    expect(visible[0]?.n).toBe(0);
    const own = await as(db, 'colabTi', (tx) =>
      q<{ n: number }>(tx, sql`select count(*)::int as n from tasks where project_id = ${ti}`),
    );
    expect(own[0]?.n).toBeGreaterThan(0);
  });

  it('observador vê, mas não cria tarefas', async () => {
    const ti = await projectId('TI');
    const col = await firstColumn('TI');
    const me = await userId(db, 'observador');
    const seen = await as(db, 'observador', (tx) =>
      q<{ n: number }>(tx, sql`select count(*)::int as n from tasks where project_id = ${ti}`),
    );
    expect(seen[0]?.n).toBeGreaterThan(0);
    const err = await pgError(
      as(db, 'observador', (tx) =>
        tx.execute(sql`insert into tasks (project_id, column_id, title, reporter_id, position)
                       values (${ti}, ${col}, 'Teste', ${me}, app.position_after_last(${col}))`),
      ),
    );
    expect(err).toMatch(/row-level security/i);
  });

  it('colaborador de outro departamento não cria tarefa no quadro alheio', async () => {
    const ti = await projectId('TI');
    const col = await firstColumn('TI');
    const me = await userId(db, 'colabCtrl');
    const err = await pgError(
      as(db, 'colabCtrl', (tx) =>
        tx.execute(sql`insert into tasks (project_id, column_id, title, reporter_id, position)
                       values (${ti}, ${col}, 'Invasão', ${me}, app.position_after_last(${col}))`),
      ),
    );
    expect(err).toMatch(/row-level security/i);
  });

  it('colaborador só exclui o que criou; gestor restaura da lixeira', async () => {
    const ti = await projectId('TI');
    const col = await firstColumn('TI');
    const gestor = await userId(db, 'gestorTi');
    const [task] = await as(db, 'gestorTi', (tx) =>
      q<{ id: string }>(
        tx,
        sql`insert into tasks (project_id, column_id, title, reporter_id, position)
            values (${ti}, ${col}, 'Criada pelo gestor', ${gestor}, app.position_after_last(${col})) returning id`,
      ),
    );
    const err = await pgError(
      as(db, 'colabTi', (tx) => tx.execute(sql`update tasks set deleted_at = now() where id = ${task?.id ?? ''}`)),
    );
    expect(err).toMatch(/só pode excluir tarefas que criou/);

    await as(db, 'gestorTi', (tx) => tx.execute(sql`update tasks set deleted_at = now() where id = ${task?.id ?? ''}`));
    const hidden = await as(db, 'colabTi', (tx) =>
      q<{ n: number }>(tx, sql`select count(*)::int as n from tasks where id = ${task?.id ?? ''}`),
    );
    expect(hidden[0]?.n).toBe(0);
    await as(db, 'gestorTi', (tx) => tx.execute(sql`update tasks set deleted_at = null where id = ${task?.id ?? ''}`));
  });

  it('ninguém apaga tarefa fisicamente', async () => {
    const err = await pgError(as(db, 'admin', (tx) => tx.execute(sql`delete from tasks where false`)));
    expect(err).toMatch(/permission denied/i);
  });

  it('usuário comum não muda o próprio perfil de acesso', async () => {
    const me = await userId(db, 'colabTi');
    const err = await pgError(as(db, 'colabTi', (tx) => tx.execute(sql`update users set role = 'admin' where id = ${me}`)));
    expect(err).toMatch(/Só o administrador/);
    await as(db, 'colabTi', (tx) => tx.execute(sql`update users set phone = '1234' where id = ${me}`));
  });

  it('gestor adiciona membro, mas não promove a gestor', async () => {
    const ti = await as(db, 'admin', (tx) => q<{ id: string }>(tx, sql`select id from departments where acronym = 'TI'`));
    const colabCtrl = await userId(db, 'colabCtrl');
    const err = await pgError(
      as(db, 'gestorTi', (tx) =>
        tx.execute(sql`insert into department_members (user_id, department_id, is_manager)
                       values (${colabCtrl}, ${ti[0]?.id ?? ''}, true)`),
      ),
    );
    expect(err).toMatch(/row-level security/i);
  });

  it('notificações de outra pessoa são invisíveis', async () => {
    const other = await userId(db, 'gestorTi');
    const rows = await as(db, 'colabCtrl', (tx) =>
      q<{ n: number }>(tx, sql`select count(*)::int as n from notifications where user_id = ${other}`),
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('auditoria só para o admin', async () => {
    const admin = await as(db, 'admin', (tx) => q<{ n: number }>(tx, sql`select count(*)::int as n from audit_log`));
    const gestor = await as(db, 'gestorTi', (tx) => q<{ n: number }>(tx, sql`select count(*)::int as n from audit_log`));
    expect(admin[0]?.n).toBeGreaterThanOrEqual(0);
    expect(gestor[0]?.n).toBe(0);
  });
});
