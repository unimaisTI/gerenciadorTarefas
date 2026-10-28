import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from './migrate';
import { seed } from './seed';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error('Defina DATABASE_ADMIN_URL no .env.');
  process.exit(1);
}

const command = process.argv[2];
if (command === 'migrate') {
  await runMigrations(url);
  console.log('Migrations aplicadas.');
} else if (command === 'seed') {
  await seed(url);
} else {
  console.error('Uso: cli.ts migrate | seed');
  process.exit(1);
}
