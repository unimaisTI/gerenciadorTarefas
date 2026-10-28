import { defineConfig } from 'tsup';

// Os pacotes @hub/* são TS puro: entram no bundle; o resto vem de node_modules.
export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: [/^@hub\//],
});
