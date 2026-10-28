import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export const MIGRATIONS_DIR = resolve(import.meta.dirname, '../migrations');

/** Aplica as migrations pendentes. Precisa da URL do dono do schema, não a do hub_app. */
export async function runMigrations(adminUrl: string): Promise<void> {
  const client = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await client.end();
  }
}
