import postgres from 'postgres';
import { addDays, todayIso } from '@hub/shared';
import { hashPassword } from './passwords';

/**
 * Dados de teste (etapa 2): T.I e Controladoria, 1 usuário de cada perfil, o tipo
 * "Solicitação geral" (criado pelo trigger do departamento), tarefas e um chamado de exemplo.
 * Roda como dono do schema. Não roda duas vezes no mesmo banco.
 */
export const SEED_PASSWORD = 'Unimais2026';

export const SEED_USERS = {
  admin: { name: 'Administrador Geral', email: 'admin@unimais.edu.br', role: 'admin', job: 'Administração do sistema' },
  gestorTi: { name: 'Yandra Morais', email: 'gestor.ti@unimais.edu.br', role: 'gestor', job: 'Coordenadora de T.I' },
  colabTi: { name: 'Carla Técnica', email: 'colaborador.ti@unimais.edu.br', role: 'colaborador', job: 'Técnica de suporte' },
  gestorCtrl: { name: 'Diego Controller', email: 'gestor.controladoria@unimais.edu.br', role: 'gestor', job: 'Coordenador de Controladoria' },
  colabCtrl: { name: 'Elisa Analista', email: 'colaborador.controladoria@unimais.edu.br', role: 'colaborador', job: 'Analista contábil' },
  observador: { name: 'Fábio Diretor', email: 'observador@unimais.edu.br', role: 'observador', job: 'Diretor administrativo' },
} as const;

type SeedKey = keyof typeof SEED_USERS;

export async function seed(adminUrl: string): Promise<void> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  try {
    const [existing] = await sql<{ n: number }[]>`select count(*)::int as n from departments`;
    if ((existing?.n ?? 0) > 0) {
      console.log('Seed ignorado: o banco já tem departamentos.');
      return;
    }

    const passwordHash = await hashPassword(SEED_PASSWORD);

    await sql.begin(async (tx) => {
      const [ti] = await tx<{ id: string }[]>`
        insert into departments (name, acronym, color, description)
        values ('T.I', 'TI', 'navy', 'Tecnologia da Informação') returning id`;
      const [ctrl] = await tx<{ id: string }[]>`
        insert into departments (name, acronym, color, description)
        values ('Controladoria', 'CTRL', 'teal', 'Controladoria e orçamento') returning id`;
      if (!ti || !ctrl) throw new Error('Falha ao criar departamentos');

      const ids = {} as Record<SeedKey, string>;
      for (const [key, u] of Object.entries(SEED_USERS) as [SeedKey, (typeof SEED_USERS)[SeedKey]][]) {
        const [row] = await tx<{ id: string }[]>`
          insert into users (name, email, role, job_title, sees_all_departments)
          values (${u.name}, ${u.email}, ${u.role}, ${u.job}, ${key === 'observador'})
          returning id`;
        if (!row) throw new Error('Falha ao criar usuário');
        ids[key] = row.id;
        await tx`insert into user_credentials (user_id, password_hash, password_changed_at)
                 values (${row.id}, ${passwordHash}, now())`;
      }

      const members: [SeedKey, string, boolean, boolean][] = [
        ['gestorTi', ti.id, true, true],
        ['colabTi', ti.id, true, false],
        ['gestorCtrl', ctrl.id, true, true],
        ['colabCtrl', ctrl.id, true, false],
        ['observador', ti.id, true, false],
        ['observador', ctrl.id, false, false],
      ];
      for (const [key, dept, primary, manager] of members) {
        await tx`insert into department_members (user_id, department_id, is_primary, is_manager)
                 values (${ids[key]}, ${dept}, ${primary}, ${manager})`;
      }

      const columns = await tx<{ id: string; name: string; project_key: string; project_id: string }[]>`
        select c.id, c.name, p.key as project_key, p.id as project_id
        from board_columns c join projects p on p.id = c.project_id`;
      const col = (key: string, name: string) => {
        const c = columns.find((x) => x.project_key === key && x.name === name);
        if (!c) throw new Error(`Coluna ${key}/${name} não encontrada`);
        return c;
      };

      const tasks: {
        key: string;
        column: string;
        title: string;
        priority: string;
        assignee: SeedKey | null;
        reporter: SeedKey;
        dueInDays: number | null;
        position: string;
      }[] = [
        { key: 'TI', column: 'A fazer', title: 'Atualizar antivírus dos laboratórios', priority: 'high', assignee: 'colabTi', reporter: 'gestorTi', dueInDays: 3, position: 'a0' },
        { key: 'TI', column: 'A fazer', title: 'Inventariar notebooks da biblioteca', priority: 'medium', assignee: null, reporter: 'gestorTi', dueInDays: 10, position: 'a1' },
        { key: 'TI', column: 'Em andamento', title: 'Migrar e-mails da secretaria', priority: 'urgent', assignee: 'colabTi', reporter: 'gestorTi', dueInDays: -2, position: 'a0' },
        { key: 'TI', column: 'Em revisão', title: 'Documentar rotina de backup mensal', priority: 'low', assignee: 'gestorTi', reporter: 'colabTi', dueInDays: 1, position: 'a0' },
        { key: 'TI', column: 'Concluído', title: 'Trocar switch do bloco B', priority: 'high', assignee: 'colabTi', reporter: 'gestorTi', dueInDays: -5, position: 'a0' },
        { key: 'CTRL', column: 'A fazer', title: 'Conciliar contas de outubro', priority: 'high', assignee: 'colabCtrl', reporter: 'gestorCtrl', dueInDays: 5, position: 'a0' },
        { key: 'CTRL', column: 'Em andamento', title: 'Revisar orçamento 2027', priority: 'medium', assignee: 'gestorCtrl', reporter: 'gestorCtrl', dueInDays: 14, position: 'a0' },
        { key: 'CTRL', column: 'Concluído', title: 'Fechamento de setembro', priority: 'medium', assignee: 'colabCtrl', reporter: 'gestorCtrl', dueInDays: -20, position: 'a0' },
      ];
      for (const t of tasks) {
        const c = col(t.key, t.column);
        const description = {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `Tarefa de exemplo: ${t.title.toLowerCase()}.` }] }],
        };
        await tx`
          insert into tasks (project_id, column_id, title, description, description_text, priority,
                             assignee_id, reporter_id, due_date, position)
          values (${c.project_id}, ${c.id}, ${t.title}, ${tx.json(description)},
                  ${description.content[0]?.content[0]?.text ?? ''}, ${t.priority},
                  ${t.assignee ? ids[t.assignee] : null}, ${ids[t.reporter]},
                  ${t.dueInDays === null ? null : addDays(todayIso(), t.dueInDays)},
                  ${t.position})`;
      }

      // Chamado de exemplo: Controladoria pede à T.I, que triou, atribuiu e está executando.
      const [type] = await tx<{ id: string }[]>`
        select id from ticket_types where department_id = ${ti.id} limit 1`;
      if (!type) throw new Error('Tipo de chamado não criado');
      await tx`select set_config('app.user_id', ${ids.colabCtrl}, true)`;
      const [ticket] = await tx<{ id: string }[]>`
        select app.ticket_open(${ti.id}, ${type.id}, 'Liberar acesso ao sistema financeiro para nova analista',
          ${tx.json({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A analista começa na segunda-feira e precisa de acesso de leitura.' }] }] })},
          'A analista começa na segunda-feira e precisa de acesso de leitura.',
          'high', (now() at time zone 'America/Sao_Paulo')::date + 4, null) as id`;
      if (!ticket) throw new Error('Falha ao abrir chamado');
      await tx`select set_config('app.user_id', ${ids.gestorTi}, true)`;
      await tx`select app.ticket_transition(${ticket.id}, 'triage', null)`;
      await tx`select app.ticket_assign(${ticket.id}, ${ids.colabTi})`;
      await tx`select app.ticket_transition(${ticket.id}, 'in_progress', null)`;

      // Segundo chamado, ainda novo: T.I pede à Controladoria.
      const [typeCtrl] = await tx<{ id: string }[]>`
        select id from ticket_types where department_id = ${ctrl.id} limit 1`;
      if (!typeCtrl) throw new Error('Tipo de chamado não criado');
      await tx`select set_config('app.user_id', ${ids.colabTi}, true)`;
      await tx`select app.ticket_open(${ctrl.id}, ${typeCtrl.id}, 'Aprovar compra de 10 licenças de antivírus',
          null, '', 'medium', (now() at time zone 'America/Sao_Paulo')::date + 7, ${ids.gestorTi})`;
      await tx`select set_config('app.user_id', '', true)`;

      await tx`
        insert into calendar_events (title, department_id, start_date, end_date, kind, created_by)
        values ('Semana acadêmica', null, (now() at time zone 'America/Sao_Paulo')::date + 12,
                (now() at time zone 'America/Sao_Paulo')::date + 16, 'event', ${ids.admin}),
               ('Manutenção do datacenter', ${ti.id}, (now() at time zone 'America/Sao_Paulo')::date + 6,
                (now() at time zone 'America/Sao_Paulo')::date + 6, 'event', ${ids.gestorTi})`;
    });

    console.log(`Seed concluído. Senha de todos os usuários de teste: ${SEED_PASSWORD}`);
    for (const u of Object.values(SEED_USERS)) console.log(`  ${u.role.padEnd(12)} ${u.email}`);
  } finally {
    await sql.end();
  }
}
