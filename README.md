# UniMais Hub

Sistema interno da UNIMAIS para tarefas (quadros Kanban) e chamados entre departamentos.
Requisitos: [docs/REQUISITOS.md](docs/REQUISITOS.md). Convenções do código: [CLAUDE.md](CLAUDE.md).

## Requisitos

- Node.js 22 ou superior
- PostgreSQL 16, por um destes caminhos:
  - Docker Desktop (com WSL no Windows): `npm run db:up`
  - sem Docker: `npm run db:local` (Postgres embutido, dados em `.local/pg`)
  - um Postgres já instalado: rode `docker/postgres/init.sql` como superusuário

## Como rodar (local)

```bash
cp .env.example .env
npm install
npm run db:up          # ou: npm run db:local (deixe aberto num terminal)
npm run db:migrate     # tabelas, RLS, funções, feriados
npm run db:seed        # T.I e Controladoria, 1 usuário por perfil, tarefas e chamados de exemplo
npm run dev            # API (:3001), worker e interface (:5173)
```

Acesse http://localhost:5173. Usuários de teste (senha `Unimais2026`):

| Perfil | E-mail |
|---|---|
| Administrador geral (sem departamento) | admin@unimais.edu.br |
| Gestor (T.I) | gestor.ti@unimais.edu.br |
| Colaborador (T.I) | colaborador.ti@unimais.edu.br |
| Gestor (Controladoria) | gestor.controladoria@unimais.edu.br |
| Colaborador (Controladoria) | colaborador.controladoria@unimais.edu.br |
| Observador (diretoria) | observador@unimais.edu.br |

Com `EMAIL_TRANSPORT=log`, os e-mails (convites, redefinição de senha, avisos) aparecem no log da API e do worker. Com Docker, use `EMAIL_TRANSPORT=smtp` e veja-os no Mailpit: http://localhost:8025.

## Qualidade

```bash
npm run lint
npm run typecheck
npm run db:check     # sintaxe SQL e PL/pgSQL das migrations, sem banco
npm test             # testes de integração precisam do banco de teste (unimais_hub_test)
npm run e2e -w @hub/web   # testes de interface (Playwright); precisa de npm run dev no ar
npm run build
```

Sem banco acessível, os testes de integração (RLS, fluxo de chamados, API) aparecem como *skipped*. O CI do GitHub sobe um Postgres e roda todos.

## Recursos de gestão

- **Quadro:** edição rápida no cartão, raias, filtros salvos, backlog, épicos, vínculos ("bloqueia"), ações em massa na lista e no backlog.
- **Atalhos:** `/` busca, `c` cria tarefa, `b` alterna quadro/backlog, `f` filtros, `?` lista de atalhos.
- **Texto rico:** `@` menciona; prints colados ou arrastados viram imagem da tarefa (até 5 MB).
- **Configurar projeto:** colunas, épicos, modelos de tarefa, tarefas recorrentes e automações.
- **Chamados:** SLA por tipo de chamado (horas) com aviso aos 80% e ao estourar; abertura por e-mail (`INBOUND_MAILBOXES`).
- **Dashboards → Fluxo:** tempo médio por coluna, lead time, fluxo acumulado e % dentro do SLA.

## Arquitetura

| Pasta | Conteúdo |
|---|---|
| `apps/web` | Interface: React + Vite + Tailwind, UNIMAIS Design System |
| `apps/api` | API Fastify + Zod (`server.ts`) e worker de tarefas agendadas (`worker.ts`) |
| `packages/db` | Schema Drizzle, migrations SQL (RLS, máquina de estados, autenticação), seed |
| `packages/shared` | Enums, rótulos, validações, permissões e transições usados pela API e pela interface |
| `deploy` | Nginx, PM2 e script de deploy |

Segurança em duas camadas: a API checa permissões e valida com Zod; o banco aplica RLS em todas as tabelas, com o usuário da requisição em `app.user_id`. A API conecta como `hub_app`, que não é dono das tabelas e não ignora RLS. O status do chamado só muda pela função `app.ticket_transition`.

## Deploy (VPS DreamHost + banco no Supabase)

1. **Banco (Supabase, região sa-east-1).** Crie o projeto e, no SQL Editor, crie o papel da API:
   ```sql
   create role hub_app login password '<senha forte>' nobypassrls;
   ```
   No `.env` da VPS:
   - `DATABASE_ADMIN_URL`: conexão do usuário `postgres` do Supabase (para migrations).
   - `DATABASE_URL`: mesma conexão com o usuário `hub_app`, em **modo sessão** (porta 5432 do pooler ou conexão direta), porque o tempo real usa `LISTEN`.

   Rode `npm run db:migrate` e, só no ambiente de testes, `npm run db:seed`.
2. **VPS.** Instale Node 22, PM2 (`npm i -g pm2`) e Nginx; clone o repositório em `/var/www/unimais-hub`; crie o `.env` de produção (`NODE_ENV=production`, `COOKIE_SECURE=true`, `APP_URL=https://<subdomínio>`, `EMAIL_TRANSPORT=smtp` e os dados do SMTP institucional).
3. **Nginx + HTTPS.** Copie `deploy/nginx.conf`, ajuste o domínio e rode `certbot --nginx`.
4. **Publicar.** `./deploy/deploy.sh` (instala, verifica, migra, faz o build e reinicia API e worker no PM2). Depois, `pm2 startup` para subir com o servidor.
5. **Backup (RNF-H4).** O Supabase faz o backup diário; agende também um `pg_dump` semanal guardado fora dele.

Mantenha projetos Supabase e `.env` separados para testes e produção.
