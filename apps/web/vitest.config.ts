import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Os testes de interface (Playwright) rodam à parte: npm run e2e.
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
