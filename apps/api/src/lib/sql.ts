import type { SQL } from 'drizzle-orm';
import type { Executor } from '@hub/db';

// Leituras com SQL direto (joins e agregações). As colunas já vêm com alias camelCase,
// datas puras como ::text e instantes via app.iso(). Tudo roda sob RLS.

export async function rows<T>(tx: Executor, query: SQL): Promise<T[]> {
  const result = await tx.execute(query);
  return result as unknown as T[];
}

export async function one<T>(tx: Executor, query: SQL): Promise<T | undefined> {
  const [first] = await rows<T>(tx, query);
  return first;
}
