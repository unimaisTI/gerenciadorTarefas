# UniMais Hub — Requisitos do sistema

Oct 28, 2026 · @Yandra

## 1. Visão geral

O UniMais Hub é o sistema web interno da UNIMAIS para gestão de tarefas e chamados, no estilo Jira, para cerca de **62 colaboradores** divididos em departamentos (na fase de testes, apenas T.I e Controladoria; os demais entram depois). Cada departamento gerencia suas próprias atividades em quadros Kanban e abre **chamados** para outros departamentos, com um ciclo de execução e aprovação rastreado do início ao fim.

**Objetivos**

- Centralizar as demandas internas que hoje chegam por WhatsApp, e-mail e conversa de corredor.
- Dar visibilidade de quem está fazendo o quê, com prazos e responsáveis.
- Registrar o fluxo de solicitação → execução → aprovação entre departamentos.
- Gerar indicadores de volume, prazo e gargalos por departamento.

**Fora do escopo da primeira versão:** aplicativo mobile nativo (o sistema deve ser responsivo), controle de horas faturáveis, integração com sistemas acadêmicos e outros módulos (o Hub começa só com tarefas, chamados e dashboards).

**Stack sugerida**

| Camada | Tecnologia |
| --- | --- |
| Front-end | React + Vite + TypeScript (SPA) com React Router; arquivos estáticos na hospedagem compartilhada da DreamHost |
| Interface | UNIMAIS Design System (seção 15) sobre Tailwind CSS; shadcn/ui só para o que faltar; dnd-kit para arrastar cartões; FullCalendar para o calendário |
| Banco de dados | PostgreSQL hospedado no Supabase (com Auth, Realtime e Storage) |
| Back-end | Supabase: RLS, funções SQL (RPC), Edge Functions e pg\_cron; cliente supabase-js; migrations pelo Supabase CLI |
| Autenticação | Supabase Auth (e-mail/senha + Google corporativo) |
| Tempo real | Supabase Realtime (quadro e notificações ao vivo) |
| E-mails | Resend ou SMTP institucional, disparados por Edge Functions |
| Anexos | Links do Google Drive (fase 1) → Google Picker API (fase 2) |
| Validação | Zod no front-end e nas Edge Functions |

Convenção deste documento: **RF** = requisito funcional, **RNF** = requisito não funcional. Prioridade: **\[MVP\]** entra na primeira versão; **\[F2\]** e **\[F3\]** ficam para fases seguintes.

## 2. Perfis de acesso e permissões

O sistema tem quatro perfis. Cada usuário tem **um perfil** e pertence a **um ou mais departamentos**; as permissões valem dentro dos departamentos aos quais ele pertence.

| Perfil | Para quem | Resumo |
| --- | --- | --- |
| Administrador | Equipe de TI responsável pelo sistema | Acesso total: usuários, departamentos, configurações e todos os dados |
| Gestor | Coordenador/chefe de departamento | Gerencia o próprio departamento, distribui e aprova chamados |
| Colaborador | Funcionário comum | Cria e executa tarefas, abre e atende chamados |
| Observador | Diretoria, auditoria, estagiários | Somente leitura nos departamentos permitidos |

**Matriz de permissões \[MVP\]**

| Ação | Admin | Gestor | Colaborador | Observador |
| --- | --- | --- | --- | --- |
| Criar/editar/desativar usuários | Sim | Não | Não | Não |
| Criar/editar departamentos | Sim | Não | Não | Não |
| Adicionar membros ao próprio departamento | Sim | Sim | Não | Não |
| Criar projetos/quadros | Sim | Sim | Não | Não |
| Configurar colunas (buckets) do quadro | Sim | Sim | Não | Não |
| Criar e editar tarefas | Sim | Sim | Sim | Não |
| Excluir tarefas | Sim | Sim | Só as que criou | Não |
| Abrir chamado para outro departamento | Sim | Sim | Sim | Não |
| Atribuir chamado recebido a um executor | Sim | Sim | Não | Não |
| Aprovar ou devolver entrega de chamado | Sim | Sim | Só o solicitante | Não |
| Comentar | Sim | Sim | Sim | Não |
| Ver relatórios do departamento | Sim | Sim | Não | Sim |
| Ver relatórios de toda a instituição | Sim | Não | Não | Configurável |
| Ver log de auditoria | Sim | Não | Não | Não |

**Regras**

- RF-2.1 \[MVP\] As permissões devem ser verificadas **no back-end** (políticas RLS e funções SQL no Supabase), nunca apenas escondendo botões na tela.
- RF-2.2 \[MVP\] Um usuário só vê tarefas de departamentos dos quais é membro, além dos chamados em que é solicitante, executor ou aprovador.
- RF-2.3 \[F2\] Permitir permissões por projeto (ex.: um colaborador de Marketing convidado para um projeto específico da TI).
- RF-2.4 \[F2\] Tarefas marcadas como **confidenciais** ficam visíveis só para participantes e gestores.

## 3. Autenticação e login

- RF-3.1 \[MVP\] Tela de login com e-mail e senha.
- RF-3.2 \[MVP\] Não existe cadastro público: só o administrador cria contas (seção 4).
- RF-3.3 \[MVP\] No primeiro acesso, o usuário define a própria senha por um link enviado ao e-mail (o administrador nunca conhece a senha).
- RF-3.4 \[MVP\] Recuperação de senha por e-mail ("Esqueci minha senha").
- RF-3.5 \[MVP\] Senha com no mínimo 8 caracteres, letras e números; armazenada com hash (bcrypt/argon2 — o Supabase Auth já faz isso).
- RF-3.6 \[MVP\] Usuário desativado não consegue entrar e tem as sessões abertas encerradas.
- RF-3.7 \[MVP\] Bloqueio temporário após 5 tentativas erradas seguidas.
- RF-3.8 \[MVP\] Sessão expira após 12 horas de inatividade; opção "manter conectado".
- RF-3.9 \[F2\] Login com conta Google corporativa (somente o domínio da instituição).
- RF-3.10 \[F3\] Autenticação em dois fatores opcional para administradores e gestores.

## 4. Gestão de usuários e departamentos

**Usuários (tela do administrador)**

- RF-4.1 \[MVP\] Listar usuários com busca por nome/e-mail e filtros por departamento, perfil e situação (ativo/inativo).
- RF-4.2 \[MVP\] Criar usuário com: nome completo, e-mail, cargo, telefone/ramal (opcional), perfil, departamento(s) e foto (opcional). Ao salvar, o sistema envia o convite de primeiro acesso.
- RF-4.3 \[MVP\] Editar dados, perfil e departamentos de um usuário.
- RF-4.4 \[MVP\] Desativar usuário em vez de excluir, preservando histórico, tarefas e comentários. Ao desativar, o sistema lista as tarefas abertas dele para reatribuição.
- RF-4.5 \[MVP\] Reenviar convite e forçar redefinição de senha.
- RF-4.6 \[F2\] Importar usuários em lote por planilha CSV.
- RF-4.7 \[MVP\] Tela "Meu perfil": o próprio usuário altera foto, telefone, senha e preferências de notificação.

**Departamentos**

- RF-4.8 \[MVP\] Criar, editar e arquivar departamentos com: nome, sigla (ex.: TI, MKT), cor, descrição e gestor(es) responsável(eis).
- RF-4.9 \[MVP\] Um usuário pode pertencer a mais de um departamento; um deles é marcado como principal.
- RF-4.10 \[MVP\] O departamento define se **aceita chamados** de outros departamentos e quais **tipos de chamado** oferece (a lista de tipos ainda será parametrizada; no teste, cada departamento terá só o tipo genérico "Solicitação geral", e o cadastro de tipos deve permitir incluir os definitivos sem mudar código).
- RF-4.11 \[F2\] Cada tipo de chamado pode ter formulário próprio (campos extras) e prazo padrão (SLA).

## 5. Projetos e quadro Kanban (buckets)

Cada departamento tem um ou mais **projetos**, e cada projeto tem um **quadro** com colunas (buckets) por onde as tarefas passam, como no Jira.

**Projetos**

- RF-5.1 \[MVP\] Ao criar um departamento, o sistema cria automaticamente o projeto "Atividades de \<sigla>" e um quadro "Chamados recebidos".
- RF-5.2 \[MVP\] Gestores criam projetos com nome, chave curta (ex.: TI, MKT-EVT), descrição, datas de início/fim (opcionais) e membros.
- RF-5.3 \[MVP\] Cada tarefa recebe um código sequencial pela chave do projeto (ex.: TI-42, MKT-17).
- RF-5.4 \[MVP\] Arquivar projeto (some das listas, mas continua consultável).

**Quadro**

- RF-5.5 \[MVP\] Colunas padrão: **A fazer · Em andamento · Em revisão · Concluído**.
- RF-5.6 \[MVP\] Gestor pode criar, renomear, reordenar e excluir colunas; cada coluna é associada a uma categoria de status (a fazer / em andamento / concluído) para os relatórios funcionarem.
- RF-5.7 \[MVP\] Arrastar e soltar cartões entre colunas e dentro da coluna (ordem de prioridade).
- RF-5.8 \[MVP\] Cartão mostra: código, título, responsável (avatar), prioridade, prazo (vermelho se atrasado), etiquetas e contadores de comentários/anexos/subtarefas.
- RF-5.9 \[MVP\] Filtros no topo do quadro: responsável, prioridade, etiqueta, prazo (atrasadas, vencem esta semana) e busca por texto; botão "Só as minhas".
- RF-5.10 \[MVP\] Atualização em tempo real: se outra pessoa mover um cartão, o quadro de quem está olhando atualiza sozinho.
- RF-5.11 \[F2\] Limite de WIP por coluna (alerta quando passar de N cartões).
- RF-5.12 \[F2\] Raias (swimlanes) por responsável ou prioridade.

**Outras visões**

- RF-5.13 \[MVP\] Visão em **lista/tabela** com ordenação por colunas.
- RF-5.14 \[MVP\] Página **Minhas tarefas**: tudo atribuído ao usuário, de todos os projetos, agrupado por prazo.
- RF-5.15 \[MVP\] Visão **calendário** por prazo, por departamento e geral (seção 14).
- RF-5.16 \[F3\] Backlog e sprints (planejamento por ciclos de 1–2 semanas), se algum departamento precisar.

## 6. Tarefas

**Campos da tarefa \[MVP\]**

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| Código (ex.: TI-42) | Gerado automaticamente | Sim |
| Título | Texto curto (até 200 caracteres) | Sim |
| Descrição | Texto rico (negrito, listas, links, checklists) | Não |
| Projeto / coluna | Seleção | Sim |
| Responsável | Um usuário | Não |
| Participantes | Vários usuários (recebem notificações) | Não |
| Criado por | Automático | Sim |
| Prioridade | Baixa, Média, Alta, Urgente | Sim (padrão Média) |
| Prazo | Data (e hora opcional) | Não |
| Data de início | Data | Não |
| Etiquetas | Várias, por projeto, com cor | Não |
| Estimativa | Horas ou pontos | Não |
| Anexos | Links do Drive (seção 9) | Não |

**Ações**

- RF-6.1 \[MVP\] Criar tarefa pelo botão "+" em qualquer coluna (criação rápida só com título) ou pelo formulário completo.
- RF-6.2 \[MVP\] Abrir a tarefa em painel lateral/modal com todos os campos, comentários e histórico, sem sair do quadro.
- RF-6.3 \[MVP\] Cada tarefa tem URL própria para ser compartilhada (ex.: /tarefas/TI-42).
- RF-6.4 \[MVP\] **Subtarefas** com responsável e status próprios; o cartão-pai mostra o progresso (ex.: 3/5).
- RF-6.5 \[MVP\] **Checklist** simples dentro da descrição.
- RF-6.6 \[F2\] Vínculos entre tarefas: "bloqueia / é bloqueada por", "relacionada a", "duplicada de".
- RF-6.7 \[F2\] Tarefas recorrentes (ex.: "Backup mensal" criada todo dia 1º).
- RF-6.8 \[F2\] Modelos de tarefa por projeto.
- RF-6.9 \[MVP\] Duplicar e mover tarefa para outro projeto do mesmo departamento.
- RF-6.10 \[MVP\] Busca global (barra no topo) por código, título e descrição em tudo que o usuário pode ver.

## 7. Chamados entre departamentos

Um chamado é uma tarefa que um departamento (solicitante) pede a outro (executor). Ele só termina quando **quem pediu aprova a entrega**: o TI pede ao Marketing, o Marketing executa e devolve, o TI aprova, e o chamado volta ao Marketing marcado como aprovado.

&#91;embedded content: fluxo do chamado · 2 departamentos, 1 aprovação\]

Se o solicitante não aprovar, o chamado volta para execução com o motivo da devolução, quantas vezes for preciso.

**Abertura \[MVP\]**

- RF-7.1 Página **Abrir chamado**: o usuário escolhe o departamento de destino, o tipo de chamado, preenche título, descrição, prioridade, prazo desejado e anexos (links do Drive).
- RF-7.2 O chamado ganha código próprio (ex.: CH-128) e aparece em dois lugares: na coluna "Novos" do quadro **Chamados recebidos** do executor e na página **Meus chamados** do solicitante.
- RF-7.3 Ao abrir, o gestor (ou os triadores) do departamento de destino é notificado.

**Status do chamado \[MVP\]**

| Status | Quem age | O que acontece |
| --- | --- | --- |
| Aberto | Gestor do executor | Aguardando triagem |
| Em triagem | Gestor do executor | Avalia, pede informações ou recusa |
| Aguardando informações | Solicitante | Executor pediu dados; prazo pausado |
| Em execução | Executor | Responsável atribuído trabalhando |
| Aguardando aprovação | Solicitante | Executor marcou como entregue |
| Devolvido | Executor | Solicitante reprovou, com motivo obrigatório; volta a Em execução |
| Aprovado | — | Solicitante aprovou; executor é notificado |
| Recusado | — | Executor recusou na triagem, com motivo obrigatório |
| Cancelado | — | Solicitante desistiu antes da entrega |

**Regras do fluxo \[MVP\]**

- RF-7.4 Só o gestor do executor (ou admin) atribui o responsável; o responsável pode ser trocado depois.
- RF-7.5 Só o executor atribuído (ou seu gestor) marca **Entregue**, com um comentário de entrega obrigatório (o que foi feito, link do resultado).
- RF-7.6 Só o solicitante original, um gestor do departamento solicitante ou um aprovador indicado na abertura podem **Aprovar** ou **Devolver**.
- RF-7.7 **Devolver** exige motivo e conta uma rodada de revisão (o sistema mostra "2ª revisão" no cartão).
- RF-7.8 Aprovação automática opcional: se o solicitante não responder em N dias úteis (padrão 5), o chamado é aprovado automaticamente e todos são avisados. \[F2\]
- RF-7.9 Toda mudança de status gera notificação para o outro lado e entra no histórico.
- RF-7.10 Ao aprovar, o solicitante pode dar uma **avaliação** de 1 a 5 e um comentário. \[F2\]
- RF-7.11 Um chamado pode gerar subtarefas internas no departamento executor, sem que o solicitante veja os detalhes internos.
- RF-7.12 O solicitante pode reabrir um chamado aprovado em até 7 dias, voltando para Em execução. \[F2\]

**Telas \[MVP\]**

- **Meus chamados**: abas "Abertos por mim", "Aguardando minha aprovação" e "Encerrados".
- **Chamados recebidos** (quadro do executor): colunas Novos · Em triagem · Em execução · Aguardando aprovação · Encerrados.
- Na tela do chamado, uma **linha do tempo** mostra cada passo: quem abriu, quem atribuiu, entregas, devoluções e aprovação, com data e hora.

## 8. Comunicação, comentários e notificações

**Comentários \[MVP\]**

- RF-8.1 Comentários em tarefas e chamados, com texto rico, links e edição/exclusão pelo autor (fica marcado "editado").
- RF-8.2 **Menções** com @nome notificam a pessoa, mesmo de outro departamento.
- RF-8.3 Em chamados, comentários podem ser **públicos** (solicitante e executor veem) ou **internos** (só o departamento executor vê).
- RF-8.4 Reações rápidas com ícones (curtir, resolvido) em comentários, sem emoji. \[F2\]

**Notificações**

- RF-8.5 \[MVP\] Sino no topo com contador de não lidas, lista das notificações e "marcar todas como lidas"; clique leva à tarefa.
- RF-8.6 \[MVP\] Eventos que notificam: atribuição a mim, menção, comentário em tarefa que eu sigo, mudança de status de chamado meu, chamado aguardando minha aprovação, prazo vencendo em 24 h, tarefa atrasada.
- RF-8.7 \[MVP\] Notificações em tempo real no navegador (sem recarregar a página).
- RF-8.8 \[MVP\] E-mail para eventos importantes: novo chamado para o meu departamento, chamado aguardando minha aprovação, chamado devolvido ou aprovado.
- RF-8.9 \[F2\] Resumo diário por e-mail (tarefas do dia e atrasadas), configurável por usuário.
- RF-8.10 \[MVP\] Cada usuário escolhe, em "Meu perfil", quais eventos recebe por e-mail.
- RF-8.11 \[F3\] Notificação por WhatsApp (via integração existente da instituição) para chamados urgentes.
- RF-8.12 \[MVP\] Notificações lidas com mais de 90 dias são apagadas automaticamente.

## 9. Anexos via Google Drive

Os arquivos ficam no Google Drive da instituição; o sistema guarda apenas o link e os metadados.

- RF-9.1 \[MVP\] Em tarefas, chamados e comentários, botão "Adicionar link" que aceita URLs do Google Drive/Docs/Sheets/Slides, com nome de exibição opcional.
- RF-9.2 \[MVP\] Validar que o link é de um domínio Google (drive.google.com, docs.google.com) e mostrar ícone pelo tipo de arquivo.
- RF-9.3 \[MVP\] Aviso na tela: "Confira se o arquivo está compartilhado com o departamento".
- RF-9.4 \[F2\] Botão "Anexar do Drive" usando Google Picker API (escopo `drive.file`), salvando ID, nome, tipo, link e miniatura.
- RF-9.5 \[F2\] Orientação de uso: arquivos de chamados devem ficar em **Drives Compartilhados** por departamento, não no "Meu Drive" pessoal.
- RF-9.6 \[F3\] Upload direto de imagens pequenas (prints de erro, até 5 MB) para o storage do Supabase, para agilizar chamados de suporte.

## 10. Painéis, dashboards e SLA

**Página inicial (dashboard pessoal) \[MVP\]**

- RF-10.1 Ao entrar, o usuário vê: minhas tarefas de hoje, atrasadas, chamados aguardando minha aprovação e últimas notificações.

**Painel do departamento \[MVP para gestores\]**

- RF-10.2 Tarefas abertas por status e por responsável.
- RF-10.3 Tarefas atrasadas e que vencem nos próximos 7 dias.
- RF-10.4 Chamados recebidos × enviados no período.
- RF-10.5 Tempo médio de atendimento de chamados (abertura → aprovação) e média de devoluções por chamado.
- RF-10.6 Filtro por período (semana, mês, intervalo personalizado).

**Área de Dashboards — apresentação de métricas gerais \[MVP\]**

Uma página **Dashboards** no menu reúne os indicadores de toda a instituição, pensada para reuniões e para a diretoria. O painel do gestor acima mostra o dia a dia de um departamento; esta área mostra o quadro geral e pode ser projetada.

*Acesso e navegação*

- RF-10.7 Visível para admin, observadores autorizados (diretoria) e gestores; gestores veem a aba Geral e o próprio departamento em detalhe.
- RF-10.8 Quatro abas: **Geral** (instituição), **Por departamento**, **Chamados** (fluxo entre setores) e **Pessoas** (carga por responsável).
- RF-10.9 Filtros no topo, valendo para todos os gráficos: período (este mês por padrão; semana, mês anterior, trimestre, ano ou intervalo livre), departamento e projeto.
- RF-10.10 Cada indicador mostra a comparação com o período anterior (ex.: "+12% em relação a setembro").
- RF-10.11 Clicar num indicador ou numa barra abre a lista das tarefas ou chamados que formam aquele número.

*Indicadores*

| Indicador | Como se calcula | Visual |
| --- | --- | --- |
| Chamados abertos | Chamados com `submitted_at` no período | Cartão de número |
| Chamados aprovados | Chamados com `approved_at` no período | Cartão de número |
| Tempo médio de atendimento | Média de abertura → aprovação, em dias úteis, sem o tempo em "Aguardando informações" | Cartão + linha por semana |
| Aprovação na 1ª entrega | % de chamados aprovados sem nenhuma devolução | Cartão de número |
| Tarefas atrasadas agora | Prazo vencido e status fora de "concluído" | Cartão de número, em vermelho quando > 0 |
| Entregas no prazo | % de tarefas e chamados concluídos até o prazo, por departamento | Barras horizontais |
| Abertas × concluídas | Contagem por semana no período | Linha com duas séries |
| Chamados entre departamentos | Quem pede para quem (solicitante × executor) | Matriz com contagens |
| Pendências por status | Tarefas e chamados abertos em cada status | Barras horizontais |
| Carga por responsável | Itens abertos e com prazo no período, por pessoa | Barras horizontais |
| Tipos de chamado mais pedidos | Contagem por tipo (quando os tipos forem parametrizados) | Barras horizontais |
| Avaliação média dos chamados \[F2\] | Média das notas 1–5 | Cartão de número |

*Modo apresentação*

- RF-10.12 Botão **Apresentar**: tela cheia, sem menus, números e textos maiores, com a logo UNIMAIS no canto.
- RF-10.13 Opção de alternar sozinho entre as abas a cada N segundos (padrão 30), para TV ou reunião.
- RF-10.14 Rodapé com o período exibido e "Atualizado às HH:MM".

*Exportação e dados*

- RF-10.15 Exportar a aba atual em PDF (para levar à reunião ou enviar por e-mail).
- RF-10.16 \[F2\] Exportar os dados em CSV/Excel e agendar o envio do PDF mensal por e-mail para a diretoria.
- RF-10.17 Números calculados no banco (views ou funções SQL no Supabase), nunca carregando todas as tarefas no navegador; atualização a cada 5 minutos.
- RF-10.18 Visual pelo UNIMAIS Design System: `StatCard` para os números, `BarChart` para as barras; linha e matriz são componentes novos com os mesmos tokens e as cores de departamento da paleta (seção 15).

Na fase de testes, com só T.I e Controladoria, a matriz de chamados entre departamentos será 2 × 2; ela cresce sozinha conforme novos departamentos forem cadastrados.

**SLA \[F2\]**

- RF-10.19 Cada tipo de chamado tem prazo de primeira resposta e prazo de solução por prioridade.
- RF-10.20 O cartão mostra o tempo restante; alerta ao gestor quando faltar 20% do prazo e quando estourar.
- RF-10.21 O tempo em "Aguardando informações" não conta para o SLA.

## 11. Auditoria e histórico

- RF-11.1 \[MVP\] Cada tarefa e chamado tem aba **Histórico** com toda alteração: campo, valor antigo, valor novo, quem e quando (ex.: "Ana moveu de Em andamento para Em revisão — 28/10 14:32").
- RF-11.2 \[MVP\] Log de auditoria do sistema (só admin): logins, falhas de login, criação/edição/desativação de usuários, mudança de perfil e permissões, exclusões.
- RF-11.3 \[MVP\] Nada é apagado fisicamente: tarefas excluídas vão para uma **lixeira** por 30 dias, de onde gestor/admin podem restaurar.
- RF-11.4 \[F2\] Filtros e exportação do log de auditoria.

## 12. Requisitos não funcionais

| ID | Categoria | Requisito |
| --- | --- | --- |
| RNF-01 | Segurança | Row Level Security (RLS) em todas as tabelas e validação nas funções do banco e Edge Functions; o front-end nunca é a barreira de segurança, porque o código dele é público |
| RNF-02 | Segurança | HTTPS obrigatório; variáveis secretas só em variáveis de ambiente, nunca no repositório |
| RNF-03 | Segurança | Proteção contra XSS no texto rico (sanitização) e contra CSRF |
| RNF-04 | LGPD | Coletar só os dados pessoais necessários; admin pode exportar ou anonimizar dados de um usuário desligado |
| RNF-05 | Desempenho | Quadro com até 300 cartões carrega em menos de 2 s; ações de arrastar respondem na hora (atualização otimista) |
| RNF-06 | Capacidade | Suportar 62 usuários simultâneos com folga e crescer até \~200 sem mudança de arquitetura |
| RNF-07 | Disponibilidade | Backup diário automático do banco com retenção de 30 dias; restauração testada a cada trimestre |
| RNF-08 | Usabilidade | Interface em português do Brasil; datas no formato dd/mm/aaaa e fuso America/Sao\_Paulo |
| RNF-09 | Usabilidade | Layout responsivo (funciona no celular); tema claro e escuro |
| RNF-10 | Acessibilidade | Navegação por teclado, contraste adequado e rótulos para leitores de tela (WCAG 2.1 AA como meta) |
| RNF-11 | Manutenção | Código em TypeScript estrito, migrations versionadas, seed com dados de exemplo e README de instalação |
| RNF-12 | Qualidade | Testes automatizados para regras de permissão e para o fluxo de status do chamado; lint e checagem de tipos no CI |
| RNF-13 | Observabilidade | Registro de erros do servidor (ex.: Sentry) e logs de requisições |

**Hospedagem e implantação**

| ID | Requisito |
| --- | --- |
| RNF-H1 | Banco PostgreSQL, autenticação, tempo real e storage no **Supabase**, na região de São Paulo (sa-east-1) para menor latência |
| RNF-H2 | Aplicação React (build estático do Vite) na **DreamHost**, na hospedagem compartilhada; HTTPS pelo certificado gratuito do painel e regra no .htaccess que direciona todas as rotas para o index.html |
| RNF-H3 | A chave pública (`anon key`) do Supabase pode ir ao navegador; a chave `service_role` fica só nos segredos das Edge Functions do Supabase, nunca no build do front-end |
| RNF-H4 | Backup do banco pelo Supabase e um `pg_dump` semanal guardado fora dele (ex.: Drive da TI) |
| RNF-H5 | Deploy por script documentado no README (build do Vite e envio da pasta dist por SFTP ou GitHub Actions; migrations e Edge Functions pelo Supabase CLI); ambiente de testes separado do de produção |

A hospedagem compartilhada só serve arquivos; ela não mantém processos rodando. Por isso, tudo o que precisa acontecer sozinho fica no Supabase: avisos de prazo, aprovação automática de chamados, limpeza de notificações e resumo diário rodam com **pg\_cron**, e as ações que exigem a chave secreta (criar usuário, enviar convite e e-mails) ficam em **Edge Functions**.

## 13. Modelo de dados inicial

Ponto de partida para as migrations; o Claude Code pode ajustar nomes e tipos. Todas as tabelas têm `id` (UUID), `created_at` e `updated_at`.

| Tabela | Campos principais |
| --- | --- |
| users | name, email (único), job\_title, phone, avatar\_url, role (admin, gestor, colaborador, observador), is\_active, last\_login\_at |
| departments | name, acronym (único), color, description, accepts\_tickets, archived\_at |
| department\_members | user\_id, department\_id, is\_primary, is\_manager |
| ticket\_types | department\_id, name, description, default\_due\_days, is\_active |
| projects | department\_id, name, key (único), description, start\_date, end\_date, archived\_at |
| project\_members | project\_id, user\_id |
| board\_columns | project\_id, name, position, status\_category (todo, doing, done), wip\_limit |
| tasks | project\_id, column\_id, number (sequencial por projeto), title, description, priority, assignee\_id, reporter\_id, due\_date, start\_date, estimate, position, parent\_task\_id, is\_confidential, deleted\_at |
| task\_watchers | task\_id, user\_id |
| labels / task\_labels | project\_id, name, color / task\_id, label\_id |
| tickets | code (CH-n), task\_id (tarefa no quadro do executor), ticket\_type\_id, requester\_id, requester\_department\_id, target\_department\_id, approver\_id, status, revision\_count, submitted\_at, delivered\_at, approved\_at, rating, rating\_comment |
| ticket\_events | ticket\_id, actor\_id, from\_status, to\_status, note (motivo de devolução, recusa ou entrega) |
| comments | task\_id, author\_id, body, visibility (public, internal), edited\_at, deleted\_at |
| attachments | task\_id ou comment\_id, url, provider (gdrive, link), drive\_file\_id, name, mime\_type, added\_by |
| notifications | user\_id, type, task\_id, actor\_id, payload (JSON), read\_at |
| notification\_prefs | user\_id, event\_type, email\_enabled |
| activity\_log | entity\_type, entity\_id, actor\_id, action, changes (JSON com antes/depois) |
| audit\_log | actor\_id, action, target, ip, user\_agent |

**Decisões de modelagem**

- O chamado é uma tarefa (`tasks`) no quadro **Chamados recebidos** do executor, mais uma linha em `tickets` com os dados do fluxo; assim o executor usa o mesmo quadro Kanban, e o solicitante enxerga só o que é público.
- As transições de status do chamado ficam em uma **máquina de estados** única no banco, uma função SQL chamada pelo front-end (tabela da seção 7), que valida quem pode mover para onde e grava `ticket_events`.
- A ordem dos cartões usa um campo `position` fracionário (ou lexorank) para reordenar sem atualizar a coluna inteira.

## 14. Calendário de entregas

O sistema tem dois calendários no MVP: o **calendário do departamento**, com os prazos das tarefas e chamados daquele setor, e o **calendário geral**, que junta todos os departamentos que o usuário pode ver, cada um com a sua cor. Isto substitui o RF-5.15, que passa a ser MVP.

&#91;embedded content: esboço do calendário geral · visão Mês\]

Esboço de estrutura, não de cores finais: no sistema, as cores dos departamentos vêm da paleta da seção 15. A borda vermelha marca a tarefa atrasada; o cartão esmaecido e riscado já foi concluído; feriados ocupam uma faixa no topo do dia.

**O que aparece no calendário \[MVP\]**

| Item | Data usada | Como aparece |
| --- | --- | --- |
| Tarefa | Prazo (`due_date`); com data de início, vira uma barra do início ao prazo | Código + título, na cor do departamento |
| Chamado recebido | Prazo combinado pelo executor | Ícone de chamado + código CH-n |
| Chamado enviado | Prazo desejado pelo solicitante | Mesmo ícone, contorno tracejado (o departamento não executa) |
| Evento institucional | Data ou período cadastrado | Faixa no topo do dia (ex.: vestibular, semana acadêmica, feriado) |

**Calendário do departamento \[MVP\]**

- RF-14.1 Acessado pelo menu do departamento; mostra tarefas de todos os projetos do departamento, chamados recebidos e chamados enviados.
- RF-14.2 Visões **Mês**, **Semana** e **Agenda** (lista dia a dia); no celular abre em Agenda.
- RF-14.3 Filtros: projeto, responsável, prioridade, tipo (tarefa, chamado recebido, chamado enviado) e "Só as minhas".
- RF-14.4 Item atrasado aparece com marcação de perigo; item concluído ou aprovado aparece esmaecido e riscado.
- RF-14.5 Dia com mais itens do que cabem mostra "+N mais"; clicar abre a lista do dia.
- RF-14.6 Clicar num item abre o painel lateral da tarefa ou do chamado, sem sair do calendário.
- RF-14.7 Arrastar um item para outro dia altera o prazo, se o usuário puder editar a tarefa. Em chamado recebido, só o gestor pode, com motivo obrigatório; o solicitante é notificado e a mudança entra no histórico. Chamado enviado não pode ser arrastado.
- RF-14.8 Botão "+" no dia cria uma tarefa já com aquele prazo.

**Calendário geral \[MVP\]**

- RF-14.9 Mostra todos os departamentos que o usuário pode ver: admin e observadores autorizados veem todos; os demais veem os seus departamentos e os chamados de que participam.
- RF-14.10 Cada item usa a **cor do departamento** (campo `color` de `departments`); a legenda lista os departamentos e funciona como filtro (clicar liga e desliga).
- RF-14.11 Mesmas visões, filtros e regras de clique do calendário do departamento; arrastar segue as mesmas permissões.
- RF-14.12 Resumo no topo do período exibido: total de entregas, atrasadas e concluídas, por departamento.

**Eventos institucionais \[MVP\]**

- RF-14.13 Admin cadastra eventos gerais (aparecem em todos os calendários); gestores cadastram eventos do próprio departamento.
- RF-14.14 Feriados nacionais pré-carregados; feriados municipais e recessos cadastrados pelo admin.
- RF-14.15 Ao definir um prazo que cai em feriado ou fim de semana, o sistema avisa (sem bloquear).

**Fase 2**

- RF-14.16 \[F2\] Visão de **carga por pessoa**: quantas entregas cada responsável tem por semana, para o gestor equilibrar a distribuição.
- RF-14.17 \[F2\] Link de assinatura iCal (.ics) por usuário, departamento ou geral, para ver as entregas no Google Agenda (somente leitura).
- RF-14.18 \[F2\] Exportar o mês em PDF para imprimir ou levar a reuniões.

**Tabela nova:** `calendar_events` (title, description, department\_id — vazio = evento geral, start\_date, end\_date, all\_day, kind (evento, feriado, recesso), created\_by).

## 15. Identidade visual — UNIMAIS Design System

Toda a interface segue o [UNIMAIS Design System](https://claude.ai/artifact/7qWEei2uWYphbNqzKHSyzY), no padrão de **painel administrativo** que ele define (o mesmo do Sistema de Inventário da TI). Os tokens viram variáveis CSS e o tema do Tailwind; os componentes do design system são a base, e o shadcn/ui só entra para o que ele não tem.

**Estrutura da tela \[MVP\]**

- RNF-15.1 Barra lateral **navy #2b2f84** fixa à esquerda (248 px), com logo UNIMAIS branca no topo e o item ativo marcado por um filete vermelho de 3 px.
- RNF-15.2 Barra superior branca de 68 px com busca global, sino de notificações e avatar.
- RNF-15.3 Fundo da página `#f7f7f7`; conteúdo em cards brancos com raio de 20 px, borda 1 px `#e2e2e2` e sombra suave (as duas juntas).
- RNF-15.4 Tela de login sobre o gradiente navy da marca, com o card translúcido (vidro) que o design system reserva para o login.

**Cores \[MVP\]**

| Uso no sistema | Token | Valor |
| --- | --- | --- |
| Estrutura, títulos, botão principal | `navy-700` | #2b2f84 |
| Destaque único por tela (ação mais importante, item atrasado, menu ativo) | `red-500` | #e11d23 |
| Status concluído / aprovado | `success` | #1f9d6b |
| Prazo vencendo / aguardando aprovação | `warning` | #e0a112 |
| Atrasado / devolvido / recusado | `danger` | #e11d23 |
| Em andamento / informação | `info` | #5a5fc0 |
| Hover de linhas e fundo de item selecionado | `navy-050` | #eeeff9 |

- RNF-15.5 O vermelho é racionado: no máximo um elemento vermelho por tela além dos alertas de atraso.
- RNF-15.6 **Cores dos departamentos** (calendário geral, etiquetas, avatares de setor) saem de uma paleta fixa de 8 cores derivada das escalas navy e vermelha mais tons neutros e de status, testada para contraste; o admin escolhe da paleta, não por código hex livre.
- RNF-15.7 Cor nunca é o único sinal: status e prioridade sempre trazem texto ou ícone junto.

**Tipografia e ícones \[MVP\]**

- RNF-15.8 **Montserrat** (títulos) e **Poppins** (interface e texto), via Google Fonts, nos tamanhos da escala do design system (30/25/20/18/16/14/12 px no painel).
- RNF-15.9 Ícones **Lucide** de linha, 16 px, sempre com rótulo na navegação; botões só com ícone têm `aria-label`.
- RNF-15.10 **Sem emoji** em nenhuma parte do sistema, inclusive reações de comentário (usar ícones).

**Componentes do design system a reutilizar**

| Necessidade no gerenciador | Componente |
| --- | --- |
| Menu lateral e topo | `SidebarNav`, `TopBar` |
| Botões e ações | `Button` (pílula), `IconButton` |
| Status, prioridade, etiquetas | `Badge` |
| Cards do painel e indicadores | `Card`, `StatCard`, `BarChart` |
| Formulários (tarefa, chamado, usuário) | `Field`, `Input`, `Select`, `Checkbox`, `Switch` |
| Lista de usuários, visão em tabela | `DataTable`, `Pagination` |
| Confirmações, detalhes, avisos | `Modal`, `AlertBanner`, `EmptyState`, `LoadingScreen` |

**Componentes novos** (não existem no design system e devem seguir os mesmos tokens): cartão Kanban, coluna do quadro, painel lateral de tarefa, linha do tempo do chamado, calendário (mês, semana, agenda), seletor de pessoas com avatar e caixa de comentário com menções.

**Textos da interface**

- RNF-15.11 Português do Brasil, frases curtas; rótulos de campo são substantivos ("Prazo", "Responsável", "Departamento de destino"). Datas `28/10/2026`, números `1.284`.
- RNF-15.12 Status usam só as palavras definidas neste documento (seção 7 para chamados; colunas do quadro para tarefas).

## 16. Fases de entrega e uso no Claude Code

**Ordem sugerida de desenvolvimento (MVP)**

1. Configuração do projeto: React + Vite + TypeScript + React Router + Tailwind com os tokens e fontes do UNIMAIS Design System, conexão com Supabase, ORM, lint e estrutura de pastas.
2. Banco: migrations das tabelas da seção 13, políticas RLS e seed com os departamentos de teste T.I e Controladoria, 1 usuário de cada perfil, o tipo de chamado "Solicitação geral" em cada um e tarefas de exemplo.
3. Autenticação: login, primeiro acesso por convite, recuperação de senha, proteção das rotas.
4. Administração: CRUD de usuários e departamentos, vínculo de membros e gestores.
5. Projetos e quadro Kanban com arrastar e soltar, colunas configuráveis e filtros.
6. Tarefas: painel de detalhes, subtarefas, comentários, anexos por link e histórico.
7. Chamados: abertura, máquina de estados, telas "Meus chamados" e "Chamados recebidos", linha do tempo.
8. Notificações no sistema (tempo real) e por e-mail.
9. Dashboard pessoal, painel do departamento, área de Dashboards com modo apresentação e calendários de entregas (departamento e geral).
10. Testes das permissões e do fluxo de chamados, revisão de segurança e deploy (aplicação na DreamHost, banco no Supabase).

**Fase 2:** login Google, Google Picker, SLA, aprovação automática, avaliação, relatórios da instituição, exportação, recorrência, vínculos entre tarefas, carga por pessoa e assinatura iCal do calendário.

**Fase 3:** dois fatores, WhatsApp, upload de imagens, sprints.

**Como usar este documento no Claude Code**

Exporte este documento em Markdown e salve na raiz do repositório como `docs/REQUISITOS.md`. Depois, envie este prompt inicial:

```text
Leia docs/REQUISITOS.md. Vamos construir o MVP (itens marcados [MVP]) seguindo a
"Ordem sugerida de desenvolvimento" da seção 16, uma etapa por vez.

Antes de codar:
1. Crie um CLAUDE.md com a stack, convenções de código e comandos do projeto.
2. Proponha a estrutura de pastas e o schema do banco (seção 13) e espere minha aprovação.

Regras:
- TypeScript estrito; validação com Zod no front-end e nas Edge Functions.
- Permissões sempre garantidas por RLS e funções do banco, nunca só no front-end (seção 2 e RNF-01).
- Transições de status de chamado só pela máquina de estados (seção 7).
- Interface em português do Brasil, seguindo o UNIMAIS Design System (seção 15).
- Calendários de entregas conforme a seção 14.
- Arquitetura: SPA em React + Vite, sem servidor Node. O back-end é o Supabase (RLS, funções SQL, Edge Functions para ações com a chave secreta, pg_cron para tarefas agendadas). O build estático vai para a hospedagem compartilhada da DreamHost.
- Departamentos de teste: apenas T.I e Controladoria.
- Ao terminar cada etapa, rode lint, typecheck e testes, e me diga o que foi feito e o que falta.

Comece pela etapa 1.
```

**Pontos em aberto para decidir**

- [ ] Quem será o gestor de T.I e o de Controladoria no teste, e quais departamentos entram depois?
- [ ] Parametrizar os tipos de chamado de cada departamento (em definição).
- [ ] Confirmar o acesso SFTP/SSH ao plano compartilhado da DreamHost e qual subdomínio o UniMais Hub vai usar.
- [ ] Qual domínio de e-mail será usado no login Google e no envio de e-mails?
- [ ] Prazo para aprovação automática de chamados (proposta: 5 dias úteis).
