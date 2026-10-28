import { sql, type SQL } from 'drizzle-orm';
import type { Executor } from '@hub/db';
import type { UserDto } from '@hub/shared';
import { one, rows } from '../../lib/sql';

const USER_COLUMNS = sql`
  u.id, u.name, u.email, u.job_title as "jobTitle", u.phone, u.avatar_url as "avatarUrl",
  u.role, u.sees_all_departments as "seesAllDepartments", u.is_active as "isActive",
  app.iso(u.last_login_at) as "lastLoginAt", app.iso(u.created_at) as "createdAt",
  coalesce((
    select json_agg(json_build_object(
      'departmentId', d.id, 'departmentName', d.name, 'acronym', d.acronym, 'color', d.color,
      'isPrimary', m.is_primary, 'isManager', m.is_manager) order by m.is_primary desc, d.name)
    from department_members m join departments d on d.id = m.department_id
    where m.user_id = u.id
  ), '[]') as memberships`;

export function getUser(tx: Executor, id: string): Promise<UserDto | undefined> {
  return one<UserDto>(tx, sql`select ${USER_COLUMNS} from users u where u.id = ${id}`);
}

export function listUsers(tx: Executor, where: SQL, limit: number, offset: number) {
  return rows<UserDto & { total: number }>(
    tx,
    sql`select ${USER_COLUMNS}, count(*) over ()::int as total
        from users u where ${where}
        order by u.name limit ${limit} offset ${offset}`,
  );
}
