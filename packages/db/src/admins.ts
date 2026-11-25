import postgres from 'postgres';

/** "maria.souza@x" → "Maria Souza" (o admin ajusta o nome depois, se quiser). */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Lê ADMIN_EMAILS ("a@x.br, b@x.br") e devolve os e-mails válidos, em minúsculas e sem repetição. */
export function parseAdminEmails(value: string | undefined): string[] {
  const emails = (value ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  return [...new Set(emails)];
}

/**
 * Garante os administradores gerais (perfil admin, acesso a todos os departamentos, ativos).
 * Quem não existe é criado sem senha: entra pelo Google ou pelo "Esqueci minha senha".
 * Roda como dono do schema, junto das migrations.
 */
export async function ensureAdmins(adminUrl: string, emails: string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const sql = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  try {
    const done: string[] = [];
    for (const email of emails) {
      await sql`
        insert into users (name, email, role, sees_all_departments, job_title)
        values (${nameFromEmail(email)}, ${email}, 'admin', true, 'Administração do sistema')
        on conflict ((lower(email))) do update
          set role = 'admin', sees_all_departments = true, is_active = true`;
      done.push(email);
    }
    return done;
  } finally {
    await sql.end();
  }
}
