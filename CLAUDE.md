# UniMais Hub

Sistema interno da UNIMAIS para tarefas (Kanban) e chamados entre departamentos.
Requisitos completos: `docs/REQUISITOS.md`. Construímos o MVP (itens `[MVP]`) na ordem da seção 16, uma etapa por vez.

> **Fase atual: só local, sem Supabase.** Postgres local (Docker com `npm run db:up` ou embutido com `npm run db:local`). As peças que o documento atribui ao Supabase são feitas pela própria aplicação (tabela abaixo). Destino final: VPS da DreamHost (Node + PM2 + Nginx), com o banco no Supabase como Postgres gerenciado.

## Arquitetura

- **Front-end** `apps/web`: SPA React 19 + Vite + TypeScript, React Router 7, TanStack Query, Tailwind CSS v4 com os tokens do UNIMAIS Design System, ícones Lucide. Ainda entram: dnd-kit (quadro), FullCalendar (calendários), Tiptap (texto rico) e shadcn/ui só para o que o design system não tem.
- **API** `apps/api`: Node 22+ com Fastify 5. Zod valida entrada e saída de toda rota (`fastify-type-provider-zod`). Build com tsup.
- **Banco** `packages/db`: PostgreSQL 16, Drizzle ORM (driver postgres.js) e migrations pelo drizzle-kit. Funções, triggers e políticas RLS ficam em migrations SQL customizadas (`drizzle-kit generate --custom`).
- **Compartilhado** `packages/shared`: schemas Zod, enums, rótulos em PT-BR, formatação de datas e números, matriz de permissões e transições do chamado. É usado pela API e pelo front.

| Necessidade | Agora (local) | Depois (produção) |
|---|---|---|
| Autenticação | Própria: senha com argon2id, sessão no banco (`sessions`), cookie httpOnly | Igual, ou Supabase Auth |
| Tempo real | Postgres `LISTEN/NOTIFY` → SSE na API | Igual, ou Supabase Realtime |
| Tarefas agendadas | Worker Node (processo separado) | Igual no PM2, ou pg_cron |
| E-mail | SMTP para o Mailpit (`http://localhost:8025`) | SMTP institucional ou Resend |

## Regras que não se negociam

1. **Permissões no servidor, sempre em duas camadas.** A rota checa a permissão na API, e a consulta roda sob RLS dentro de `withUser(db, userId, tx => ...)`. Esse helper abre uma transação e faz `set_config('app.user_id', ...)`; as políticas leem `app.current_user_id()`. A API conecta como `hub_app`, que não é dono das tabelas e não tem `BYPASSRLS`. Só migrations e seed usam o dono (`postgres`).
2. **RLS em todas as tabelas.** Uma tabela nova sem `enable row level security` e políticas para `hub_app` não passa no review. Não use `force row level security`: as funções `security definer` rodam como dono e precisam enxergar tudo. Helpers de permissão (`app.is_admin()`, `app.is_manager(dept)`, `app.can_view_task(id)`...) ficam em `packages/db/migrations/0001_security.sql`. Tabelas de credenciais/sessões/tokens/fila de e-mail não têm grant para `hub_app`: só as funções `app.auth_*`/`app.job_*` tocam nelas.
3. **Status de chamado só pela máquina de estados.** O único caminho é a função SQL `app.ticket_transition(ticket_id, to_status, note)`. Um trigger bloqueia `update` direto em `tickets.status`. `packages/shared/src/tickets/transitions.ts` espelha a tabela só para a UI e os testes, e um teste garante que os dois batem.
4. **Sem exclusão física** de tarefas e comentários: use `deleted_at`. A lixeira mostra 30 dias; depois disso o item sai da lixeira, mas continua no banco.
5. **Segredos só em `.env`.** Nunca faça commit dele; o `.env.example` documenta as chaves.

## Convenções de código

- TypeScript `strict` + `noUncheckedIndexedAccess`. Nada de `any`: use `unknown` e Zod para afunilar o tipo. O ESLint usa o `strictTypeChecked`.
- **Identificadores, tabelas e colunas em inglês** (`snake_case` no banco, `camelCase` no TS). **Todo texto visível em português do Brasil.** Rótulos de status, prioridade e perfil ficam em `packages/shared/src/labels.ts`, nunca soltos no componente.
- Códigos de enum seguem a seção 13 quando ela os define (`role`: `admin | gestor | colaborador | observador`; `status_category`: `todo | doing | done`). Os demais estão em `packages/shared/src/enums.ts`.
- Datas: `timestamptz` no banco; exibir com `formatDate`/`formatDateTime` de `@hub/shared` (`dd/mm/aaaa`, fuso America/Sao_Paulo). Números com `formatNumber` (`1.284`).
- Validação: o schema Zod de entrada fica em `packages/shared` e é reaproveitado no formulário e na rota.
- Erros da API: `{ error: { code, message } }`, com `message` em PT-BR para mostrar ao usuário. Lance `HttpError(status, code, message)`.
- Pacotes internos (`@hub/*`) são TS puro, consumidos pelo código-fonte (`exports: ./src/index.ts`).

### UI (UNIMAIS Design System, seção 15)

- Componentes em `apps/web/src/design-system/`, portados do design system. Use-os antes de criar outro.
- Tokens em `design-system/tokens.css` e no `@theme` de `index.css`. **A paleta padrão do Tailwind está desligada**: só existem as classes dos tokens (`bg-navy-700`, `text-muted`, `border-subtle`, `rounded-md`, `shadow-sm`, `font-title`, `text-h3`...). Não use hex solto.
- Cards: `rounded-md` (20px) com `border border-subtle` **e** `shadow-sm`.
- Vermelho (`red-500`/`accent`) no máximo uma vez por tela, além dos alertas de atraso. Cor nunca é o único sinal.
- **Sem emoji.** Ícones Lucide de 16px, `strokeWidth` 1.75. Botão só com ícone é sempre `IconButton` com `label`.
- Cores de departamento: chave da paleta (`DEPARTMENT_COLORS`) → `bg-dept-<chave>`.

## Estrutura

```
apps/web/src     app/ (rotas, layout, páginas) · design-system/ · features/ · lib/
apps/api/src     app.ts · server.ts · env.ts · plugins/ · modules/<área>/ · jobs/
packages/db      src/schema/ (Drizzle) · src/client.ts (createDb, withUser) · migrations/ · seed/
packages/shared  src/ enums, labels, format, errors (e depois permissions, tickets/)
docker/          init do Postgres (papel hub_app e banco de teste)
deploy/          nginx, PM2 e script de deploy (etapa 10)
docs/            REQUISITOS.md
```

## Comandos (na raiz)

```bash
cp .env.example .env
npm install
npm run db:up             # Postgres (5432) + Mailpit (1025/8025) no Docker
npm run db:local          # alternativa sem Docker: Postgres embutido (fica em primeiro plano)
npm run db:migrate        # aplica as migrations
npm run db:generate       # gera uma migration a partir do schema Drizzle
npm run db:check          # valida a sintaxe SQL e PL/pgSQL das migrations (sem banco)
npm run db:seed           # T.I e Controladoria, 1 usuário por perfil, tarefas de exemplo
npm run dev               # api (3001) + web (5173); o Vite faz proxy de /api
npm run lint
npm run typecheck
npm test                  # Vitest; sem banco de teste, os de integração ficam "skipped"
npm run build
npm run e2e -w @hub/web   # Playwright (precisa de npm run dev); capturas em apps/web/e2e/screens
```

**Ao terminar cada etapa:** rodar `npm run lint`, `npm run typecheck` e `npm test`, e relatar o que foi feito e o que falta.

## Testes

- Ficam ao lado do código (`*.test.ts[x]`). O Vitest roda os projetos `shared`, `db`, `api` e `web`.
- Os testes de integração usam o banco `unimais_hub_test` (`TEST_DATABASE_URL`) com o papel `hub_app`, o mesmo da API, para que o RLS valha nos testes.
- Obrigatório (RNF-12): testes de permissão por perfil e do fluxo completo do chamado.
- Recursos de gestão (automação, recorrência, SLA, imagens, vínculos, massa, e-mail): `apps/api/test/features.test.ts`.
- Interface: `apps/web/e2e` (Playwright, desktop e celular). Em inserts de teste use `app.position_after_last(coluna)` para a posição, nunca chave inventada.
- Automações, recorrência e SLA rodam no banco (`0004_features_security.sql`); a API só configura.

## Dados de teste

Departamentos: apenas **T.I** e **Controladoria**.
