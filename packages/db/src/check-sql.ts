import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, parsePlPgSQL } from '@libpg-query/parser';
import { MIGRATIONS_DIR } from './migrate';

/**
 * Valida a sintaxe das migrations com o parser real do Postgres, sem precisar de banco:
 * o SQL de cada arquivo e o corpo de cada função PL/pgSQL. Não substitui rodar as migrations
 * (não checa tipos nem nomes de coluna), mas pega erro de digitação antes do deploy.
 */
let failed = false;
for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replaceAll('--> statement-breakpoint', '');
  try {
    await parse(sql);
  } catch (error) {
    failed = true;
    console.error(`${file}: ${String(error)}`);
    continue;
  }
  const functions = [...sql.matchAll(/create function[\s\S]*?\$\$;/gi)]
    .map((m) => m[0])
    .filter((f) => /language plpgsql/i.test(f));
  for (const fn of functions) {
    try {
      await parsePlPgSQL(fn);
    } catch (error) {
      failed = true;
      console.error(`${file} (${/create function\s+([\w.]+)/i.exec(fn)?.[1] ?? '?'}): ${String(error)}`);
    }
  }
  console.log(`${file}: ok (${String(functions.length)} funções PL/pgSQL)`);
}
process.exit(failed ? 1 : 0);
