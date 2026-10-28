import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('../../.env')) process.loadEnvFile('../../.env');

// Migrations rodam como dono do schema (postgres); a API usa o papel hub_app.
// `generate` não conecta no banco, então a URL só é exigida no `migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_ADMIN_URL ?? '' },
  strict: true,
  verbose: true,
});
