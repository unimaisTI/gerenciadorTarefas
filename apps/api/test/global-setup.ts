import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '@hub/db/migrate';
import { seed } from '@hub/db/seed';

declare module 'vitest' {
  export interface ProvidedContext {
    dbAvailable: boolean;
    testDatabaseUrl: string;
  }
}

/**
 * Testes de integração usam o banco unimais_hub_test: recria o schema, aplica as migrations e o
 * seed. Sem banco acessível, os testes de integração são pulados (e aparecem como "skipped").
 */
export default async function setup(project: TestProject) {
  const envFile = resolve(import.meta.dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const appUrl = process.env.TEST_DATABASE_URL ?? 'postgres://hub_app:hub_app@localhost:5432/unimais_hub_test';
  const adminUrl =
    process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/unimais_hub_test';
  project.provide('testDatabaseUrl', appUrl);

  const admin = postgres(adminUrl, { max: 1, connect_timeout: 3, onnotice: () => undefined });
  try {
    await admin`select 1`;
  } catch {
    console.warn('\n[testes] Banco de teste indisponível: testes de integração serão pulados.\n');
    project.provide('dbAvailable', false);
    await admin.end({ timeout: 1 }).catch(() => undefined);
    return;
  }

  await admin.unsafe(`
    drop schema if exists app cascade;
    drop schema if exists drizzle cascade;
    drop schema public cascade;
    create schema public;
    grant usage on schema public to public;
  `);
  await admin.end();
  await runMigrations(adminUrl);
  await seed(adminUrl);
  project.provide('dbAvailable', true);
}
