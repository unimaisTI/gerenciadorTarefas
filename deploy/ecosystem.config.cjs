// PM2: API e worker de tarefas agendadas. Variáveis de ambiente vêm do .env da raiz
// (carregado com --env-file); nada de segredo neste arquivo (RNF-02).
module.exports = {
  apps: [
    {
      name: 'hub-api',
      cwd: __dirname + '/../apps/api',
      script: 'dist/server.js',
      node_args: '--env-file=../../.env --enable-source-maps',
      // Uma instância: o tempo real (SSE) mantém as conexões em memória.
      instances: 1,
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'hub-worker',
      cwd: __dirname + '/../apps/api',
      script: 'dist/worker.js',
      node_args: '--env-file=../../.env --enable-source-maps',
      instances: 1,
      max_memory_restart: '200M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
