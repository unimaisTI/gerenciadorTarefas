import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

export interface DbClient {
  db: Database;
  close: () => Promise<void>;
}

export function createDb(url: string, options: { max?: number } = {}): DbClient {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => undefined });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

/**
 * Executa `fn` numa transação em nome do usuário. As políticas RLS leem
 * `app.current_user_id()`, que vem deste setting; `is_local = true` faz o valor
 * valer só dentro da transação, então ele nunca vaza para outra requisição do pool.
 */
export async function withUser<T>(
  db: Database,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
