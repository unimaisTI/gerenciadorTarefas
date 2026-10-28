import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, dbAvailable, pgError, q, testDb, userId } from './helpers';

// Seção 7 e RNF-12: fluxo completo do chamado entre dois departamentos.
describe.skipIf(!dbAvailable)('máquina de estados do chamado', () => {
  const { db, close } = testDb();
  afterAll(close);

  let ticketId = '';
  let taskId = '';

  const status = async () => {
    const rows = await as(db, 'admin', (tx) =>
      q<{ status: string; revision: number; stage: string | null }>(
        tx,
        sql`select k.status, k.revision_count as revision, c.ticket_stage as stage
            from tickets k join tasks t on t.id = k.task_id join board_columns c on c.id = t.column_id
            where k.id = ${ticketId}`,
      ),
    );
    return rows[0];
  };
  const transition = (who: Parameters<typeof as>[1], to: string, note: string | null = null) =>
    as(db, who, (tx) => tx.execute(sql`select app.ticket_transition(${ticketId}, ${to}::ticket_status, ${note})`));

  beforeAll(async () => {
    const [ti] = await as(db, 'admin', (tx) => q<{ id: string; type: string }>(
      tx,
      sql`select d.id, tt.id as type from departments d join ticket_types tt on tt.department_id = d.id where d.acronym = 'TI'`,
    ));
    const [opened] = await as(db, 'colabCtrl', (tx) =>
      q<{ id: string }>(
        tx,
        sql`select app.ticket_open(${ti?.id ?? ''}, ${ti?.type ?? ''}, 'Instalar impressora', null, '', 'medium', null, null) as id`,
      ),
    );
    ticketId = opened?.id ?? '';
    const [t] = await as(db, 'admin', (tx) => q<{ taskId: string }>(tx, sql`select task_id as "taskId" from tickets where id = ${ticketId}`));
    taskId = t?.taskId ?? '';
  });

  it('abre como "Aberto" na coluna Novos, com código CH-n', async () => {
    const rows = await as(db, 'colabCtrl', (tx) => q<{ code: string }>(tx, sql`select code from tickets where id = ${ticketId}`));
    expect(rows[0]?.code).toMatch(/^CH-\d+$/);
    expect(await status()).toMatchObject({ status: 'open', stage: 'new' });
  });

  it('o gestor do executor foi notificado', async () => {
    const rows = await as(db, 'gestorTi', (tx) =>
      q<{ n: number }>(tx, sql`select count(*)::int as n from notifications where task_id = ${taskId} and type = 'ticket_opened'`),
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('não muda status por update direto', async () => {
    const err = await pgError(
      db.transaction(async (tx) => {
        await tx.execute(sql`update tickets set status = 'approved'`);
      }),
    );
    expect(err).toMatch(/permission denied/i);
  });

  it('não move o cartão do chamado arrastando entre colunas', async () => {
    const [col] = await as(db, 'admin', (tx) =>
      q<{ id: string }>(tx, sql`select c.id from board_columns c join tasks t on t.project_id = c.project_id
                                where t.id = ${taskId} and c.ticket_stage = 'closed'`),
    );
    const err = await pgError(
      as(db, 'gestorTi', (tx) => tx.execute(sql`update tasks set column_id = ${col?.id ?? ''} where id = ${taskId}`)),
    );
    expect(err).toMatch(/só muda pelas ações do chamado/);
  });

  it('solicitante não faz a triagem; colaborador do executor também não', async () => {
    expect(await pgError(transition('colabCtrl', 'triage'))).toMatch(/não pode executar/);
    expect(await pgError(transition('colabTi', 'triage'))).toMatch(/não pode executar/);
  });

  it('sem responsável, ninguém age como "responsável" (pedir informações)', async () => {
    // triage → awaiting_info aceita gestor do executor ou responsável; o colaborador não é nenhum dos dois.
    await transition('gestorTi', 'triage');
    expect(await pgError(transition('colabTi', 'awaiting_info', 'Faltam dados'))).toMatch(/não pode executar/);
    expect(await pgError(transition('colabCtrl', 'awaiting_info', 'Faltam dados'))).toMatch(/não pode executar/);
  });

  it('transição fora da tabela é recusada', async () => {
    expect(await pgError(transition('gestorTi', 'approved'))).toMatch(/não permitida/);
  });

  it('execução exige responsável; atribuição é só do gestor do executor', async () => {
    expect(await pgError(transition('gestorTi', 'in_progress'))).toMatch(/Atribua um responsável/);
    const colab = await userId(db, 'colabTi');
    expect(
      await pgError(as(db, 'colabTi', (tx) => tx.execute(sql`select app.ticket_assign(${ticketId}, ${colab})`))),
    ).toMatch(/Só o gestor/);
    await as(db, 'gestorTi', (tx) => tx.execute(sql`select app.ticket_assign(${ticketId}, ${colab})`));
    await transition('gestorTi', 'in_progress');
    expect(await status()).toMatchObject({ status: 'in_progress', stage: 'execution' });
  });

  it('entrega exige comentário e vai para "Aguardando aprovação"', async () => {
    expect(await pgError(transition('colabTi', 'awaiting_approval'))).toMatch(/motivo ou o comentário/);
    await transition('colabTi', 'awaiting_approval', 'Impressora instalada na sala 12.');
    expect(await status()).toMatchObject({ status: 'awaiting_approval', stage: 'approval' });
    const notified = await as(db, 'colabCtrl', (tx) =>
      q<{ n: number }>(tx, sql`select count(*)::int as n from notifications where task_id = ${taskId} and type = 'ticket_awaiting_approval'`),
    );
    expect(notified[0]?.n).toBe(1);
  });

  it('só o lado solicitante aprova ou devolve; devolver exige motivo e conta revisão', async () => {
    expect(await pgError(transition('gestorTi', 'approved'))).toMatch(/não pode executar/);
    expect(await pgError(transition('colabCtrl', 'returned'))).toMatch(/motivo/);
    await transition('colabCtrl', 'returned', 'Falta instalar o driver no notebook.');
    expect(await status()).toMatchObject({ status: 'returned', revision: 1, stage: 'execution' });
  });

  it('nova entrega e aprovação pelo gestor do departamento solicitante', async () => {
    await transition('colabTi', 'awaiting_approval', 'Driver instalado.');
    await transition('gestorCtrl', 'approved');
    expect(await status()).toMatchObject({ status: 'approved', revision: 1, stage: 'closed' });
  });

  it('chamado encerrado não aceita novas transições e a linha do tempo está completa', async () => {
    expect(await pgError(transition('colabCtrl', 'cancelled'))).toMatch(/não permitida/);
    const events = await as(db, 'colabCtrl', (tx) =>
      q<{ to: string }>(tx, sql`select to_status as to from ticket_events where ticket_id = ${ticketId} order by created_at`),
    );
    expect(events.map((e) => e.to)).toEqual([
      'open', 'triage', 'triage', 'in_progress', 'awaiting_approval', 'returned', 'awaiting_approval', 'approved',
    ]);
  });

  it('solicitante vê o chamado, mas não as subtarefas nem comentários internos do executor', async () => {
    const gestor = await userId(db, 'gestorTi');
    await as(db, 'gestorTi', async (tx) => {
      const [t] = await q<{ projectId: string; columnId: string }>(
        tx,
        sql`select project_id as "projectId", column_id as "columnId" from tasks where id = ${taskId}`,
      );
      await tx.execute(sql`insert into tasks (project_id, column_id, title, reporter_id, position, parent_task_id)
                           values (${t?.projectId ?? ''}, ${t?.columnId ?? ''}, 'Comprar cabo', ${gestor}, app.position_after_last(${t?.columnId ?? ''}), ${taskId})`);
      await tx.execute(sql`insert into comments (task_id, author_id, body, body_text, visibility)
                           values (${taskId}, ${gestor}, '{"type":"doc"}', 'interno', 'internal')`);
    });
    const seen = await as(db, 'colabCtrl', (tx) =>
      q<{ tasks: number; internal: number }>(
        tx,
        sql`select (select count(*)::int from tasks where id = ${taskId} or parent_task_id = ${taskId}) as tasks,
                   (select count(*)::int from comments where task_id = ${taskId} and visibility = 'internal') as internal`,
      ),
    );
    expect(seen[0]).toEqual({ tasks: 1, internal: 0 });
  });

  it('não abre chamado para o próprio departamento', async () => {
    const [ctrl] = await as(db, 'admin', (tx) => q<{ id: string; type: string }>(
      tx,
      sql`select d.id, tt.id as type from departments d join ticket_types tt on tt.department_id = d.id where d.acronym = 'CTRL'`,
    ));
    const err = await pgError(
      as(db, 'colabCtrl', (tx) =>
        tx.execute(sql`select app.ticket_open(${ctrl?.id ?? ''}, ${ctrl?.type ?? ''}, 'X', null, '', 'low', null, null)`),
      ),
    );
    expect(err).toMatch(/próprio departamento/);
  });
});
