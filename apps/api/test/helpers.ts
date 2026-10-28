import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { inject } from 'vitest';
import { createDb, withUser, type Database, type Transaction } from '@hub/db';
import { SEED_USERS } from '@hub/db/seed';
import type { Env } from '../src/env';

export const dbAvailable = inject('dbAvailable');

export type SeedUser = keyof typeof SEED_USERS;

export function testDb() {
  return createDb(inject('testDatabaseUrl'), { max: 4 });
}

const ids = new Map<string, string>();

export async function userId(db: Database, who: SeedUser): Promise<string> {
  const email = SEED_USERS[who].email;
  const cached = ids.get(email);
  if (cached) return cached;
  // Sem usuário na sessão a tabela users não é legível; a função de login resolve o id.
  const rows = (await db.execute(
    sql`select user_id as id from app.auth_get_login(${email})`,
  )) as unknown as { id: string }[];
  const result = rows[0]?.id;
  if (!result) throw new Error(`Usuário de seed ${who} não encontrado`);
  ids.set(email, result);
  return result;
}

export async function as<T>(db: Database, who: SeedUser, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withUser(db, await userId(db, who), fn);
}

export async function q<T>(tx: Transaction, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

/** Captura o erro do Postgres (mensagem em PT-BR) ou null se não houve erro. */
export async function pgError(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const e = error as { cause?: { message?: string }; message?: string };
    return e.cause?.message ?? e.message ?? 'erro';
  }
}

export const testEnv = {
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: 0,
  DATABASE_URL: 'postgres://unused',
  LOG_LEVEL: 'fatal',
  APP_URL: 'http://localhost:5173',
  COOKIE_SECURE: false,
  EMAIL_TRANSPORT: 'log',
  SMTP_HOST: 'localhost',
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  EMAIL_FROM: 'teste@unimais.edu.br',
  UPLOAD_DIR: join(tmpdir(), 'unimais-hub-test-uploads'),
  INBOUND_MAILBOXES: '[]',
} satisfies Env;
