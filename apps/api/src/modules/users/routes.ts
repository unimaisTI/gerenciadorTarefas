import { and, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Transaction } from '@hub/db';
import {
  createUserSchema,
  listUsersQuery,
  permissions,
  updateUserSchema,
  uuid,
  type CreateUserInput,
  type DeactivateResultDto,
  type DirectoryUserDto,
  type Paginated,
  type UserDto,
} from '@hub/shared';
import { audit } from '../../lib/audit';
import { inviteEmail, resetEmail } from '../../lib/emails';
import { one, rows } from '../../lib/sql';
import { hashToken, newToken } from '../../lib/tokens';
import { asViewer, requireViewer } from '../../plugins/auth';
import { forbidden, notFound, unprocessable } from '../../plugins/errors';
import { getUser, listUsers } from './queries';

const idParams = z.object({ id: uuid });

function assertDepartments(input: Pick<CreateUserInput, 'role' | 'departments'>) {
  if (input.departments.some((d) => d.isManager) && !['admin', 'gestor'].includes(input.role)) {
    throw unprocessable('Só usuários com perfil Gestor ou Administrador podem ser gestores de departamento.');
  }
}

async function replaceMemberships(tx: Transaction, userId: string, departments: CreateUserInput['departments']) {
  await tx.execute(sql`delete from department_members where user_id = ${userId}`);
  const primaryIndex = Math.max(0, departments.findIndex((d) => d.isPrimary));
  for (const [i, d] of departments.entries()) {
    await tx.execute(sql`
      insert into department_members (user_id, department_id, is_primary, is_manager)
      values (${userId}, ${d.departmentId}, ${i === primaryIndex}, ${d.isManager})`);
  }
}

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  const adminOnly = {
    onRequest: [
      async (request: Parameters<typeof requireViewer>[0]) => {
        if (!permissions.manageUsers(requireViewer(request))) throw forbidden();
      },
    ],
  };

  /** Diretório para seletores de pessoas e menções (todos os logados). */
  app.get('/users/directory', (request) =>
    asViewer(request, (tx) =>
      rows<DirectoryUserDto>(
        tx,
        sql`select u.id, u.name, u.avatar_url as "avatarUrl", u.job_title as "jobTitle",
              coalesce(array_agg(m.department_id) filter (where m.department_id is not null), '{}') as "departmentIds"
            from users u left join department_members m on m.user_id = u.id
            where u.is_active group by u.id order by u.name`,
      ),
    ),
  );

  app.get('/users', { ...adminOnly, schema: { querystring: listUsersQuery } }, (request) =>
    asViewer(request, async (tx) => {
      const q = request.query;
      const filters: SQL[] = [sql`true`];
      if (q.q) filters.push(sql`(u.name ilike ${`%${q.q}%`} or u.email ilike ${`%${q.q}%`})`);
      if (q.role) filters.push(sql`u.role = ${q.role}`);
      if (q.status !== 'all') filters.push(sql`u.is_active = ${q.status === 'active'}`);
      if (q.departmentId) {
        filters.push(sql`exists (select 1 from department_members m where m.user_id = u.id and m.department_id = ${q.departmentId})`);
      }
      const items = await listUsers(tx, and(...filters) ?? sql`true`, q.pageSize, (q.page - 1) * q.pageSize);
      const total = items[0]?.total ?? 0;
      const result: Paginated<UserDto> = {
        items: items.map(({ total: _t, ...u }) => u),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
      return result;
    }),
  );

  app.get('/users/:id', { ...adminOnly, schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx) => {
      const user = await getUser(tx, request.params.id);
      if (!user) throw notFound('Usuário não encontrado.');
      return user;
    }),
  );

  // RF-4.2: cria e envia o convite de primeiro acesso.
  app.post('/users', { ...adminOnly, schema: { body: createUserSchema } }, async (request, reply) => {
    const body = request.body;
    assertDepartments(body);
    const token = newToken();
    const user = await asViewer(request, async (tx) => {
      const created = await one<{ id: string }>(
        tx,
        sql`insert into users (name, email, job_title, phone, avatar_url, role, sees_all_departments)
            values (${body.name}, ${body.email}, ${body.jobTitle ?? null}, ${body.phone ?? null},
                    ${body.avatarUrl ?? null}, ${body.role}, ${body.seesAllDepartments})
            returning id`,
      );
      if (!created) throw new Error('Falha ao criar usuário');
      await replaceMemberships(tx, created.id, body.departments);
      await tx.execute(sql`select * from app.admin_issue_token(${created.id}, 'invite', ${hashToken(token)})`);
      await audit(tx, request, 'user_created', body.email, { role: body.role });
      return getUser(tx, created.id);
    });
    if (!user) throw new Error('Falha ao criar usuário');
    await app.mailer.send(inviteEmail(user.email, user.name, `${app.env.APP_URL}/definir-senha?token=${token}`));
    return reply.status(201).send(user);
  });

  app.patch('/users/:id', { ...adminOnly, schema: { params: idParams, body: updateUserSchema } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const id = request.params.id;
      const before = await getUser(tx, id);
      if (!before) throw notFound('Usuário não encontrado.');
      const b = request.body;
      const role = b.role ?? before.role;
      if (b.departments) assertDepartments({ role, departments: b.departments });
      if (id === viewer.id && b.role && b.role !== 'admin') {
        throw unprocessable('Você não pode tirar o seu próprio perfil de administrador.');
      }
      await tx.execute(sql`
        update users set
          name = coalesce(${b.name ?? null}, name),
          email = coalesce(${b.email ?? null}, email),
          job_title = case when ${b.jobTitle !== undefined} then ${b.jobTitle ?? null} else job_title end,
          phone = case when ${b.phone !== undefined} then ${b.phone ?? null} else phone end,
          avatar_url = case when ${b.avatarUrl !== undefined} then ${b.avatarUrl ?? null} else avatar_url end,
          role = coalesce(${b.role ?? null}::user_role, role),
          sees_all_departments = coalesce(${b.seesAllDepartments ?? null}::boolean, sees_all_departments)
        where id = ${id}`);
      if (b.departments) await replaceMemberships(tx, id, b.departments);
      if (b.role && b.role !== before.role) {
        await audit(tx, request, 'role_changed', before.email, { from: before.role, to: b.role });
      }
      await audit(tx, request, 'user_updated', before.email, { fields: Object.keys(b) });
      return getUser(tx, id);
    }),
  );

  // RF-4.4: desativa (não exclui) e lista as tarefas abertas para reatribuir.
  app.post('/users/:id/deactivate', { ...adminOnly, schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx, viewer) => {
      const id = request.params.id;
      if (id === viewer.id) throw unprocessable('Você não pode desativar a sua própria conta.');
      const user = await getUser(tx, id);
      if (!user) throw notFound('Usuário não encontrado.');
      await tx.execute(sql`update users set is_active = false where id = ${id}`);
      await audit(tx, request, 'user_deactivated', user.email);
      const openTasks = await rows<DeactivateResultDto['openTasks'][number]>(
        tx,
        sql`select t.id, p.key || '-' || t.number as code, t.title, p.name as "projectName"
            from tasks t join projects p on p.id = t.project_id
            where t.assignee_id = ${id} and t.deleted_at is null and t.completed_at is null
            order by t.due_date nulls last`,
      );
      const result: DeactivateResultDto = { openTasks };
      return result;
    }),
  );

  app.post('/users/:id/activate', { ...adminOnly, schema: { params: idParams } }, (request) =>
    asViewer(request, async (tx) => {
      const user = await getUser(tx, request.params.id);
      if (!user) throw notFound('Usuário não encontrado.');
      await tx.execute(sql`update users set is_active = true where id = ${request.params.id}`);
      await audit(tx, request, 'user_activated', user.email);
      return getUser(tx, request.params.id);
    }),
  );

  // RF-4.5: reenviar convite ou forçar redefinição de senha.
  app.post(
    '/users/:id/invite',
    { ...adminOnly, schema: { params: idParams, body: z.object({ kind: z.enum(['invite', 'reset']) }) } },
    async (request) => {
      const token = newToken();
      const kind = request.body.kind;
      const target = await asViewer(request, async (tx) => {
        const row = await one<{ email: string; name: string }>(
          tx,
          sql`select email, name from app.admin_issue_token(${request.params.id}, ${kind}, ${hashToken(token)})`,
        );
        if (!row) throw notFound('Usuário não encontrado.');
        await audit(tx, request, kind === 'invite' ? 'invite_resent' : 'password_reset_forced', row.email);
        return row;
      });
      const url = `${app.env.APP_URL}/definir-senha?token=${token}`;
      await app.mailer.send(
        kind === 'invite' ? inviteEmail(target.email, target.name, url) : resetEmail(target.email, target.name, url),
      );
      return { ok: true };
    },
  );
};
