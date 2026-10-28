import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    // Os testes de integração compartilham o banco de teste: um arquivo por vez.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
