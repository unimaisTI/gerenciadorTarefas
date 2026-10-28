/**
 * Postgres 16 local sem Docker (embedded-postgres). Os dados ficam em .local/pg.
 * Cria o papel hub_app e os bancos unimais_hub e unimais_hub_test (como docker/postgres/init.sql),
 * se ainda não existirem. Fica em primeiro plano; Ctrl+C para parar. Porta: PGPORT (padrão 5432).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';

const root = resolve(import.meta.dirname, '..');
const dataDir = resolve(root, '.local/pg');
const firstRun = !existsSync(resolve(dataDir, 'PG_VERSION'));
const port = Number(process.env.PGPORT ?? 5432);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-c', 'timezone=America/Sao_Paulo'],
});

if (firstRun) await pg.initialise();
await pg.start();

// Mesmo efeito de docker/postgres/init.sql, em passos idempotentes: retoma uma primeira
// execução interrompida. CREATE DATABASE não pode rodar dentro de transação, por isso um a um.
const admin = postgres(`postgres://postgres:postgres@localhost:${String(port)}/postgres`, { max: 1, onnotice: () => undefined });
const [role] = await admin<{ n: number }[]>`select count(*)::int as n from pg_roles where rolname = 'hub_app'`;
if (!role?.n) await admin.unsafe(`create role hub_app login password 'hub_app' nobypassrls`);
for (const db of ['unimais_hub', 'unimais_hub_test']) {
  const [found] = await admin<{ n: number }[]>`select count(*)::int as n from pg_database where datname = ${db}`;
  if (!found?.n) {
    await admin.unsafe(`create database ${db}`);
    console.log(`Banco criado: ${db}`);
  }
  await admin.unsafe(`grant connect on database ${db} to hub_app`);
}
await admin.end();

console.log(`Postgres no ar em localhost:${String(port)}. Ctrl+C para parar.`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
