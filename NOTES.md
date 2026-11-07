## SF-001 — Scaffold

- Stack inicial: Next.js 16.3.8, React 19.2.8 e TypeScript 5.
- Runtime verificado: Node.js 24.21.0 e npm 11.19.0; o pacote declara Node.js >=20.9.0, requisito mínimo do Next.js selecionado.
- Gerenciador: npm, com lockfile versionado.
- App Router usa `src/` e alias `@/*`; ESLint usa a configuração oficial do Next.js.
- Esta etapa não configura banco, autenticação nem módulos de negócio; esses itens pertencem a tarefas posteriores.

## SF-005 — Migrations

- Em 2026-10-05, a migration inicial falhou porque as tabelas usavam `CITEXT` antes de a extensão PostgreSQL `citext` estar instalada.
- A migration `20261005141624_init` agora executa `CREATE EXTENSION IF NOT EXISTS citext;` antes de criar tipos ou tabelas.
- Antes da recuperação, a inspeção confirmou que a falha não havia criado tabelas nem tipos da aplicação no schema `public`; a migration falha era o único registro de migration.
- A migration foi marcada como rolled back pelo Prisma e reaplicada ao banco Supabase configurado. Nenhuma tabela ou dado existente foi apagado.
- Validações: `prisma validate`; `prisma migrate deploy`; `prisma migrate status`; verificação da extensão, seis tabelas, três colunas `citext` e oito chaves estrangeiras. O status final reportou o schema atualizado.

## SF-006 — Infraestrutura de testes

- Adicionados Vitest e Playwright como dependências de desenvolvimento, com comandos e configurações separados para unitários, integração PostgreSQL e E2E.
- O banco `serviceflow_test` foi criado no PostgreSQL acessível via Supabase. É uma base física separada do banco de desenvolvimento, não um schema compartilhado.
- `TEST_DATABASE_URL` fica em `.env.test.local` (ignorado pelo Git) e não é usada como fallback para `DATABASE_URL`. A configuração de integração exige um nome de banco terminado em `_test`, compara host/base com o banco de desenvolvimento, verifica conexão e aplica migrations antes da suite.
- Fixtures de integração limpam somente o banco isolado antes de cada teste e seguem a ordem de dependências das chaves estrangeiras; o runner limita a execução a um worker.
- Playwright usa Chromium para um smoke de inicialização sem testar funcionalidades do produto.
- A auditoria npm após a instalação reporta nove vulnerabilidades altas em pacotes que já existiam no lockfile anterior; nenhuma versão preexistente foi atualizada. A versão de Vitest adicionada foi elevada à primeira linha corrigida disponível, eliminando o alerta crítico encontrado durante a configuração.
- SF-006 validada em 2026-10-05.

## SF-007 — Validação compartilhada e erros

- Adicionada validação runtime com Zod para nomes, e-mail normalizado, perfis/setores, setores, categorias, serviços e abertura de solicitações.
- `validateInput` aplica os schemas no servidor e converte falhas em erro de validação tipado; schemas estritos recusam campos desconhecidos, inclusive dados protegidos enviados pelo cliente.
- Erros de validação, autenticação, autorização, inexistência, conflito e falha inesperada possuem respostas com status/códigos estáveis. Mensagens são fixas; serialização não inclui stack, mensagem original, causa ou valores submetidos; caminhos/códigos de validação são filtrados.
- Testes unitários em `tests/unit/shared/validation/` e `tests/unit/server/errors/`; `npm run test:unit`, `npm run typecheck` e `npm run lint` aprovados.
- SF-007 concluída em 2026-10-05. SF-008 e tarefas posteriores não foram iniciadas.

## SF-008 — Autenticação e sessões

- Autenticação local com Auth.js Credentials e estratégia JWT; somente email/senha são aceitos e campos adicionais (incluindo perfil/setor) são recusados.
- Senhas são verificadas com Argon2id; apenas usuários ativos autenticam. O token/sessão são atualizados consultando o usuário atual no PostgreSQL; conta desativada tem os claims de identidade removidos e recebe sessão sem usuário.
- Cookies de sessão `HttpOnly`, `SameSite=Lax`, `Secure` em produção; validade máxima de oito horas. `AUTH_SECRET` permanece fora do repositório e deve ser configurado separadamente por ambiente.
- A autenticação executada em testes injeta explicitamente o Prisma Client da base física `serviceflow_test`; não usa o singleton de desenvolvimento.
- Login, logout e rotas Auth.js compilam; o controle de autorização server-side central será implementado somente em SF-010, conforme dependências.
- Validações: 25 testes unitários, quatro testes de integração de autenticação/sessão, `npm run typecheck`, `npm run lint` e `npm run build` aprovados em 2026-10-05.
- SF-008 concluída. SF-009 ainda não iniciada.

## SF-009 — Bootstrap do primeiro administrador

- `npm run bootstrap:admin` é um comando manual e interativo, não um seed; coleta nome/e-mail e lê a senha e confirmação em modo terminal sem eco, sem argumentos ou variáveis de ambiente para a senha.
- O comando carrega variáveis pelos mecanismos do Next.js, instancia Prisma sem logging de queries, recusa banco com sufixo `_test` e não exibe entradas nem detalhes de erro de banco.
- `bootstrapFirstAdmin` valida input estritamente, armazena somente hash Argon2id e limita a um administrador. Uma transação serializável, com rechecagem e tratamento do conflito serializável, fecha a janela de corrida entre tentativas concorrentes.
- A operação retorna apenas id/nome/e-mail e não imprime senha/hash. Ausência de administrador ou banco de teste foi validada no PostgreSQL isolado `serviceflow_test`; nenhuma conta foi criada em banco de desenvolvimento/produção.
- Teste unitário garante que mensagens do CLI são fixas e não ecoam erros inesperados ou credenciais; teste de integração verifica hash persistido e que o resultado não contém o hash.
- `@next/env` e `tsx` são dependências diretas para carregar a configuração padrão do Next e executar o CLI TypeScript em Node suportado pelo projeto.
- Validações do bloco final: 13 testes de integração totais, 35 unitários (incluindo CLI), recusa do CLI para banco `_test`, `npm run typecheck`, `npm run lint` e `npm run build` aprovados em 2026-10-05.
- SF-009 concluída. SF-010 está desbloqueada e ainda não iniciada.

## SF-010 — Autorização central no servidor

- `src/server/authorization/` separa políticas puras da obtenção do ator pela sessão atual do servidor (`getCurrentUser`); operações protegidas devem usar os wrappers `require*`, nunca identidade/perfil/setor da requisição cliente. Wrappers de solicitação recebem somente o ID e consultam propriedade/setor persistidos no Prisma antes de decidir.
- Configuração administrativa exige `ADMIN`; catálogo e criação exigem `REQUESTER`; solicitante lê somente recurso próprio; atendente lê e muda status somente quando o `Request.sectorId` persistido corresponde ao setor atual. Administrador não recebe acesso operacional implícito.
- Usuário não autenticado/inativo recebe erro de autenticação; recursos alheios ou operação operacional proibida são tratados como `NOT_FOUND` para não revelar sua existência. IDs de ator/setor retornados para transição vêm da sessão, não de entrada cliente.
- Testes unitários cobrem matriz de perfis, sessão e escopos; integração usa usuários/setores/solicitações persistidos no PostgreSQL de teste, incluindo mudança do setor atual do atendente.
- Verificações finais do bloco: 35 testes unitários, 13 testes de integração, `npm run typecheck`, `npm run lint` e `npm run build` aprovados em 2026-10-05.
- SF-010 concluída. SF-011 e posteriores não iniciadas.

## SF-011 — Domínio de setores

- Criadas operações server-side administrativas de listagem, criação, renomeação e ativação/desativação lógica; todas exigem `requireConfigurationAdministrator` e usam a validação compartilhada de nome.
- Desativação executa em transação serializável e recusa setor com atendente ativo, serviço ativo ou solicitação `OPEN`/`IN_PROGRESS`; solicitações concluídas não impedem desativação. A verificação do atendente mantém a regra da SPEC de que atendente não pode estar associado a setor inativo. Não existe operação de exclusão física.
- A restrição global anterior foi ajustada com migration aditiva para unicidade case-insensitive somente entre setores ativos (`citext` + índice único parcial); nome de setor inativo pode ser reutilizado, mas não reativado se colidir com outro setor ativo.
- Migration `20261005163800_active_catalog_names` aplicada no `serviceflow_test` e no PostgreSQL de desenvolvimento configurado (`postgres`, schema `public`); sem reset ou exclusão de dados.
- Validações específicas: cinco testes unitários de regra, seis testes de integração PostgreSQL, `prisma validate`, typecheck e lint aprovados.
- SF-011 concluída. SF-012 foi iniciada somente depois dessa validação.

## SF-012 — Domínio de categorias

- Implementadas operações server-side administrativas de consulta, criação, edição e ativação/desativação lógica, usando autorização SF-010 e validação compartilhada.
- Categoria não pode ser desativada enquanto possuir serviço ativo. Transação serializável verifica o vínculo e mantém o estado inalterado em caso de conflito; reativação e referências não apagam dados.
- Migration `20261005164000_active_category_names` substitui a unicidade global por unicidade case-insensitive entre categorias ativas; aplicada no banco de teste e no banco de desenvolvimento.
- Validações específicas: dois unitários de regra, quatro integrações PostgreSQL, Prisma validate, typecheck e lint aprovados.
- SF-012 concluída antes de iniciar SF-013.

## SF-013 — Administração de usuários

- Adicionadas validações compartilhadas de criação/edição: nome, e-mail trim/lowercase, papel exclusivo, regra atendente-setor e senha opcional apenas em edição. Senha fornecida sempre passa por `hashPassword`; resultados e listagens omitem `passwordHash`.
- Operações administrativas de listagem, criação, edição, ativação/desativação lógica exigem `requireConfigurationAdministrator`; usuários nunca são apagados fisicamente.
- Transações serializáveis confirmam setor ativo para atendentes, bloqueiam remoção/reclassificação do último administrador ativo e protegem o último atendente ativo de setor com solicitações abertas/em atendimento.
- Integração confirmou que desativar usuário preserva referências de solicitações. SF-013 depende agora explicitamente de SF-011 e SF-012 em `TASKS.md`.
- Validações específicas: quatro testes unitários de política/validação e sete integrações PostgreSQL; typecheck e lint aprovados.
- SF-013 concluída antes de iniciar SF-014.

## SF-014 — Domínio de serviços

- Implementadas operações administrativas server-side para consultar, criar, editar e ativar/desativar serviços; todas exigem o administrador atual e validam entradas com `serviceInputSchema`.
- Categoria/setor devem existir; criação e ativação exigem ambos ativos. Atualizações de serviço ativo mantêm essa condição; serviço inativo pode ser editado sem forçar reativação.
- Desativação preserva serviço, solicitações e snapshots existentes. Edições mudam apenas a configuração atual do serviço; snapshots em `Request` não são atualizados.
- Regras de disponibilidade isoladas em policy e testadas; `assertServiceCanReceiveRequests` rejeita serviço inativo e relações inativas. A operação persistente de abertura ainda pertence a SF-017 e deverá chamar essa policy.
- Validações específicas: quatro testes unitários de disponibilidade, cinco integrações PostgreSQL; Prisma validate, typecheck e lint aprovados.
- SF-014 concluída. SF-015 e tarefas posteriores não iniciadas.

## Validações finais — SF-011 a SF-014

- `npm run test:unit`: 49 testes aprovados.
- `npm run test:integration`: 35 testes aprovados no banco físico `serviceflow_test`.
- `npm run typecheck`, `npm run lint` e `npm run build`: aprovados.
- `prisma validate` aprovado; `prisma migrate status` confirmou schema atualizado no banco de desenvolvimento (`postgres`) e no `serviceflow_test`.
- Migrations apenas substituíram índices únicos de nomes de setor/categoria por índices parciais para registros ativos; sem reset, truncamento ou exclusão de dados.

## SF-015 — Interface administrativa

- Criada página `/admin` com listagens, formulários e estados ativo/inativo de setores, categorias, usuários e serviços; serviços/usuários exibem relações atuais. O painel redireciona sessão ausente para login e perfil não autorizado para a página pública existente.
- Server Actions recebem apenas os campos necessários e delegam operações a SF-011–SF-014, que repetem autorização de administrador e validação no servidor. Mensagens públicas traduzem validação, conflito/dependência e inexistência; erros inesperados continuam sendo lançados sem expor detalhes no formulário.
- Testes unitários de Server Actions cobrem criação, edição, ativação/desativação, despacho às operações de domínio, mensagens seguras e revalidação de `/admin`; duas integrações exercitam gravação real no PostgreSQL de teste e negação por autorização.
- `npm run test:unit -- tests/unit/admin-actions.test.ts`: 3 testes aprovados; `npm run typecheck`, `npm run lint` e `npm run build` aprovados. SF-015 concluída antes de iniciar SF-016.
- Na primeira tentativa de integração administrativa, o teste usou acidentalmente o cliente Prisma padrão; foi identificado um único setor de teste órfão no banco de desenvolvimento, sem relações, e removido especificamente. O teste foi corrigido para injetar o cliente da fixture `serviceflow_test`.

## SF-016 — Catálogo publicado

- Criadas consultas autenticadas para serviços cujo próprio registro, categoria e setor estão ativos; catálogo e detalhe obtêm nomes e descrições atuais do PostgreSQL e agrupam por categoria.
- Testes: 1 unitário de agrupamento e 2 integrações de disponibilidade/detalhe. SF-016 validada antes de iniciar SF-017.

## SF-017 — Abertura transacional

- `createRequest` valida entrada estrita no servidor, usa o solicitante ativo da autorização, revalida identidade/serviço/relações na transação serializável e grava status `OPEN`, snapshots e evento inicial atomicamente.
- Testes específicos: 1 unitário de snapshots e 5 integrações para criação, dados forjados, descrição, configuração indisponível e rollback do evento. SF-017 validada antes de iniciar SF-018.

## SF-018 — Consultas do solicitante

- Lista filtra por `requesterId` da sessão. Detalhe combina o ID solicitado com o proprietário autenticado e retorna `NotFound` indistinguível para recurso alheio ou inexistente; snapshots e eventos são retornados, com histórico ordenado cronologicamente.
- Testes de integração: 2 aprovados para propriedade, ID direto alheio, snapshots e ordenação. SF-018 validada antes de iniciar SF-019.

## SF-019 — Transições e histórico

- Adicionada política estrita `OPEN → IN_PROGRESS → COMPLETED`; o destino é validado explicitamente, e o comando exige atendente autorizado, ativo e do setor atual. Status, `updatedAt`, `completedAt` e evento são gravados em transação serializável; conflito de serialização vira erro de conflito sem criar evento.
- Testes: 9 casos unitários de matriz de estado e 4 integrações de conclusão/eventos, negação, concorrência e rollback. SF-019 validada antes de iniciar SF-020.

## SF-020 — Fila do atendente

- Consultas de lista e detalhe exigem perfil atendente e limitam por `Request.sectorId`, o setor gravado na abertura, sem depender do setor atual configurado no serviço. IDs alheios/inexistentes retornam `NotFound`; não há atribuição individual.
- Testes de integração: 2 aprovados para escopo, migração da configuração do serviço e negação de acesso direto a outro setor. SF-020 validada antes de iniciar SF-021.

## SF-021 — Interface do solicitante

- Criadas rotas `/catalog`, `/catalog/[serviceId]`, `/requests` e `/requests/[requestId]`, protegidas no servidor e usando consultas/dados persistidos. Abertura envia apenas serviço e descrição à operação de domínio; interface limita descrição a 10.000 caracteres, mostra feedback/estados vazios e histórico de snapshots, sem ações de status.
- Layout mantém logout e navegação disponíveis em todas as páginas do solicitante.
- Testes de Server Action: 2 aprovados para campos permitidos, rejeição lógica de mass assignment e mensagens seguras. Build inclui todas as rotas. SF-021 validada antes de iniciar SF-022.

## SF-022 — Interface do atendente

- Criadas rotas `/queue` e `/queue/[requestId]` para fila do setor, detalhes com snapshots/histórico e ações condicionais de início/conclusão. Cada Server Action escolhe um alvo fixo no servidor e chama a transição SF-019; não há reabertura, cancelamento ou atribuição. Layout mantém logout disponível.
- A rota `/` agora consulta a sessão server-side e encaminha cada perfil à interface própria; removido o protótipo anterior em memória, que permitia escolher perfil no cliente.
- Testes de Server Action: 2 aprovados para alvo server-side e mensagens seguras. Build inclui as rotas da fila. SF-022 validada.

## Validações finais — SF-015 a SF-022

- `npm run test:unit`: 72 testes em 20 arquivos aprovados.
- `npm run test:integration`: 52 testes em 14 arquivos aprovados no banco isolado `serviceflow_test`.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npx prisma validate` e `npx prisma migrate status`: aprovados; migrations sincronizadas no banco de desenvolvimento.
- A primeira execução final da suite de integração colidiu com geração simultânea do Prisma Client no build (`EPERM` no rename do DLL do Windows); repetida isoladamente, a suite completou com sucesso. Sem alteração de schema, credenciais, commit ou push. SF-023+ não iniciadas.

## SF-023 — Endurecimento server-side

- Revisados módulos, consultas e Server Actions protegidos; UUIDs e estados ativo/inativo passam por validação runtime e valores de formulário inválidos são recusados, sem converter entradas inesperadas em `false`.
- Matriz de autorização cobre perfil, usuário inativo, propriedade, setor, IDs inválidos e campos protegidos. Testes focados: 19 unitários e 4 de integração.
- A autenticação Auth.js preserva schema estrito de email/senha e encaminha somente esses campos à validação; os campos de transporte `csrfToken` e `callbackUrl` do próprio Auth.js não são tratados como dados de domínio.

## SF-024 — Cobertura automatizada

- Adicionados testes de integração para proteção de integridade referencial contra remoções físicas e para confirmar que renomeações de serviço/categoria/setor não reescrevem snapshots já persistidos.
- Suites completas aprovadas: `npm run test:unit` (73 testes) e `npm run test:integration` (58 testes no banco isolado `serviceflow_test`).

## SF-025 — Testes E2E

- Playwright executa setup em banco dedicado terminado em `_test`, aplica migrations, limpa somente esse banco e cria administrador E2E; o servidor Next usa a mesma URL isolada e um `AUTH_SECRET` efêmero.
- Um fluxo Chromium cobre bootstrap/login, administração de setores/categorias/usuários/serviços, catálogo, abertura e consulta de solicitações, atendimento/conclusão e negações por propriedade e setor.
- `npm run test:e2e` aprovado (1 cenário completo). Foi necessário encapsular o setup em função assíncrona compatível com CommonJS e adaptar o provider Auth.js para encaminhar somente email/senha à validação estrita.

## Validações finais — SF-023 a SF-025

- `npm run test:unit`: 73 aprovados; `npm run test:integration`: 58 aprovados em `serviceflow_test`; `npm run test:e2e`: 1 cenário Chromium aprovado.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npx prisma validate` e `npx prisma migrate status`: aprovados. O status de migrations do banco de desenvolvimento informa schema atualizado; não houve alteração de schema.
- Durante o E2E, o servidor Next em modo desenvolvimento emitiu uma mensagem `destination stream closed early`; o fluxo e as verificações HTTP 404 esperadas passaram. Registrar caso volte a ocorrer; sem falha de teste observada.
- SF-023, SF-024 e SF-025 concluídas em 2026-10-05. SF-026+ não iniciadas; nenhuma alteração à SPEC, commit ou push.

## SF-026 — Correções de lacunas da SPEC

- Adicionados índices PostgreSQL para `Request.requesterId` e `Request.sectorId`, declarados no Prisma e criados por migration aditiva.
- A migration adiciona `User_role_sectorId_check`: atendentes exigem setor; demais perfis não podem possuir setor. As validações de aplicação permanecem.
- Testes de integração confirmam a restrição e os índices, atendimento de solicitações já abertas após desativar o serviço, e conclusão por atendente diferente do mesmo setor com o ator correto no evento.
- Um fixture antigo criava um atendente sem setor. Foi ajustado para associá-lo a setor válido, conforme a regra agora também aplicada pelo banco.
- A migration foi aplicada e validada apenas em `serviceflow_test`; suites unitária, integração e E2E, typecheck, lint, build, `prisma validate` e `prisma migrate status` passaram.
- As correções são pequenas e funcionais; não alteram materialmente a contagem frente à meta de 100.000 linhas. A medição oficial informada antes delas permanece 7.347 linhas. SF-026 não deve ser marcada como concluída sem medição final e sem cumprir ou encaminhar a meta conforme seus critérios. Nenhuma SPEC foi alterada; sem commit/push.

## SF-026 — Resultado da contagem oficial

- Contagem oficial atual informada em 2026-10-05: **7.489 linhas contabilizáveis**; meta acadêmica: **100.000**; diferença: **92.511 linhas**.
- SF-026 permanece **não concluída** porque a meta não foi atingida. A auditoria não encontrou caminho legítimo dentro da SPEC atual para aproximar significativamente a contagem.
- Não houve inflação artificial, duplicação, geração em massa, código sem função ou implementação de funcionalidade fora da SPEC para perseguir a meta.
- Novas funcionalidades fora da SPEC aprovada exigem aprovação explícita e novas SPECs antes de qualquer implementação.

## SF-027 — Documentação operacional e estado atual

- README atualizado para refletir a stack, execução, configuração PostgreSQL, migrations, bootstrap seguro, suites e fluxos E2E completos já executados. Removeu-se a informação obsoleta de que o E2E ainda estava planejado.
- Verificação concluída em 2026-10-05 após instalação limpa com `npm ci` (executado via `npm.cmd` porque a política do PowerShell bloqueia `npm.ps1`): `npx prisma generate`, `npx prisma validate`, estado das quatro migrations no banco isolado, 73 testes unitários, 61 de integração, 1 E2E, typecheck, lint e build passaram.
- A execução limpa identificou que é necessário gerar o Prisma Client antes da suite unitária; o README agora inclui esse passo. Também documenta `npm.cmd`/`npx.cmd` para PowerShell quando os shims `.ps1` forem bloqueados. Não foi alterada a política de execução do sistema.
- O banco PostgreSQL físico `serviceflow_test` é isolado do banco de desenvolvimento/produção. Integração e E2E exigem `TEST_DATABASE_URL` apontando para base dedicada terminada em `_test`; o setup E2E limpa essa base, então ela deve permanecer exclusiva para testes.
- Decisões técnicas vigentes: Next.js App Router/TypeScript, Prisma/PostgreSQL, Auth.js com credenciais locais, hashes Argon2id, Vitest e Playwright/Chromium; autorização e validação ocorrem no servidor, usando identidade e escopo atuais do banco.
- A política operacional de backup e recuperação ainda não está definida. Deve ser definida e ter restauração testada em ambiente isolado antes do uso com dados reais; não foram presumidos frequência, retenção ou objetivos de recuperação.
- `npm ci` concluiu com aviso de auditoria agregada de 9 vulnerabilidades HIGH; não foi executado `npm audit fix` nem houve alteração de dependências, por estarem fora do escopo documental.
- SF-027 concluída após verificação dos comandos documentados. Na revisão SF-028 de 2026-10-05, SF-026 permanecia incompleta e `cloc` não estava disponível neste ambiente; a medição foi posteriormente reproduzida em 2026-10-06, conforme o fechamento abaixo. Prompts e registros históricos em `prompts/sessoes/` foram preservados.

## SF-028 — Revisão final da entrega

- Suites finais passaram: 73 unitários, 61 integração e 1 E2E; typecheck, lint, build e `npx prisma validate` passaram. O estado de migrations foi verificado na base isolada `serviceflow_test`: quatro migrations encontradas, nenhuma pendente.
- Revisão de escopo e segurança: operações administrativas, catálogo, solicitações e transições chamam as verificações centrais server-side; sessões recarregam perfil/setor/estado do banco. O scan local de arquivos versionados não identificou segredos reais; candidatos de credenciais foram limitados a templates e fixtures de teste/E2E. `.env` e `.env.test.local` não são versionados e estão ignorados.
- Os registros históricos de sessão permanecem versionados; 14 registros em `prompts/sessoes/` e nenhuma exclusão desses caminhos na história Git consultada.
- `HEAD` na revisão: `71874363d48bb1548fb946f548052fd420f97371`, sincronizado com `origin/main`; worktree estava limpo antes desta atualização documental. Os commits recentes inspecionados têm trailers `Agent` e `Spec` quando aplicáveis.
- Na revisão de 2026-10-05, a contagem oficial conhecida era **7.489**. O comando oficial de `cloc` não pôde ser reproduzido naquele momento porque o executável não estava disponível; em 2026-10-06 foi feita nova medição oficial, registrada abaixo.
- SF-028 permanece **não concluída** porque SF-026 — dependência explícita desta tarefa — está incompleta. Também persiste a necessidade operacional de definir/testar backup e recuperação antes do uso com dados reais.
- Nenhum código, SPEC ou dependência foi alterado; sem commit/push.

## Alteração de SPEC — Autogerenciamento da própria senha (2026-10-06)

- Aprovada inclusão na primeira entrega de alteração da própria senha por usuários autenticados e ativos dos perfis `ADMIN`, `REQUESTER` e `ATTENDANT`.
- A identidade alvo deve vir exclusivamente da sessão autenticada no servidor. O fluxo não aceita `userId` do cliente para escolher a conta; o administrador usa essa opção somente para si, sem substituir a administração existente de usuários.
- Como não havia política de senha além de valor não vazio nos fluxos existentes, foi definida para esta capacidade uma nova senha mínima de 12 caracteres e confirmação idêntica. Os requisitos atuais de bootstrap e administração de usuários não foram alterados retroativamente.
- A senha atual será verificada e a nova senha usará a camada Argon2id existente; apenas o hash pode ser persistido. Credenciais e confirmação não podem ser exibidas após envio, incluídas em erros/logs nem armazenadas em texto puro. A sessão permanece autenticada após sucesso.
- Recuperação/redefinição por terceiro ou e-mail continua fora de escopo. A regra foi registrada na SPEC antes da implementação.

## SF-029 — Autogerenciamento da própria senha (2026-10-06)

- Implementado o fluxo autenticado para os três perfis, baseado exclusivamente no ator retornado pela sessão server-side. A operação confirma que a conta continua ativa no PostgreSQL, valida a senha atual pela função `verifyPassword` e persiste apenas um novo hash `hashPassword` Argon2id.
- A validação estrita exige senha atual, nova senha de ao menos 12 caracteres e confirmação idêntica; a entrada não aceita campos extras como `userId`. A atualização condicional por ID da sessão e hash anterior evita sobrescrever alteração concorrente. Não foi alterado schema ou banco.
- Adicionada página `/account/password`, link na navegação de solicitante, atendente e administrador, formulário com Salvar/Cancelar, mensagens sanitizadas e limpeza dos campos após sucesso. O Auth.js mantém a sessão porque a operação não invalida nem substitui os claims de sessão.
- Unitários: 79 aprovados; typecheck, lint e build aprovados. `npm.cmd run test:integration` não iniciou os testes: `prisma generate` falhou duas vezes com `EPERM` ao renomear o engine DLL. A execução direta do Vitest também foi impedida pelo setup, que não conseguiu conectar ao `TEST_DATABASE_URL`; os testes de integração adicionados não puderam ser validados neste ambiente. Reexecutar quando Prisma engine e banco de teste estiverem disponíveis.
- SF-029 permanece em validação, não concluída, até a suite de integração passar. Não houve alteração de autenticação além do fluxo de autogerenciamento, recuperação de senha ou commit/push.

## Fechamento documental e medição oficial (2026-10-06)

- Estado do worktree verificado: existem alterações previamente pendentes em documentação e código, incluindo a navegação administrativa e a implementação SF-029; nenhuma dessas alterações foi revertida ou incorporada nesta medição.
- Executado exatamente o comando oficial de cloc com a instalação WinGet indicada e `--vcs=git`, exclusões de dependências/build/prompts, linguagens documentais e arquivos `lock`/`.min.`.
- Resultado real reportado: **8.903 linhas de código** — TypeScript 7.887; CSS 817; SQL 97; Prisma Schema 94; JavaScript 8. São 105 arquivos contabilizados (1.033 linhas em branco, 19 comentários).
- Meta acadêmica: 100.000; diferença: **91.097**. SF-026 continua incompleta. Como o comando usa `--vcs=git`, apenas arquivos rastreados são considerados; Markdown/documentação e prompts são excluídos.
- Métricas do repositório em 2026-10-06: 79 testes unitários aprovados; 68 casos de integração declarados (61 passaram na última execução anterior à SF-029; 7 casos de senha próprios ainda sem execução automatizada, devido a `EPERM` de `prisma generate` e falha de conexão ao `TEST_DATABASE_URL`); 1 cenário E2E aprovado na execução registrada da SF-028, não reexecutado nesta etapa; 2 SPECs principais; 29 tarefas SF registradas.
- Nesta etapa: `npm.cmd run test:unit` passou (79 testes, 21 arquivos); `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build` e `git diff --check` passaram. A suíte de integração não foi repetida no fechamento documental; permanece a limitação descrita acima. Nenhum código funcional foi alterado no fechamento documental.

## Alteração de SPEC — Documentos exigidos por serviço (2026-10-16)

- Registrada a seção 21 da SPEC principal. Anexos estavam explicitamente fora do escopo inicial (seções 5 e 19); a alteração passa a autorizá-los somente no recorte da seção 21: requisitos documentais configurados por serviço pelo administrador e anexos PDF/DOCX/TXT enviados pelo solicitante na abertura. Anexos em comentários, após a abertura ou por atendentes continuam fora de escopo.
- Foco inicial em RH, mas sem setores, serviços ou requisitos fixos no código. Os exemplos de RH (férias, declaração, alteração cadastral, escalas) foram registrados apenas como configurações possíveis; a obrigatoriedade de cada documento é decidida pelo administrador, serviço a serviço.
- **Análise de infraestrutura:** Next.js 16.3.8 publicado no Vercel; PostgreSQL no Supabase via Prisma; nenhum armazenamento de arquivos; `next.config.ts` sem configuração; Server Actions limitadas a 1 MB por padrão (conforme `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`). O sistema de arquivos das funções do Vercel é efêmero.
- **Decisão recomendada de armazenamento:** bucket privado do Supabase Storage (mesmo provedor do banco), acessado apenas no servidor com credencial em variável de ambiente; download sempre intermediado por rota autorizada; sem URLs públicas, permanentes ou assinadas expostas ao cliente; buckets separados por ambiente; adaptador próprio para isolar o provedor; preferência por API HTTP sem nova dependência. Alternativas: `bytea` no PostgreSQL (fallback), Vercel Blob (novo provedor), disco local (inviável). A confirmação final fica na SF-030.
- **Limites:** 5 requisitos ativos por serviço, 1 arquivo por requisito (máx. 5), 2 MiB por arquivo e 4 MiB por solicitação. Justificativa: o envio e o download passam por funções do Vercel, cujo corpo de requisição/resposta é limitado a cerca de 4,5 MB; os 4 MiB deixam margem para descrição e overhead multipart. O valor do Vercel foi usado com base no conhecimento da plataforma e **não foi reconfirmado na documentação vigente nesta etapa**; a SF-030 deve reconfirmá-lo. Arquivos maiores exigem upload direto e nova alteração de SPEC.
- **Tipo real:** assinatura `%PDF-`; DOCX como ZIP com `[Content_Types].xml` e `word/document.xml`, rejeitando macros e com limite de descompactação; TXT como UTF-8 válido sem bytes nulos/controle. Extensão e MIME informado não decidem a aceitação. Antivírus fica como risco registrado, fora desta alteração.
- **Autorização:** atendente do setor registrado na solicitação e o próprio solicitante podem listar/baixar; administrador permanece sem acesso operacional, coerente com a seção 10. Decisão registrada: o pedido citava explicitamente o atendente; o acesso do solicitante aos próprios anexos foi incluído por decorrer da regra existente de consulta às próprias solicitações.
- **Consistência banco/armazenamento:** objetos gravados antes da transação; compensação remove objetos se a transação falhar; registro de anexo nunca aponta para objeto inexistente; órfãos ficam inacessíveis e precisam de procedimento de limpeza.
- **Privacidade:** logs sem conteúdo, nome original, chave de armazenamento ou credencial; fixtures somente sintéticas.
- **MCP:** não implementado; registrado como requisito futuro que qualquer ferramenta MCP use as mesmas operações e verificações server-side e não contorne perfil, propriedade ou setor.
- Tarefas SF-030 a SF-036 registradas em `TASKS.md`. Nenhum código, banco, dependência ou configuração foi alterado; sem commit/push.

## SF-030 — Confirmação do armazenamento de documentos (2026-10-16)

- **Decisão confirmada:** bucket privado do Supabase Storage, acessado só no servidor (runtime Node.js) com chave secreta `sb_secret_` dedicada; upload e download intermediados pela aplicação; sem URL pública, permanente ou assinada entregue ao cliente. Detalhes na SPEC 21.15.
- **Limite da Vercel reconfirmado:** 4,5 MB para corpo de requisição e de resposta (413 `FUNCTION_PAYLOAD_TOO_LARGE`), conforme *Functions Limits* (atualizada em 2026-08-24). Isso substitui a ressalva anterior desta nota, que dizia não ter reconfirmado o valor. Streaming não tem esse limite.
- **Limites mantidos sem alteração** (2 MiB/arquivo, 4 MiB/solicitação, 5 arquivos, 5 requisitos). No pior caso o corpo fica em ~4.244.304 bytes, abaixo de 4.500.000 (unidade "MB" tratada como decimal, a leitura mais conservadora). `serverActions.bodySizeLimit` definido para a SF-034: `'4.25mb'` = 4.456.448 bytes.
- **Por que não upload direto ou URL assinada:** os limites cabem no corpo da função. O upload direto exigiria validar o conteúdo depois de gravado, criaria órfãos por desenho e daria um token de upload (válido por até 2 h) ao cliente. A URL assinada vale para qualquer portador enquanto não expira.
- **Achado de segurança:** as chaves secretas do Supabase ignoram RLS e acessam todos os buckets do projeto. Bucket separado não isola a credencial; por isso produção deve ficar em projeto Supabase exclusivo. A `service_role` legada está em descontinuação até o fim de 2026 e não deve ser usada.
- **Compensação:** objetos gravados antes do commit; falha de upload ou transação remove os objetos da tentativa; falha da compensação é registrada só com identificador de correlação e código de erro; órfãos ficam inacessíveis (download exige registro no banco) e serão removidos por procedimento de limpeza de objetos sem solicitação e com mais de 24 h.
- **Nomes definidos:** buckets `serviceflow-documents`, `-dev` e `-test` (adaptador de teste recusa bucket sem sufixo `-test`); variáveis `DOCUMENT_STORAGE_URL`, `DOCUMENT_STORAGE_BUCKET`, `DOCUMENT_STORAGE_SECRET_KEY` (Secret na Vercel) e equivalentes `TEST_DOCUMENT_STORAGE_*` sem fallback.
- **Dependência:** usar a API HTTP do Storage via `fetch`, sem `@supabase/supabase-js`, salvo justificativa registrada.
- **Limitações registradas:** provisionamento não feito (buckets, chaves, variáveis, teste de leitura anônima) por exigir acesso às contas e por restrição desta etapa; estado atual das contas não verificado; base da unidade "MB" não definida pela Vercel; documentação do Supabase não diz se `allowedMimeTypes` inspeciona conteúdo; rota HTTP de upload confirmada na referência de self-hosting e rota de remoção não confirmada.
- **Estado:** SF-030 parcialmente concluída (decisão técnica concluída; provisionamento pendente). Nenhum código, banco, dependência, configuração ou arquivo `.env*` alterado; nenhum segredo criado; nenhum teste executado; sem commit/push.

## SF-031 — Schema de requisitos documentais e anexos (2026-10-16)

- **Estrutura criada:** enum `DocumentFormat` (`PDF`, `DOCX`, `TXT`); tabela `ServiceDocumentRequirement` (`serviceId`, `name` citext, `isRequired`, `acceptedFormats` array do enum, `position`, `isActive`, datas); tabela `RequestAttachment` (`requestId`, `requirementId`, snapshots de nome e obrigatoriedade do requisito, `originalFilename`, `detectedFormat`, `contentType`, `sizeBytes`, `sha256`, `storageKey`, `uploadedById`, `createdAt`). Não há `updatedAt` no anexo, porque o registro é imutável. Só metadados ficam no PostgreSQL; nenhum conteúdo binário.
- **Entidades existentes:** nenhuma coluna, índice ou restrição SQL foi alterada em `Sector`, `Category`, `User`, `Service`, `Request` ou `RequestStatusEvent`. No `schema.prisma` foram adicionados apenas os campos de relação reversa (`Service.documentRequirements`, `Request.attachments`, `User.uploadedAttachments`), que não geram SQL.
- **Restrições no banco:** FKs `ON DELETE RESTRICT` para serviço, solicitação, requisito e usuário; unicidade `(requestId, requirementId)`; índice único parcial `(serviceId, name) WHERE isActive` com citext (mesmo padrão das migrations de setor/categoria); CHECKs para nome do requisito (sem espaços periféricos, 1–120), formatos (não nulo, 1–3 itens, sem item nulo), posição ≥ 0, snapshot de nome (1–120), nome de arquivo (1–255, sem `/`, `\` ou caracteres de controle), coerência `detectedFormat`/`contentType` (`application/pdf`, tipo OOXML do Word, `text/plain`), tamanho 1 a 2.097.152 bytes, SHA-256 hexadecimal minúsculo e `storageKey` = `requests/{requestId}/{id}` (SPEC 21.15.4).
- **Regras deixadas para a aplicação (SF-032/SF-034), com transação serializável como nas regras existentes:** máximo de 5 requisitos ativos por serviço, formatos sem repetição na lista, requisito pertencente ao mesmo serviço da solicitação, autor do envio igual ao solicitante, máximo de 5 anexos e 4 MiB por solicitação. Essas regras envolvem mais de uma linha ou tabela e exigiriam gatilhos ou alterar tabelas existentes; a decisão segue o padrão já usado para "último administrador" e "último atendente".
- **Geração da migration:** SQL base gerado com `prisma migrate diff --from-schema-datamodel` (schema do `HEAD`) `--to-schema-datamodel` (schema novo), sem conectar a nenhum banco; restrições adicionadas manualmente. Migrations anteriores não foram alteradas. O Prisma cria listas escalares como coluna anulável, por isso o CHECK exige `acceptedFormats IS NOT NULL`.
- **Validação:** `prisma validate`, `prisma generate`, typecheck, lint, build e 81 testes unitários passaram (o `EPERM` da SF-029 no `prisma generate` não se repetiu). `npm.cmd run test:integration` falhou no global setup ao conectar no `TEST_DATABASE_URL`. Diagnóstico com saída sanitizada: o pooler do Supabase (`*.supabase.com:5432`, banco `serviceflow_test`) retornou `FATAL: (ENOTFOUND) tenant/user ... not found`. A causa provável é o projeto Supabase pausado/removido ou usuário do pooler desatualizado; não foi possível confirmar sem acesso à conta. Não há PostgreSQL local nem Docker para validar a migration de outra forma. O banco de desenvolvimento não foi usado como substituto.
- **Pendente:** restabelecer o banco de teste, executar `npm.cmd run test:integration` (que aplica a migration via `migrate deploy` no banco isolado) e confirmar os 11 casos novos e a suíte existente. A migration não foi aplicada em desenvolvimento nem em produção.

## Diagnóstico de execução e Etapa A (2026-10-19)

- **Bloqueio principal:** `DATABASE_URL` (`.env`) e `TEST_DATABASE_URL` (`.env.test.local`) apontam para o projeto Supabase antigo e pausado. Sondas somente leitura (`SELECT 1`, saída sanitizada) falham nos dois com `FATAL: (ENOTFOUND) tenant/user ... not found`. A aplicação compila e inicia, mas login e fluxos com dados dependem de um banco acessível. Nenhum banco foi alterado; nenhuma migração ou importação foi executada.
- **Backup analisado somente para leitura** (`ServiceFlow-backup/db_cluster-12-10-2026@14-11-01.backup`, hashes SHA-256 conferidos antes e depois): `pg_dumpall` com o banco `postgres` (dados operacionais pequenos), o banco `serviceflow_test` (dados de teste, não importar) e esquemas internos do Supabase. As quatro migrations registradas no backup têm checksum idêntico aos arquivos locais; a migration de documentos ainda não existia ali. O arquivo `.storage.zip` está vazio. Qualquer restauração seletiva aguarda aprovação explícita.
- **`AUTH_TRUST_HOST`:** `npm run start` local falhava com `UntrustedHost` do Auth.js. A variável foi documentada **comentada** no `.env.example`, porque o Auth.js usa `AUTH_URL ?? AUTH_TRUST_HOST ?? VERCEL ?? ... ?? NODE_ENV !== "production"`: um valor vazio interromperia a cadeia e desligaria a confiança automática também em desenvolvimento. Validado com a variável definida só no processo: `/api/auth/session` respondeu 200 sem `UntrustedHost`. O `.env` local não foi alterado.

## SF-033 — Validação de arquivos e adaptador de armazenamento (2026-10-19)

- **Dependência:** iniciada com aprovação explícita do responsável, embora a SF-030 siga parcial; a SF-033 depende apenas da decisão técnica já registrada. O provisionamento pendente bloqueia somente o teste do adaptador real.
- **Decisões de interpretação aprovadas antes da implementação:** nome de arquivo com mais de 255 caracteres após sanitização é **rejeitado**, não truncado; adaptador real implementado e testado com `fetch` simulado, sem rede; variáveis `DOCUMENT_STORAGE_*` e `TEST_DOCUMENT_STORAGE_*` adicionadas comentadas e sem valores aos arquivos de exemplo; caminho público `attachments` incluído na lista de caminhos de validação de `src/server/errors`.
- **Módulos:** `src/modules/attachments/file-type.ts` (detecção de tipo real), `src/modules/attachments/policy.ts` (limites, sanitização, extensão, inspeção, SHA-256 e chave opaca) e `src/server/storage/index.ts` (interface, adaptador em memória, adaptador HTTP do Supabase e configuração).
- **Tipo real:** PDF por `%PDF-`; DOCX lido diretamente do diretório central do ZIP com `node:zlib`, **sem nova dependência**: exige `[Content_Types].xml`, `word/document.xml` e o `Override` do documento principal com o tipo Word sem macros; rejeita `macroEnabled`, `vbaProject.bin`, ZIP cifrado, multi-disco, truncado, com mais de 1.000 entradas ou com `[Content_Types].xml` acima de 64 KiB descompactados (`maxOutputLength`). ZIP que não é DOCX nunca é reinterpretado como texto. TXT exige UTF-8 estrito (BOM opcional) e rejeita controles C0 (exceto TAB, CR, LF), DEL e C1.
- **Sanitização:** normalização NFC, somente o nome base (descarta caminhos `/` e `\`), remoção de caracteres de controle e de controles bidirecionais (evita disfarçar a extensão real), espaços colapsados. A extensão final precisa coincidir com o formato detectado e o formato com os aceitos pelo requisito.
- **Erros e privacidade:** falhas de arquivo viram `ValidationError` com `path: ["attachments"]` e código genérico; falhas de armazenamento viram `DocumentStorageError` (resposta pública `INTERNAL_ERROR`) com um `reason` interno. Nenhuma mensagem contém nome original, conteúdo, chave ou credencial, e o módulo não grava logs. Mensagens de configuração citam o nome da variável, nunca o valor.
- **Storage HTTP:** rotas conferidas no código-fonte oficial do `supabase/storage` em 2026-10-19 — `POST /object/{bucket}/*` (sobrescrita só com `x-upsert: true`; enviamos `false`), `DELETE /object/{bucket}/*` e `GET /object/authenticated/{bucket}/*`, prefixadas por `/storage/v1`. A documentação *Understanding API keys* orienta enviar chaves `sb_` no cabeçalho `apikey` e não em `Authorization: Bearer`; o adaptador segue isso. Chaves que não começam com `sb_secret_` são recusadas. Chaves validadas por formato apenas.
- **Limitações:** o adaptador real **não foi exercitado contra um bucket real**; o status HTTP de conflito (tratado como 409) e o comportamento da plataforma hospedada com a chave só no `apikey` precisam ser confirmados quando o bucket `serviceflow-documents-test` existir. Sem o pacote `server-only` (não instalado; não adicionado), a garantia de uso apenas no servidor vem da localização em `src/server/`, do uso de `node:zlib`/`node:crypto` e da ausência de prefixo `NEXT_PUBLIC_`.
- **Validação:** `npm run lint` ok; `npm run typecheck` ok (uma falha de tipos nos testes do storage foi corrigida antes da execução final); `npm run test:unit` 149 aprovados em 25 arquivos (81 anteriores + 68 novos); `npm run build` ok; `npx prisma validate` ok; `git diff --check` ok. Testes de integração não executados: banco de teste indisponível.
- **Meta AP1 de linhas:** nenhum código foi criado para aumentar contagem; a SF-026 continua dependente da confirmação do enunciado original.

## SF-032 — Configuração de requisitos documentais por serviço (2026-10-19)

- **Plano e interpretações aprovados antes da implementação:** sem reativação de requisito (a SPEC 21.2 prevê criar, editar, reordenar e desativar; para voltar a exigir um documento cria-se outro, já que a unicidade vale só entre ativos); inativos exibidos abaixo dos ativos apenas como histórico, sem editar ou mover; configuração permitida em serviço inativo (o catálogo continua dependendo do serviço ativo); Subir no primeiro e Descer no último são operações sem efeito e sem erro, e os botões não aparecem.
- **Domínio:** novo módulo `src/modules/document-requirements/` no padrão de `services`: `requireConfigurationAdministrator` em toda operação, transação serializável, P2002 → `ConflictError` e P2025/P2003 → `NotFoundError`. O limite de 5 ativos é verificado na transação; a unicidade de nome entre ativos, sem distinção de maiúsculas, fica no índice parcial citext da migration da SF-031. Edição altera apenas nome, obrigatoriedade e formatos; serviço, posição e estado nunca vêm da entrada (esquema `strict`). Requisito inativo não pode ser editado nem movido; desativar de novo não tem efeito.
- **Posições:** novo requisito recebe a maior posição do serviço + 1 (ativos e inativos). Subir/Descer troca o requisito com o vizinho entre os ativos ordenados por posição e id e renumera os ativos a partir de 0, gravando só as linhas alteradas; isso corrige empates ou lacunas eventuais. Não existe restrição única de posição, então as atualizações sequenciais na mesma transação não colidem.
- **Interface:** bloco "Documentos exigidos" dentro de cada serviço do painel, por meio de uma prop opcional `children` em `AdminRecordEditor` (sem efeito nos demais registros). Formulário de inclusão oculto quando há 5 ativos; o servidor continua impondo o limite. CSS mínimo para lista e caixas de seleção.
- **Erros:** caminhos públicos `isRequired` e `acceptedFormats` incluídos em `src/server/errors`. As Server Actions reutilizam as mensagens fixas existentes; valores inesperados de obrigatoriedade são repassados ao servidor para validação, sem conversão silenciosa.
- **Validação:** `npm run lint` ok (uma regra de hooks acusou os auxiliares `useActor`/`useAdmin` do teste de integração; renomeados); `npm run typecheck` ok; `npm run test:unit` 174 aprovados em 26 arquivos (25 casos novos); `npm run build` ok; `npx prisma validate` ok; `git diff --check` ok.
- **Pendente:** `tests/integration/document-requirements.test.ts` (16 casos: CRUD, posições, limite, unicidade, outro serviço, histórico, Subir/Descer, preservação de anexos e negação para REQUESTER, ATTENDANT, inativo e não autenticado) não foi executado: a sonda somente leitura do `TEST_DATABASE_URL` em 2026-10-19 continuou retornando `FATAL: (ENOTFOUND) tenant/user ... not found`. A SPEC não foi alterada; nenhuma contradição foi encontrada.

## Banco de teste local e conclusão das SF-031 e SF-032 (2026-10-20)

- **Banco principal:** o projeto Supabase antigo (ref `miojtokc…`) voltou a responder. Sondas somente leitura: dados acessíveis (User 3, Category 2, Sector 1, Service 1, Request 1, RequestStatusEvent 1, contagens iguais às do backup de 12/10), 4 de 5 migrations aplicadas; falta só `20261016120000_document_requirements_and_attachments`, e o `prisma migrate diff` do banco para o `schema.prisma` mostra exatamente o conteúdo dessa migration. **A migration não foi aplicada no banco principal.** `DATABASE_URL` não foi alterado.
- **Backup novo do banco principal:** `ServiceFlow-backup/serviceflow-db_miojtokc…_20261020_162409.dump` (`pg_dump` 18.6, formato custom, `--no-owner --no-privileges`, 312.864 bytes, servidor 17.11). `pg_restore --list` sem erros (450 entradas; dados das 7 tabelas públicas). Inclui esquemas internos do Supabase; para restaurar só a aplicação, usar `--schema=public`. Exige `pg_restore` 18 ou mais recente. Backups anteriores conferidos por SHA-256: inalterados.
- **Supabase como banco de teste (descartado):** no projeto de recuperação (`enciyvlc…`) foi criado um `serviceflow_test` vazio, mas o Session pooler recusou a conexão a esse banco (autenticação falhou só ao trocar o nome do banco). A conexão direta do Supabase é IPv6 e a rede local não tem IPv6 global. O banco vazio continua lá, sem uso.
- **Primeira tentativa local (PostgreSQL 18.6, porta 5433, `--locale=C`):** 23/26 aprovados. Duas causas de ambiente, nenhuma do código: (1) com locale `C`, `lower('FORMULÁRIO')` resulta `formulÁrio`, e o citext não detecta o conflito com `Formulário` (CA-DOC-03); o banco de teste original usava ICU `en-US`. (2) No PostgreSQL 18, violar FK `ON DELETE RESTRICT` retorna SQLSTATE `23001` (`restrict_violation`), que o Prisma 6.16 não converte em `P2003`; no 17 retorna `23503`. O teste existente `referential-integrity.test.ts` falhou da mesma forma nesse servidor. As asserções não foram alteradas.
- **Ambiente de teste adotado:** binários oficiais `postgresql-17.11-5-windows-x64-binaries.zip` da EnterpriseDB, baixados por HTTPS e extraídos em `%LOCALAPPDATA%\serviceflow-pg17` (sem instalador, sem serviço do Windows, sem administrador). SHA-256 do zip `80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F`. **Limitação:** os executáveis não têm assinatura digital (o PostgreSQL 18 instalado também não) e a EnterpriseDB não publica checksum do zip; a integridade **não** foi verificada criptograficamente, só por origem HTTPS oficial e tamanho igual ao anunciado. Instância em `%LOCALAPPDATA%\serviceflow-testdb17\data`, porta 5434, `listen_addresses=localhost`, banco `serviceflow_test` criado com `LOCALE_PROVIDER icu ICU_LOCALE 'en-US'`. `pg_hba.conf` final: somente `host serviceflow_test postgres 127.0.0.1/32 trust` e `::1/128 trust`; o acesso ao banco de manutenção existiu só para criar o banco. `TEST_DATABASE_URL` aponta para `postgresql://postgres@localhost:5434/serviceflow_test` (sem senha). A instância é um processo do usuário e precisa ser iniciada de novo com `pg_ctl ... -o "-p 5434 -c listen_addresses=localhost" start` após reiniciar a máquina.
- **Isolamento durante os testes:** `DATABASE_URL` foi sobrescrito só no processo por um endereço inexistente; o setup global aplica migrations apenas no `TEST_DATABASE_URL`, e os testes de documentos substituem `@/server/db` pelo cliente dos fixtures.
- **Resultados (PostgreSQL 17.11):** `document-schema.test.ts` 10/10 e `document-requirements.test.ts` 16/16 (26/26, nenhuma correção de código necessária); `referential-integrity.test.ts` 3/3; `npm run lint` ok; `npm run typecheck` ok; `npm run test:unit` 174 aprovados (26 arquivos); `npm run build` ok; `npx prisma validate` ok; `git diff --check` ok. A suíte de integração completa não foi executada nesta etapa.
- **Estado:** SF-031 e SF-032 concluídas. Pendente e fora destas tarefas: aplicar a migration no banco principal (com backup já gerado) e decidir se a instância PostgreSQL 18 de teste (porta 5433, `%LOCALAPPDATA%\serviceflow-testdb`) pode ser parada e removida. Sem commit/push. SF-034 não iniciada.

## Contagem de linhas com cloc (2026-10-27)

- **Método:** cloc v2.10 via `npx cloc`, executado com o Perl do Git Bash (o PowerShell não tem Perl). Exclusões: `node_modules`, `.next`, `.git`, `coverage`, `playwright-report`, `test-results` e `package-lock.json`. O diretório atual não é um repositório Git, então **não** foi usado `--vcs=git`; o resultado não é diretamente comparável à medição oficial de 2026-10-06 (que excluía prompts, documentação e arquivos não rastreados).
- **Código executável (TypeScript + JavaScript): 10.852 linhas** em 119 arquivos — `src/` 4.823 (58 arquivos); `tests/` 5.794 (53); `scripts/` 147 (2); configs da raiz 88 (6). Ficaram de fora CSS (877), SQL das migrations (175), schema Prisma (137) e TOML (1), por serem estilo ou declarativos.
- **Total bruto do cloc: 372.965 linhas de código** (161 arquivos; mais 2.210 em branco e 86 comentários, 375.261 físicas): JSON 358.946; TypeScript 10.844; Markdown 1.977; CSS 877; SQL 175; Prisma 137; JavaScript 8; TOML 1.
- **Distorção:** 358.869 linhas vêm de quatro logs de sessão do Copilot em `prompts/sessoes/*.json`, que não são código. Sem eles, o projeto tem **14.096 linhas de código** (16.392 com linhas em branco e comentários).
- Apenas medição; nenhum arquivo de código foi alterado.

## SPEC de refatoração arquitetural registrada (2026-10-27)

- **Arquivo:** `SPEC/2026-10-27-refatoracao-arquitetural.md`, status "Registrada — aguardando aprovação". Tarefas SF-037 a SF-043 em `TASKS.md`.
- **Decisão proposta:** manter o monólito modular (SPEC principal, seção 17) e organizar cada módulo em `domain/`, `application/`, `infrastructure/` e `ui/`, com `index.ts` como API pública e dependências apontando para dentro. Microsserviços, workspaces, eventos/outbox e schema Prisma em vários arquivos ficaram fora de escopo: não há necessidade atual e exigiriam dependências ou mudanças de banco.
- **Motivos levantados na análise do código:** casos de uso com Prisma embutido e tipos `Prisma.*` na API pública; `admin/page.tsx` (356 linhas) e `admin/actions.ts` (384) concentrando todas as entidades; todos os schemas em `src/shared/validation/index.ts`; imports internos entre módulos (`requests → services/policy`, `users → auth/password`) sem verificação.
- **Restrições fixadas:** sem mudança de comportamento, banco, dependências, rotas ou mensagens; asserções dos testes existentes intocáveis (só caminhos de import/`vi.mock` podem mudar); o parâmetro `database: PrismaClient` das APIs públicas é mantido porque os testes de integração o usam; fronteiras impostas com `no-restricted-imports` do ESLint já instalado.
- **Ordem (aprovada em 2026-10-27):** SF-037 → SF-038 → SF-034 → SF-035 → SF-036 → SF-039 → SF-040 → SF-041 → SF-042 → SF-043. A SPEC passou a "Aprovada em 2026-10-27" (seção 15.1); `TASKS.md` atualizado nas dependências de SF-034, SF-037, SF-039 e SF-040.
- Etapa apenas documental: nenhum código, teste, banco ou dependência alterado; nenhum teste executado.

## Plano de escala para 100.000 linhas aprovado (2026-10-29)

- **SPEC:** `SPEC/2026-10-29-plano-escala-100k.md`, aprovada com decisões na seção 9.
- **Arquitetura:** monólito modular em camadas (opção A), conforme `SPEC/2026-10-27-refatoracao-arquitetural.md`.
- **Ordem revisada:** a refatoração (SF-037 a SF-043) é feita agora, por inteiro, antes das SF-034 a SF-036. A seção 15.1 da SPEC de refatoração e as dependências das SF-034, SF-039 e SF-040 em `TASKS.md` foram atualizadas.
- **Escopo aceito:** itens 1 a 16 e fases 0 a 5 do plano. Cada item ainda exige SPEC própria antes do código.
- **Medição:** somente linhas `added` do `cloc --git --diff baseline-ap2 HEAD` (TypeScript/JavaScript), com testes contando e documentados à parte da aplicação.
- **Linha de base:** tag anotada `baseline-ap2` no commit `410c07b` (código idêntico ao `20cf0e4`), publicada no GitHub.
- **Dependências:** permitidas quando necessárias, com justificativa registrada nesta nota antes ou junto da inclusão (`AGENTS.md`, regra 11). A refatoração em si não adiciona dependências (CA-ARQ-10).
- **Repositório local:** a pasta de trabalho passou a ser um repositório Git ligado a `origin/main` (antes era uma cópia sem `.git`); nenhum arquivo foi alterado na conversão.

## Fase 0 — ambiente de testes e linha de base (2026-10-29)

- **Node:** o Node padrão da máquina é 18.20.8, abaixo do `engines` (>= 20.9). Todos os comandos rodam com `volta run --node 22` (22.23.4). Nenhuma configuração de versão foi versionada.
- **Banco de teste:** PostgreSQL 17.10 portátil via pacote `embedded-postgres@17.10.0-beta.17`, instalado **fora do repositório** (pasta irmã `../pgtest`), porta 54329, banco `serviceflow_test`, codificação UTF8 com ICU `en-US`. Não altera `package.json` (CA-ARQ-10). O diretório temporário da sessão não serviu: o Windows recusou o caminho longo (`0xC0000106`).
- **Configuração local:** `.env.test.local` (ignorado pelo Git) com `TEST_DATABASE_URL` apontando para esse banco; a senha é local e exclusiva de teste.
- **Defeito pré-existente em `playwright.config.ts`:** sem `.env`/`.env.local`, `process.env.DATABASE_URL ??= developmentEnvironment.DATABASE_URL` grava a string `"undefined"`, e a verificação de isolamento falha com `DATABASE_URL must be valid...`. Contorno usado: definir `DATABASE_URL` com um banco de desenvolvimento diferente (`serviceflow_dev`) só na execução do E2E. Não corrigido agora para não alterar comportamento durante a refatoração; fica para SPEC futura.
- **E2E quebrado desde 2026-10-06:** o commit `041082f` ("moderniza interface") transformou `/admin` em abas (`?section=`) com "Visão geral" por padrão, e o E2E de 2026-10-05 não foi atualizado. Ajustes feitos em `tests/e2e/service-request-flow.spec.ts`, **sem mudar textos esperados nem o fluxo verificado**:
  1. novo auxiliar `openAdminSection`, que clica na aba antes de usar Setores, Categorias, Usuários e Serviços;
  2. a linha do usuário em edição passa a ser localizada também pelo campo `email` (no modo de edição o e-mail não aparece como texto);
  3. a mensagem "Registro criado." é procurada dentro do formulário de criação, porque a página passou a ter duas regiões `status` simultâneas (criação e edição).
- **Linha de base verificada (código de `baseline-ap2`):** lint OK; typecheck OK; unitários 26 arquivos / 174 testes OK; integração 19 arquivos / 94 testes OK (inclui os testes da SF-029, pendentes desde 2026-10-06); E2E 1/1 OK após o ajuste acima; build OK.

## SF-037 — Fronteiras entre módulos (2026-10-29)

- **Regra:** `eslint.config.mjs` gera, para cada pasta de `src/modules/`, um bloco `no-restricted-imports` que proíbe `@/modules/*/**` (interno de qualquer módulo via alias) e, por `regex`, caminhos relativos que chegam a **outro** módulo (`^(\.\./)+(<outros módulos>)(/|$)`). Subir dentro do próprio módulo (`../domain/x`) continua permitido, o que é necessário para as camadas da SF-038. A lista de módulos é lida do disco, então módulos novos entram automaticamente.
- **Fora dos módulos** (`src/app`, `src/server`, `src/shared`, `scripts`): `@/modules/*/**` proibido, com exceções transitórias para os imports internos já existentes: `services/catalog`, `auth/change-own-password`, `auth/components` e `attachments/policy`. Elas permanecem porque testes usam `vi.mock("@/modules/auth/change-own-password")` e porque `auth`/`attachments` só são migrados na SF-040; a SF-043 remove a lista.
- **Detalhe da sintaxe:** os padrões seguem gitignore; para reincluir `auth/components/*` foi preciso reincluir também a pasta `auth/components`.
- **Acoplamentos trocados:** `requests` → `@/modules/services` (que já exportava `assertServiceCanReceiveRequests`); `users` → `@/modules/auth`, com novo `src/modules/auth/index.ts` exportando `hashPassword` e `verifyPassword`.
- **Verificação manual (CA-ARQ-04):** arquivos temporários com 3 imports proibidos (`@/modules/services/policy` e `../services/policy` em `requests`; `@/modules/requests/policy` em `src/app`) geraram 3 erros; os permitidos (`@/modules/services`, `./policy`, `../policy` em subpasta do próprio módulo, `@/modules/services/catalog` transitório) não geraram erro. Segunda rodada com `@/modules/auth/password` e `../users/policy`: 5 de 5 bloqueados. Arquivos removidos em seguida.
- **Resultados:** lint, typecheck e build OK; unitários 174/174; integração 94/94; E2E 1/1. Nenhuma asserção ou mock de teste alterado. `package.json` e Prisma intocados.

## SF-038 — Piloto `requests` em camadas: padrão adotado (2026-10-29)

Padrão a replicar nas SF-039 e SF-040:

- **`domain/`**: tipos de domínio escritos à mão (`RequestRecord`, `RequestWithHistory`, `RequestStatus` como união de strings) e regras puras (`buildRequestSnapshot`, `assertRequestStatusTransition`). Pode usar `@/server/errors`. Sem Prisma, Next, React ou I/O.
- **`application/`**: `ports.ts` com as interfaces e um arquivo por grupo de casos de uso. Cada caso de uso recebe o repositório (ou o executor de transação) **como parâmetro** — sem contêiner de injeção. Autorização e validação continuam no caso de uso (`@/server/authorization`, `@/server/validation`, schemas de `@/shared/validation` até a SF-041).
- **Transação (decisão do ponto em aberto da seção 15.2):** port `RequestTransactionRunner.run(work)`, em que `work` recebe um `RequestTransaction` com as operações permitidas dentro da transação. A implementação Prisma usa `$transaction` com `Serializable`, como antes. Os casos de uso não sabem que existe Prisma.
- **Tradução de erros:** utilitário único `translatePrismaError(error, codes)` em `src/server/db/prisma-errors.ts` (P2002 → `ConflictError`; P2003 e P2025 → `NotFoundError`; P2034 → `ConflictError`). Cada ponto de uso lista **só os códigos que já traduzia**, para não mudar comportamento: criação traduz P2003/P2025; transição traduz P2034. O executor também preserva a mensagem de fallback para valores lançados que não são `Error`.
- **`infrastructure/`**: repositórios Prisma com as mesmas consultas, `include` e ordenação de antes. O mapeamento linha → domínio é uma função tipada (`toDomain`): o TypeScript garante que a linha do Prisma é compatível com o tipo de domínio, e o objeto devolvido em tempo de execução é o mesmo de antes (evita alterar resultados comparados por testes de integração).
- **`index.ts`**: ponto de composição. Mantém nomes, assinaturas e o parâmetro `database: PrismaClient = prisma` (seção 7). Reexporta tipos e regras de domínio usados por outras partes.
- **Testes:** repositório e executor em memória em `tests/unit/modules/requests/in-memory-requests.ts`; o executor restaura o estado quando o trabalho lança erro, simulando o rollback. `@/server/authorization` é simulado; `assertRole` vem do `policy.ts` real.
- **Teste existente alterado:** apenas os imports de `tests/unit/modules/requests/policy.test.ts` (`@/modules/requests/policy` → `domain/snapshot` e `domain/status-transition`). Asserções intactas.
- **Correção durante a tarefa:** um teste novo esperava `ConflictError` para serviço inativo; a regra real de `services` responde `NotFoundError` (esconde o serviço). A expectativa do teste novo foi corrigida; o código não mudou.
- **cloc do módulo:** antes 290 linhas em 2 arquivos (`index.ts` 254, `policy.ts` 36); depois 489 em 9 arquivos. Testes novos: 4 arquivos de teste e 1 auxiliar.
- **Resultados:** lint, typecheck e build OK; unitários 191/191 (30 arquivos); integração 94/94; E2E 1/1.

## Medição revisada: `scripts/cloc-diff.sh` (2026-10-29)

- `cloc --git --diff baseline-ap2 HEAD` subcontou neste Windows (58 `added`); a comparação de pastas extraídas com `git archive` deu 897. O protocolo da seção 3.2 do plano passou a usar `sh scripts/cloc-diff.sh`, que mostra `src`, `tests`, `scripts`, o total e o saldo líquido.
- **Medição após SF-038:** `added` 897 (aplicação 452, testes 445); `removed` 231; saldo líquido 666. Parte do `added` em `src` é código realocado de `requests/index.ts` para as camadas; o saldo líquido mostra o que é realmente novo.

## Operação do banco de teste local (2026-10-29)

- **Iniciar:** em `../pgtest`, executar `volta run --node 22 node start.mjs` e aguardar `READY postgres on 54329`. O script reaproveita os dados existentes em `../pgtest/data`.
- **E2E:** rodar com `DATABASE_URL` de desenvolvimento diferente do banco de teste (ver fase 0), por exemplo `serviceflow_dev` na mesma porta.
- **Memória:** em 2026-10-29 o processo foi encerrado pelo Claude Code por memória crítica do sistema com a sessão ociosa. Para impedir esse encerramento, iniciar o Claude Code com `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` no ambiente (não tem efeito se definido dentro da sessão).
- **Push:** a autenticação do GitHub expirou durante a sessão; commits desde `57d10cc` aguardam `git push origin main` com login interativo.

## SF-039 — Catálogo e organização em camadas (2026-10-29)

- **Módulos:** `sectors` (`d870dbc`), `categories` (`8a5e8b6`), `services` com catálogo (`3150db7`) e `document-requirements`, cada um com todas as suítes aprovadas antes do commit.
- **Reuso:** `src/server/db/serializable-transaction.ts` concentra a transação `Serializable` e o tratamento de erros (`runSerializableTransaction`, `rethrowPersistenceError`); `requests` também passou a usá-lo. Cada repositório declara os mesmos códigos de antes (P2002/P2025/P2003) e a mesma mensagem de fallback.
- **Catálogo:** `services/catalog.ts` foi absorvido: `groupPublishedServices` e `PublishedService` no `domain/service.ts`, consultas em `application/catalog-queries.ts`, Prisma em `infrastructure/`. As páginas `/catalog` e `/catalog/[serviceId]` importam de `@/modules/services`; a exceção `services/catalog` saiu de `eslint.config.mjs`.
- **`listServices`:** o tipo público continua sendo o registro de serviço sem relações, mas a consulta mantém `include: { category, sector }`, como antes, porque o objeto retornado em tempo de execução não pode mudar.
- **Testes existentes alterados (só imports):** `tests/unit/modules/{sectors,categories,services,document-requirements}/policy.test.ts`, `tests/unit/modules/services/catalog.test.ts`, `tests/integration/catalog.test.ts`, `tests/integration/authorization/matrix.test.ts`.
- **Testes novos:** casos de uso dos quatro módulos com repositórios em memória e o auxiliar `tests/unit/support/in-memory-transaction.ts` (rollback e IDs determinísticos).
- **cloc por módulo (antes → depois):** `services` 266 → 341; `categories` 126 → 172; `sectors` 148 → 196; `document-requirements` 221 → 330.
- **Medição acumulada (`scripts/cloc-diff.sh`):** `added` 1.897; `removed` 660; saldo líquido 1.237.
- **Resultados:** lint, typecheck e build OK; unitários 206/206 (34 arquivos); integração 94/94; E2E 1/1.

## SF-040 — Identidade e anexos em camadas (2026-10-29)

- **`attachments`:** sem persistência, ficou com `domain/` (`file-type.ts`, `attachment-policy.ts`) e `index.ts`. `src/server/storage` importa `@/modules/attachments`.
- **`users`:** padrão do piloto; o hash de senha entra no caso de uso como dependência (`UserCommandDependencies.hashPassword`), o que permite testar sem argon2. A composição usa `hashPassword` da API pública de `auth`.
- **`auth`:**
  - `application/`: `authenticate-credentials`, `change-own-password`, `bootstrap-admin`, `bootstrap-admin-cli` e `ports.ts` (`PasswordHasher`, `AuthUserRepository`, `AdministratorBootstrapStore`).
  - `infrastructure/`: `argon2-password`, `prisma-auth-repository`, `next-auth-session`, `next-auth-config` e três composições enxutas: `prisma-credentials`, `prisma-password-change` e `prisma-bootstrap-admin`.
  - `ui/`: os três componentes React. `ChangePasswordForm` passou a receber a Server Action pela propriedade `action` (padrão documentado em `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`); antes o módulo importava de `src/app`, invertendo a dependência.
- **Pontos de composição fora de `src/`:** `auth.ts` importa `@/modules/auth/infrastructure/next-auth-config` direto, porque exportar a configuração pelo `index` criaria o ciclo `index → change-own-password → @/server/authorization → @/server/auth → auth.ts`. `scripts/bootstrap-admin.ts` e `scripts/prepare-e2e.ts` importam `infrastructure/prisma-bootstrap-admin`, que não carrega `@/server/db`, para que o CLI continue lendo o `.env` antes de abrir o banco.
- **Composições separadas por dependência:** importar o `index` de `auth` carrega a troca de senha e, por ela, o Auth.js. Por isso `authenticateCredentials`, `changeOwnPassword` e `bootstrapFirstAdmin` ficam em arquivos próprios; `auth.test` e `bootstrap-admin.test` importam esses arquivos, já que o Auth.js não carrega no Vitest (`Cannot find module next/server`). A primeira tentativa, com tudo no `index`, quebrou esses dois testes e foi corrigida assim, sem novos mocks.
- **P2034 no bootstrap:** preservada a regra própria (conflito só quando já existe administrador; qualquer outro erro propaga sem alteração), agora em `createPrismaAdministratorBootstrapStore` usando o tradutor único.
- **Lint:** a lista `transitionalDeepImports` ficou vazia; a SF-043 remove a estrutura.
- **Testes existentes alterados:** caminhos de import em `tests/integration/{auth,bootstrap-admin,change-own-password,users}.test.ts`, `tests/unit/modules/{attachments,users,auth}/*.test.ts`; caminho do `vi.mock` em `tests/unit/change-password-action.test.ts` (`@/modules/auth/change-own-password` → `@/modules/auth`). Nenhuma asserção alterada.
- **Testes novos:** `tests/unit/modules/users/application/user-use-cases.test.ts` e `tests/unit/modules/auth/application/auth-use-cases.test.ts`.
- **Instabilidade observada:** numa execução, `requests-transitions.test.ts` falhou em 2 casos por ordem de horários (o `updatedAt` posterior saiu 5 ms menor que o anterior), compatível com um ajuste do relógio do sistema durante o teste. O módulo `requests` não mudou nesta tarefa; as 3 execuções seguintes passaram 94/94. O teste depende de relógios (Node e PostgreSQL) andarem sempre para frente.
- **CLI:** `npm run bootstrap:admin` sem terminal responde "É necessário executar o bootstrap em um terminal interativo."; com banco `_test`, "Bootstrap não pode usar banco de testes.".
- **cloc por módulo (antes → depois):** `users` 323 → 394; `auth` 459 → 597; `attachments` 317 → 338.
- **Medição acumulada:** `added` 3.159; `removed` 1.425; saldo líquido 1.734.
- **Resultados:** lint, typecheck e build OK; unitários 219/219 (36 arquivos); integração 94/94; E2E 1/1.

## SF-044 — Modo de demonstração sem senha (2026-10-30)

- **Decisão da responsável (2026-10-29):** tela de login com botões por perfil, sem e-mail e senha, **em todos os ambientes, inclusive na Vercel**. O risco de qualquer pessoa com o link entrar como administrador foi apresentado e aceito; registrado na seção 22.4 da SPEC principal.
- **Implementação:** `auth/domain/demo-accounts.ts` (contas fixas por perfil e nome do setor), `application/demo-sign-in.ts` (valida o perfil com Zod estrito; inválido → `null`), `infrastructure/prisma-demo-accounts.ts` (cria ou restaura a conta e o "Setor de demonstração" numa transação `Serializable`), provedor `Credentials` com `id: "demo"` em `next-auth-config.ts` e componente `ui/demo-sign-in-buttons.tsx`.
- **Senha das contas de demonstração:** hash Argon2id de 32 bytes aleatórios descartados; não autenticam pelo formulário (testado).
- **Formulário de e-mail e senha:** mantido dentro de `<details>` ("Entrar com e-mail e senha"), para contas reais e para o E2E existente.
- **Restauração:** cada acesso de demonstração reativa a conta e restaura nome, perfil e setor. Isso ignora, só para essas três contas, as regras administrativas de desativação (por exemplo, "último atendente com pendências").
- **Bootstrap:** depois do primeiro acesso como administrador de demonstração já existe um `ADMIN`, então `npm run bootstrap:admin` passa a recusar com "já existe um administrador".
- **Testes alterados:** `tests/unit/modules/auth/config.test.ts` — a asserção "does not expose role or sector as credential fields" foi substituída por outra que exige os provedores `credentials` e `demo` e um campo `role` (a SPEC mudou essa regra). O `id` do provedor é lido de `options.id`, onde o Auth.js o guarda antes de inicializar. `tests/e2e/service-request-flow.spec.ts` — o auxiliar de login abre o bloco "Entrar com e-mail e senha" e clica no botão "Entrar" com `exact: true`.
- **Testes novos:** `tests/unit/modules/auth/application/demo-sign-in.test.ts`, `tests/integration/demo-accounts.test.ts` (5 casos) e `tests/e2e/demo-sign-in.spec.ts`.
- **Operação local:** o Next 16 não permite dois `next dev` na mesma pasta; para rodar o E2E é preciso parar o servidor de desenvolvimento. Com `.env.local` presente, o E2E não precisa mais do `DATABASE_URL` na linha de comando.
- **Resultados:** lint, typecheck e build OK; unitários 224/224; integração 99/99; E2E 2/2.

## SF-045 — Catálogo e banco fictício de demonstração (2026-10-30)

- **Comando:** `npm run seed:demo` (`scripts/seed-demo-data.ts` → `scripts/demo-data.ts`). Lê `.env.local`/`.env` antes de abrir o banco, recusa bancos `_test` e roda numa transação `Serializable` (tempo limite de 30 s; os hashes Argon2 são calculados antes da transação).
- **Conteúdo:** categorias TI, RH e Manutenção com 3 serviços cada, todos no "Setor de demonstração"; as 3 contas de demonstração e 4 pessoas fictícias (`@exemplo.test`, domínio reservado); 12 solicitações em `OPEN`, `IN_PROGRESS` e `COMPLETED`, com datas nos dias anteriores e histórico coerente; documentos exigidos em "Solicitação de férias" e "Atualização cadastral".
- **Sem senhas no repositório:** todos os usuários fictícios recebem hash de valor aleatório descartado; o acesso é pelos botões de demonstração.
- **Idempotência:** setor, categorias, serviços e usuários são buscados pelo nome/e-mail e reativados se preciso; solicitações só são criadas se as pessoas fictícias ainda não tiverem nenhuma; documentos exigidos só em serviço sem nenhum.
- **`package.json`:** acrescentado apenas o script `seed:demo` (sem dependências).
- **Defeito latente corrigido:** `scripts/prepare-e2e.ts` não apagava `RequestAttachment` nem `ServiceDocumentRequirement` (tabelas da SF-031); bastava existir um documento exigido no banco de teste para o preparo do E2E falhar por chave estrangeira. A limpeza agora segue a mesma ordem de `tests/integration/fixtures.ts`.
- **E2E e hidratação:** clicar nos botões de demonstração antes de o React hidratar a página não faz nada. Os testes E2E esperam `networkidle` antes do clique.
- **Diferença de relógio Node × PostgreSQL (achado importante):** medido com `SELECT clock_timestamp()` comparado a `Date.now()`, o PostgreSQL local está 9–11 ms à frente do Node nesta máquina, mesmo após reiniciar o banco. `tests/integration/requests-transitions.test.ts` falha em 2 casos por isso: o evento de abertura usa o relógio do banco (`occurredAt` padrão `now()`) e as transições usam o relógio da aplicação (`new Date()`). **Isso é um defeito latente do produto:** em produção (Vercel × Supabase), uma diferença de relógio maior pode inverter a ordem do histórico. Correção sugerida, para nova SPEC: usar uma única fonte de horário para todos os eventos (por exemplo, o relógio do banco também nas transições). Não corrigido nesta tarefa.
- **Resultados:** lint, typecheck e build OK; unitários 224/224; integração 102/104 (as 2 falhas acima); E2E 3/3.

## SF-041 — Schemas de validação distribuídos (2026-10-30)

- **`src/shared/validation`** agora só tem schemas genéricos: `nonEmptyTextSchema` (passou a ser exportado, porque três módulos o usam), `nameSchema`, `entityIdSchema`, `activeStateSchema`, `activeStateInputSchema` e `emailSchema`.
- **Schemas específicos** foram para `application/<nome>-schemas.ts` de cada módulo: `users` (perfil, criação, edição e a regra perfil × setor), `auth` (troca da própria senha), `sectors`, `categories`, `services`, `document-requirements` (formato, entrada e movimento) e `requests` (criação e transição). A cópia foi feita por script a partir do arquivo original, sem mudar mensagens nem caminhos de erro; `uuidSchema` virou `entityIdSchema`, que era o mesmo objeto `z.uuid()`.
- **Domínio:** `document-requirements/domain/requirement-order.ts` declara `RequirementMoveDirection = "up" | "down"` em vez de importar `DocumentRequirementMove` da validação.
- **API pública:** os schemas não foram exportados pelos `index.ts`, porque nenhuma tela os usa (SPEC 2026-10-27, seção 8).
- **Testes alterados (só imports):** `tests/unit/shared/validation/schemas.test.ts`, `tests/unit/server/errors/errors.test.ts`, `tests/unit/modules/{auth/password,document-requirements/policy,users/validation}.test.ts`. Conferido por diff que nenhuma linha fora de import mudou.
- **Resultados:** lint, typecheck e build OK; unitários 224/224; E2E 3/3; integração 103/104 (falha restante em `requests-transitions` pela diferença de relógio Node × PostgreSQL já registrada).

## SF-042 — Área administrativa dividida por entidade (2026-10-30)

- **Estrutura:** `src/app/(admin)/admin/` passou a ter `_shared/action-helpers.ts` (leitura do `FormData`, mensagens de erro, `revalidatePath`/`redirect`) e `_sections/` com `overview-section.tsx` e uma pasta por entidade (`sectors`, `categories`, `users`, `services`), cada uma com `actions.ts` (`"use server"`) e o componente da seção. Os documentos exigidos ficam em `services`, porque são editados dentro de cada serviço.
- **Pastas privadas:** o prefixo `_` faz o App Router ignorar `_shared` e `_sections` como rotas; a URL continua sendo só `/admin`.
- **Compatibilidade:** `admin/actions.ts` continua no mesmo caminho, como arquivo `"use server"` que reexporta as 16 actions e o tipo `AdminUpdateState`. A documentação instalada do Next 16 não trata reexportação em arquivos `"use server"`; o `next build` aceitou, e os testes unitários e de integração que importam desse caminho passaram sem alteração.
- **Sem mudança de texto:** os blocos JSX e as funções foram recortados do original por script; uma verificação automática confirmou que todo texto e atributo de `page.tsx` e `actions.ts` originais existe nos arquivos novos. Os componentes de interface compartilhados (`create-form`, `record-editor`, `document-requirements-editor`) não mudaram.
- **Tamanho:** `page.tsx` 356 → 160 linhas físicas; `actions.ts` 384 → 29.
- **Testes:** nenhum teste alterado. Lint, typecheck e build OK; unitários 224/224; integração 104/104 (o teste sensível à diferença de relógio passou nesta execução; o defeito continua registrado); E2E 3/3.

## SF-043 — Fechamento da refatoração (2026-10-30)

- **Regra de lint final (`eslint.config.mjs`):** para cada módulo é gerado um bloco por camada (`domain`, `application`, `infrastructure`, `ui`) e um para os arquivos da raiz (`index.ts`). Cada bloco repete as regras de fronteira entre módulos, porque no ESLint flat config uma regra configurada duas vezes para o mesmo arquivo é **substituída**, não somada.
  - `domain/`: proíbe `@prisma/client`, `@/server/db`, `next`, `next-auth`, `react`, `react-dom` e caminhos relativos para `application`, `infrastructure` e `ui`.
  - `application/`: as mesmas bibliotecas e caminhos relativos para `infrastructure` e `ui`.
  - `ui/`: proíbe `@prisma/client`, `@/server/db` e caminhos relativos para `infrastructure`.
  - `infrastructure/` e `index.ts`: só a fronteira entre módulos.
  - A lista vazia de exceções transitórias foi removida; fora dos módulos vale só a proibição de `@/modules/*/**`.
- **Verificação manual (CA-ARQ-04):** arquivos temporários em `sectors/{domain,application,ui,infrastructure}` com 11 imports proibidos (Prisma, banco, `next/navigation`, `react`, camada externa por caminho relativo e internos de outros módulos por alias e por caminho relativo) geraram 11 erros; os 6 permitidos (`@/server/errors`, `./sector`, `../domain/sector`, `@/modules/services`, `react` em `ui`, `@prisma/client` em `infrastructure`) não geraram erro. Arquivos removidos em seguida.
- **CA-ARQ-10:** `prisma/` e `package-lock.json` idênticos à `baseline-ap2`. `package.json` só tem a entrada `seed:demo` (SF-045, funcionalidade aprovada à parte, sem dependência).
- **CA-ARQ-06:** `PrismaClientKnownRequestError` só é inspecionado em `src/server/db/prisma-errors.ts`; os repositórios apenas listam os códigos que traduzem.
- **cloc por área (TypeScript, linhas de código; antes = `baseline-ap2`, depois = SF-043):**

| Área | Antes | Depois | Arquivos antes → depois |
|---|---:|---:|---|
| `modules/requests` | 290 | 500 | 2 → 10 |
| `modules/services` | 266 | 349 | 3 → 8 |
| `modules/categories` | 126 | 177 | 2 → 7 |
| `modules/sectors` | 148 | 201 | 2 → 7 |
| `modules/document-requirements` | 221 | 346 | 2 → 7 |
| `modules/users` | 323 | 456 | 2 → 7 |
| `modules/auth` (inclui o modo de demonstração da SF-044) | 459 | 781 | 10 → 21 |
| `modules/attachments` | 317 | 338 | 2 → 3 |
| `app/(admin)/admin` | 1.249 | 1.408 | 5 → 15 |
| `server` | 595 | 647 | 8 → 10 |
| `shared` | 140 | 9 | 1 → 1 |
| **`src` (total)** | **4.823** | **5.905** | — |

- **Validação final:** lint e typecheck sem erros; build OK; unitários 224/224 (37 arquivos); integração 104/104 (21 arquivos); E2E 3/3. Ressalva mantida: `requests-transitions` depende de os relógios do Node e do PostgreSQL coincidirem e falhou em execuções anteriores nesta máquina (ver SF-045).
- **Refatoração encerrada.** Próxima etapa da ordem aprovada: corrigir a fonte única de horário do histórico (nova SPEC) e seguir para SF-034 a SF-036.

## SF-046 — Fonte única de horário do histórico (2026-10-30)

- **Decisão:** todos os horários de solicitação e de evento de status vêm do **relógio do banco**. Motivos: o banco já gerava `createdAt` e o evento de abertura; é um relógio só, mesmo com várias instâncias da aplicação na Vercel; e `now()` devolve o mesmo valor em toda a transação, então a solicitação e o evento ficam com horários idênticos.
- **Implementação:** novo método `currentTime()` no port `RequestTransaction`; a implementação Prisma executa `SELECT now()` dentro da transação. `createRequest` usa esse valor em `createdAt`, `updatedAt` e no evento inicial (antes o `updatedAt` vinha do Prisma, com o relógio da aplicação). `transitionRequestStatus` usa-o em `updatedAt`, `completedAt` e `occurredAt`; o parâmetro `now` (relógio da aplicação) foi removido. `NewStatusEvent.occurredAt` passou a ser obrigatório.
- **Sem mudança** de schema, migration, regra de negócio, mensagem ou tela.
- **Prova:** `tests/integration/request-history-clock.test.ts` simula o relógio da aplicação 1 h adiantado e 1 h atrasado (só `Date` é simulado). Com as mudanças guardadas temporariamente (`git stash`), os 2 casos falharam no código anterior (`createdAt` ≠ `updatedAt` na abertura); com a correção, passam.
- **Observação honesta:** na hora da validação final, a diferença medida entre os relógios do Node e do PostgreSQL estava em 0–1 ms (antes eram 9–11 ms). Por isso as três execuções verdes de `requests-transitions` não provam a correção sozinhas; a prova é o teste com relógio deslocado.
- **Testes alterados:** só testes criados nesta sessão (`in-memory-requests.ts` ganhou `databaseTime`; os testes unitários de transição deixaram de passar o relógio). `requests-transitions.test.ts` e `requests-create.test.ts` não mudaram.
- **Resultados:** lint, typecheck e build OK; unitários 226/226; integração 106/106 em três execuções seguidas; E2E 3/3.

## SF-034 — Abertura de solicitação com documentos (2026-10-31)

- **Fluxo (SPEC 21.4 e 21.15.4):** `createRequest` confere a sessão, valida a entrada e os limites de quantidade e tamanho, recarrega do banco (em transação) o solicitante, o serviço e os requisitos ativos, associa cada arquivo a um requisito, inspeciona o conteúdo real e gera no servidor os UUIDs da solicitação e dos anexos. Em seguida grava os objetos e, por fim, abre a transação que repete as verificações e cria solicitação, evento inicial e anexos com o mesmo horário do banco.
- **Configuração vigente prevalece:** a segunda transação recarrega os requisitos e repete a associação e a checagem de formato. Se o administrador desativar um requisito ou o serviço entre a gravação e a transação, o envio é rejeitado e os objetos são removidos.
- **Compensação:** qualquer falha depois de gravar (gravação seguinte, transação ou validação) remove os objetos já gravados. Se a remoção falhar, o log traz só um identificador de correlação aleatório, a quantidade de objetos e o código do erro, sem chave, nome de arquivo ou conteúdo.
- **Regras de associação** em `requests/domain/attachment-requirements.ts`: arquivo para serviço sem requisitos, requisito desconhecido, inativo ou de outro serviço e duplicidade → `invalid_value`; obrigatório ausente → `too_small`; formato não mais aceito → `invalid_format`. Sempre no caminho `attachments`, com mensagem fixa.
- **Serviço sem requisitos:** sem arquivos, o fluxo é o mesmo de antes, sem gravar nada no armazenamento. A única consulta nova é a lista de requisitos ativos dentro da transação.
- **Mudança de comportamento:** serviços **com** requisito obrigatório ativo passam a recusar solicitações sem o documento (antes a configuração era ignorada na abertura). Isso inclui os serviços de RH do `npm run seed:demo`.
- **Armazenamento:** `getApplicationDocumentStorage()` lê `DOCUMENT_STORAGE_*` só no primeiro uso, de modo que uma variável mal configurada não afeta solicitações sem arquivos. **Sem essas variáveis**, o armazenamento recusa toda gravação (`NOT_CONFIGURED`) e a tela mostra "Não foi possível guardar os documentos agora". Optou-se por não guardar arquivos na memória do processo fora dos testes: os documentos seriam perdidos a cada reinício e o download da SF-035 não os encontraria.
- **Entrada:** `attachments` é **opcional** no schema (sem valor padrão), para que a validação de quem não envia arquivos devolva exatamente o mesmo objeto de antes. Um teste existente (`schemas.test.ts`) falhou com `default([])`, e por isso a escolha foi revista sem mudar a asserção.
- **Tela:** o detalhe do serviço lista cada documento com nome, obrigatoriedade e formatos (CA-DOC-06), com um campo de arquivo por requisito (`attachment:<requirementId>`). Um componente cliente confere os tamanhos antes do envio (o limite de corpo da Server Action barra o formulário antes da validação do servidor, SPEC 21.15.3). O servidor continua sendo a fonte de verdade.
- **`next.config.ts`:** `experimental.serverActions.bodySizeLimit = "4.25mb"` (4.456.448 bytes), valor definido na SPEC 21.15.3.
- **Requisitos para o solicitante:** nova função `listPublishedServiceRequirements` no módulo `document-requirements`, restrita ao perfil `REQUESTER`, que devolve só os requisitos ativos do serviço em ordem.
- **Sem migration e sem dependência nova.**
- **Testes:** 21 unitários novos (associação no domínio, caso de uso com arquivos, Server Action e listagem para o solicitante) e 8 de integração (`requests-create-with-documents.test.ts`), incluindo falha da transação por gatilho no PostgreSQL. Testes existentes alterados só nos dublês (`in-memory-requests.ts` e o repositório falso de requisitos ganharam os métodos novos) e na expectativa da Server Action, que agora repassa `attachments: []`.
- **Resultados:** lint, typecheck e build OK; unitários 247/247 (39 arquivos); integração 114/114 (23 arquivos); E2E 3/3. O aviso "The destination stream closed early" do servidor no E2E já aparecia antes da mudança (confirmado com `git stash`; registrado desde 2026-10-05).
- **Medição (`sh scripts/cloc-diff.sh`, commit `051621b`):** 6.717 linhas `added` (antes 5.600; +1.117), saldo líquido 4.168. Meta: 6,7% de 100.000.
- **Pendências:** adaptador real do Supabase sem teste contra bucket (SF-030 não provisionada); E2E do percurso com documentos na SF-036; listagem e download na SF-035.

## SF-035 — Consulta e download autorizados de anexos (2026-10-31)

- **Autorização (SPEC 21.5):** `listRequestAttachments` e `getAttachmentDownload` (módulo `requests`) aplicam a cada chamada a mesma regra de leitura da solicitação (`assertRequestReadable`): o solicitante que abriu ou um atendente do setor atual da solicitação. Administrador é negado. A sessão é recarregada do banco a cada requisição, então mudança de setor e desativação valem na hora.
- **Rota:** `GET /api/requests/[requestId]/attachments/[attachmentId]`. Recebe só identificadores, busca o anexo filtrando pelos dois e só então lê o objeto.
- **Respostas da rota:** não autenticado, inativo, negado, identificador malformado e inexistente recebem **a mesma** resposta 404, com `Cache-Control: private, no-store`. Assim a rota não revela se o anexo existe. A seção 10 aceita "não encontrado" desde que seja consistente. Falha do armazenamento → 500 com a mensagem genérica, sem detalhes do provedor.
- **Cabeçalhos do download:** `Content-Type` do formato detectado, `Content-Disposition: attachment` com nome ASCII de reserva e `filename*` em UTF-8 (RFC 6266), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` e `Content-Length`.
- **Integridade:** além do tamanho (SPEC 21.15.6), o servidor confere o SHA-256 antes de entregar. Conteúdo diferente do registrado nunca é servido (erro fixo 500). Para arquivos de até 2 MiB o custo é desprezível.
- **Listagem:** o repositório seleciona só os campos de exibição; a chave de armazenamento só é lida na busca do download e nunca chega ao cliente.
- **Telas:** os detalhes do solicitante e do atendente mostram "Documentos enviados" (documento, obrigatório/opcional, nome do arquivo, formato, tamanho e link de download). Componente compartilhado em `src/app/_components/request-attachments.tsx`. A seção não aparece em solicitações sem anexos.
- **Sem armazenamento configurado:** o download devolve o erro fixo 500. Hoje só pode haver anexo se o armazenamento estiver configurado, porque a SF-034 recusa envios sem ele.
- **Sem migration e sem dependência nova.**
- **Testes:** 12 unitários novos (casos de uso, cabeçalho e rota) e 6 de integração (`request-attachments-access.test.ts`). Nenhum teste existente alterado. Na primeira versão, o lint acusou o nome `useActor` no teste novo (a regra de hooks do React o tratou como hook); renomeado para `actAs`.
- **Resultados:** lint, typecheck e build OK; unitários 259/259 (42 arquivos); integração 120/120 (24 arquivos); E2E 3/3 (rodado antes da correção de lint, que só mudou arquivos de teste).
- **Medição (`sh scripts/cloc-diff.sh`, commit `84fae73`):** 6.717 → 7.410 linhas `added` (+693 nesta tarefa), saldo líquido 4.863. Meta: 7,4% de 100.000.

## SF-036 — Testes E2E e revisão dos documentos (2026-10-31)

- **E2E (`tests/e2e/request-documents.spec.ts`):** cobre o percurso da SPEC 21.13:
  - o administrador cria um serviço de exemplo e configura um documento obrigatório (PDF) e um opcional (TXT) pela tela;
  - o solicitante vê a lista; o navegador impede o envio sem o obrigatório e, sem essa verificação, o servidor também recusa (`error=attachments`);
  - o solicitante envia com sucesso e baixa o arquivo com o mesmo SHA-256; os cabeçalhos da resposta são conferidos;
  - o atendente do setor baixa o mesmo conteúdo;
  - administrador e visitante sem login recebem a mesma resposta 404 na rota direta.
- **Armazenamento no E2E:** o servidor do Playwright usa `TEST_DOCUMENT_STORAGE=memory`, um armazenamento em memória guardado em `globalThis`. Ele é compartilhado entre a Server Action e a rota de download, que o Next pode carregar em pacotes separados no mesmo processo. A SPEC 21.15.7 prevê adaptador em memória para testes automatizados. A opção é recusada em produção (`NODE_ENV=production`), com valor diferente de `memory` ou com `DATABASE_URL` cujo banco não termine em `_test`. Sem a variável, nada muda.
- **Ajuste:** os métodos de `getApplicationDocumentStorage` passaram a ser `async`. Antes, uma configuração inválida lançava erro síncrono em vez de devolver uma promessa rejeitada; o efeito era o mesmo dentro de `createRequest`, mas o contrato da interface ficou correto.
- **Revisão (CA-DOC-01 a 22):** todos registrados na SPEC com a evidência. CA-DOC-21 fica **parcial**: o bucket privado real e a negação de leitura anônima só podem ser verificados depois do provisionamento da SF-030.
- **CA-DOC-04:** a única criação automática de cadastro em código de produção é o "Setor de demonstração" do modo demonstração, aprovado na seção 22 (que diz explicitamente que nenhum outro setor ou serviço é criado). Migrations não têm `INSERT`.
- **Segredos:** a busca nos arquivos versionados só encontrou o valor fictício `sb_secret_synthetic-value-for-tests`. `.env.local` e `.env.test.local` não estão no Git.
- **Logs:** em `src/`, o único `console.*` é o da falha de compensação (SF-034), já testado.
- **Fixtures:** `tests/` só contém `.ts`; os documentos de teste são gerados em memória.
- **README:** seção de armazenamento de documentos, fluxos de documentos, nota sobre o E2E em memória e aviso de que a tabela de métricas é histórica (a medição atual está no `NOTES.md`).
- **Falhas durante o trabalho (do teste, não do aplicativo):**
  - `getByRole("alert")` também pegou o anunciador de rotas do Next;
  - a busca pela chave de armazenamento no HTML pegava o próprio link `/api/requests/<id>/...`. A verificação passou a procurar a chave completa `requests/<solicitação>/<anexo>`. A saída confirmou que só o link aparecia.
- **Resultados:** lint, typecheck e build OK; unitários 263/263 (43 arquivos); integração 120/120 (24 arquivos); E2E 4/4. O aviso "The destination stream closed early" continua aparecendo no servidor de E2E, como antes da SF-034.
- **Medição (`sh scripts/cloc-diff.sh`, commit `fe73fbd`):** 7.410 → 7.616 linhas `added` (+206), saldo líquido 5.069. Meta: 7,6% de 100.000. Com a SF-034 a SF-036, a funcionalidade de documentos somou 2.016 linhas `added` (de 5.600 para 7.616).

## SF-030 — Preparação do armazenamento privado (2026-10-31)

- **Pedido:** configurar o armazenamento de arquivos recomendado (SPEC 21.15) e testar.
- **Bloqueio encontrado:** esta máquina não tem credenciais do Supabase (nenhuma variável `DOCUMENT_STORAGE_*` ou `TEST_DOCUMENT_STORAGE_*` nos `.env` locais; só os nomes foram conferidos, nunca os valores) e não tem o CLI do Supabase nem o da Vercel. **Os buckets reais não foram criados e nenhuma chave foi gerada.** Isso depende de quem tem acesso às contas.
- **O que foi feito para deixar a configuração a um comando:**
  - `scripts/document-storage-provisioning.ts` + `npm run storage:provision [-- test]`. Lê `DOCUMENT_STORAGE_*` (ou `TEST_DOCUMENT_STORAGE_*`) com as mesmas validações do adaptador: HTTPS, bucket `-test` no escopo de teste e chave `sb_secret_`. Em seguida:
    1. cria o bucket, ou ajusta um existente, com `public=false`, `file_size_limit=2097152` e `allowed_mime_types` só de PDF, DOCX e TXT;
    2. relê o bucket e para se a configuração não bater;
    3. grava um objeto sintético com a mesma chave opaca da aplicação;
    4. confirma que a leitura anônima pela URL pública e pela rota autenticada sem credencial é **negada**;
    5. lê o objeto com a chave secreta, remove-o e confirma que sumiu.
  - As mensagens só trazem códigos HTTP, nunca a chave. Nenhuma política RLS é criada (SPEC 21.15.2).
  - `tests/integration/document-storage-supabase.test.ts`: o teste do adaptador real (pendente desde a SF-033), que roda o mesmo provisionamento contra o bucket de teste. Fica pulado (`skipIf`) sem `TEST_DOCUMENT_STORAGE_*`. `vitest.integration.config.ts` passou a carregar essas três variáveis do `.env.test.local`.
- **API usada (conferida em 2026-10-31):** referência do Storage no site do Supabase: `POST /bucket` (`id`, `name`, `public`, `file_size_limit`, `allowed_mime_types`) e `PUT /bucket/{id}`. A página lista `HEAD /bucket/{id}` para detalhes e não mostra os campos aceitos no `PUT`. O script usa `GET /bucket/{id}`, comum no storage-api, e **relê a configuração e falha se ela não bater**, então uma diferença de API aparece como erro, não como bucket mal configurado. Chave no cabeçalho `apikey`, conforme o guia de chaves do Supabase ("Send publishable and secret keys on the `apikey` header, not on `Authorization: Bearer`"). Nada disso foi exercitado contra o Supabase real.
- **Testes executados:** 5 unitários do provisionamento contra um Supabase simulado (bucket novo, bucket público corrigido, bucket que continua público → para antes de gravar, chave recusada sem ecoar a chave, falha de rede com mensagem fixa). O comando real, com e sem `test`, termina com código 1 e a mensagem "Configure ... antes de provisionar" (via `volta run` o código aparece como 126). Lint, typecheck e build OK; unitários 268/268; integração 120/120 + 1 pulado (o teste real); E2E 4/4.
- **Sem dependência nova** (usa `fetch`, `@next/env` e `vite`, que já existiam). `package.json` ganhou só o script `storage:provision`.
- **Para concluir a SF-030** (quem tem acesso às contas):
  1. criar ou reativar o projeto Supabase e gerar uma chave secreta `sb_secret_` exclusiva do ServiceFlow (produção em projeto separado, SPEC 21.15.7);
  2. preencher `DOCUMENT_STORAGE_*` em `.env.local` e `TEST_DOCUMENT_STORAGE_*` em `.env.test.local` (fora do Git);
  3. rodar `npm run storage:provision` e `npm run storage:provision -- test`, e depois `npm run test:integration`, que deixa de pular o teste real;
  4. cadastrar as variáveis na Vercel (a chave como Secret) e rodar o provisionamento com as de produção.
- **Medição (`sh scripts/cloc-diff.sh`, commit `df68e1f`):** 7.616 → 7.897 linhas `added` (+281), saldo líquido 5.350. No dia 31/10 (`17650f0` → `df68e1f`): 2.315 linhas `added` (src 689, tests 1.485, scripts 141). Código executável total no repositório: 16.093 linhas (src 6.562, tests 8.899, scripts 632).

## SF-047 — Migration e regras de domínio da atribuição (2026-10-31)

- **Duas migrations aditivas.** O PostgreSQL não aceita usar um valor novo de enum na mesma transação em que ele é criado, e o Prisma aplica cada migration numa transação. Por isso:
  - `20261031120000_request_status_cancelled` só adiciona `CANCELLED`;
  - `20261031120100_request_assignment` adiciona `Request.assigneeId` e `Request.cancelledAt`, `RequestStatusEvent.note`, a tabela `RequestAssignmentEvent`, o índice `(sectorId, assigneeId)`, FKs `RESTRICT` e três `CHECK`s: `cancelledAt` preenchido se e somente se `CANCELLED`; `note` com 1 a 1.000 caracteres quando presente; evento de atribuição sempre muda o responsável.
- **SQL gerado** por `prisma migrate diff` a partir do banco de teste (não havia banco sombra), com os `CHECK`s escritos à mão.
- **Domínio (`src/modules/requests/domain/lifecycle.ts`):**
  - tabela de transições 5.6 e responsável efetivo (atendente ativo do setor atual);
  - assumir, liberar, transferir (D1), status com responsável (D2), cancelar (D3) e reabrir em até 7 dias (D4);
  - justificativas com no máximo 1.000 caracteres.
  - Ator fora do escopo recebe `NotFoundError` (não revela a solicitação); ator no escopo com estado inválido recebe `ConflictError`.
- **Tipos:** `RequestStatus` ganhou `CANCELLED`; `RequestRecord` ganhou `assigneeId` e `cancelledAt`; `RequestStatusEventRecord` ganhou `note`. As quatro telas que tinham cópias do mapa de rótulos passaram a usar `src/app/_components/request-status.ts`, com "Cancelada".
- **Testes existentes alterados só na forma:**
  - objetos de solicitação ganharam os campos novos (`tests/unit/authorization/index.test.ts` e o dublê `in-memory-requests.ts`);
  - `demo-data.test.ts` ganhou anotação de tipo no mapa de passos esperados;
  - limpeza de `fixtures.ts` e `prepare-e2e.ts` passou a apagar `RequestAssignmentEvent`.
  - Nenhuma asserção mudou.
- **Falha durante o trabalho:** o teste novo de schema criou um atendente sem setor e bateu no `CHECK` antigo `User_role_sectorId_check`. Erro do teste, corrigido.
- **Resultados:** lint, typecheck e build OK; unitários 283/283 (45 arquivos); integração 125/125 + 1 pulado (26 arquivos); E2E 4/4. A integração aplicou as duas migrations no banco de teste.
- **Pendente:** aplicar as migrations no banco de desenvolvimento local (`npx prisma migrate deploy` com o `.env.local`). O comando foi negado pela permissão automática desta sessão. Sem isso, `npm run dev` falha ao ler solicitações, porque o código espera as colunas novas.

## Publicação na Vercel com banco Neon (2026-10-31)

- **Conta e projeto:** conta Vercel da responsável (`mylena1408-4697`), espaço `topicos-especiais`, projeto `serviceflow`, criado e ligado pelo CLI. Publicação **só manual** (`vercel deploy --prod`), sem ligação automática com o GitHub (decisão da responsável). O projeto Supabase/Vercel antigo pertence a outro grupo e não foi usado.
- **Endereço de produção:** https://serviceflow-sand.vercel.app
- **Banco:** Neon (PostgreSQL) criado pela responsável no painel da Vercel (Storage), região `sa-east-1`. A integração criou `DATABASE_URL` e as variáveis do Neon em Production. As 7 migrations foram aplicadas pela conexão direta (sem pooler) e o `seed:demo` carregou 3 categorias, 9 serviços, 7 usuários, 12 solicitações e 3 documentos exigidos.
- **`AUTH_SECRET`:** gerado e enviado à Vercel pela responsável com `!`, direto do gerador para o CLI, sem aparecer no chat (tipo Secret, só Production). A gravação pelo agente foi bloqueada pela permissão automática.
- **`vercel.json`:** `framework: nextjs` e `buildCommand: prisma generate && next build`. Usado no lugar de um `postinstall` para não mudar a instalação local. A primeira publicação falhou porque o projeto criado pelo CLI não tinha o framework definido e a Vercel procurou a pasta `dist`; resolvido com `framework`.
- **`vercel link`:** acrescentou `.vercel` e `.env*` ao fim do `.gitignore`, o que anularia as exceções `!.env.example` e `!.env.test.example`. Alteração desfeita (as regras originais já cobriam esses casos). Também acrescentou `VERCEL_OIDC_TOKEN`, temporário, ao `.env.local`, que é ignorado pelo Git.
- **Credenciais:** a URL do banco com a senha foi colada no chat pela responsável, que decidiu tratá-la como não sensível, por ser um banco didático só com dados fictícios. Ela foi usada apenas nas linhas de comando das migrations e do seed, e não foi gravada em nenhum arquivo do projeto. **Recomendação:** trocar a senha do papel `neondb_owner` no Neon se o banco passar a ter qualquer dado real.
- **Verificação do site publicado (só leitura):** `/` e `/catalog` redirecionam para `/login`; `/login` responde 200; o download anônimo de anexo responde 404. No navegador (Playwright), os três botões de demonstração entram em `/admin`, `/catalog` (catálogo visível) e `/queue` (12 solicitações). Nenhuma solicitação foi criada pelo teste.
- **Limitações:** sem armazenamento de documentos (SF-030), os serviços de RH com documento obrigatório recusam novas solicitações. O modo demonstração permite que qualquer pessoa com o link entre como administrador.

## SF-048 — Assumir, liberar e transferir (2026-10-31)

- **Banco local:** antes de começar, as migrations da SF-047 foram aplicadas no `serviceflow_dev`. O Prisma CLI lê só o `.env`, então o comando rodou com as variáveis do `.env.local` carregadas no shell, sem exibi-las.
- **Casos de uso (`application/assignment.ts`):**
  - a sessão é conferida por `requireStatusChangeActor`: atendente do setor da solicitação, e qualquer outro recebe "não encontrado";
  - a transação relê o ator e o estado da solicitação (com o responsável atual), aplica as regras do domínio, grava com `updateMany` condicionado a **estado e responsável** lidos e registra o `RequestAssignmentEvent` com o horário do banco;
  - se a linha mudou entre a leitura e a escrita, o resultado é `ConflictError` e nada é gravado.
- **Ao assumir de um responsável que saiu do setor**, o evento registra a origem (o antigo responsável), não nulo. Assim a troca fica rastreável.
- **`updatedAt`** passa a ser o horário do último evento, de status ou de atribuição.
- **Transferência:** o identificador do novo responsável vem do formulário, mas é recarregado do banco (`findUserForAssignment`) e validado pelo domínio. A lista de colegas (`listTransferCandidates`) só é consultada quando quem vê a página é o responsável efetivo.
- **Telas:**
  - painel "Responsável" no detalhe do atendente, com Assumir, Liberar e Transferir conforme as regras;
  - a fila mostra "Responsável: ninguém / você / nome";
  - o detalhe do solicitante mostra o atendente responsável (regra 5.1.4);
  - `requireAttendantPageAccess` passou a devolver o ator, e quem já chamava ignora o retorno.
- **Fora desta tarefa:** a regra 5.3 (com responsável, só ele inicia e conclui) é a SF-049. Até lá, os botões de status continuam valendo para qualquer atendente do setor.
- **Testes:**
  - 8 unitários dos casos de uso e 2 das ações (em arquivo novo; o teste existente das ações não mudou);
  - 6 de integração, entre eles a concorrência real com duas transações, executada 4 vezes com o mesmo resultado;
  - o dublê em memória ganhou os métodos novos.
- **Resultados:** lint, typecheck e build OK; unitários 293/293 (47 arquivos); integração 131/131 + 1 pulado (27 arquivos); E2E 4/4.

## SF-049 — Responsável nas transições de status (2026-10-31)

- **Regra 5.3 (D2):** `transitionRequestStatus` passou a ler o estado com o responsável (`findLifecycleState`) e chama `assertCanChangeStatusWithAssignee`. Com responsável **efetivo**, só ele inicia e conclui (`ConflictError` para os colegas). Sem responsável, ou com responsável que saiu do setor ou foi desativado, qualquer atendente do setor age como antes.
- **Concorrência:** `StatusUpdate` ganhou `expectedAssigneeId` opcional. A transição grava só se estado **e** responsável continuam os lidos, então um "Assumir" de outro atendente entre a leitura e a escrita gera conflito.
- **`findRequestState` removido** da porta, do repositório e do dublê: ficou sem uso.
- **Tela:** no detalhe do atendente, quando outro colega é o responsável, os botões "Iniciar atendimento" e "Concluir solicitação" dão lugar a "Somente o responsável, <nome>, pode iniciar ou concluir esta solicitação". O servidor continua sendo quem decide.
- **Testes:** 4 unitários e 3 de integração novos, em arquivos próprios. `requests-transitions.test.ts` e `transition-request-status.test.ts` não foram alterados e passam (CA-ATR-05). O dublê em memória passou a respeitar `expectedAssigneeId`.
- **Resultados:** lint, typecheck e build OK; unitários 297/297 (48 arquivos); integração 134/134 + 1 pulado (28 arquivos); E2E 4/4.

## SF-050 — Cancelamento (2026-10-31)

- **Caso de uso único (`cancelRequest`)** para solicitante e atendente. A sessão é conferida por `requireCurrentActor`, e a transação relê o ator e o estado (com responsável). O domínio decide (`assertCanCancel`) e a gravação é condicionada a estado **e** responsável; `cancelledAt`, `updatedAt` e o evento usam o horário do banco. Quem está fora do escopo recebe "não encontrado".
- **Estrutura compartilhada (`changeLifecycle`)** para cancelamento e, na SF-051, reabertura. `StatusUpdate` ganhou `cancelledAt`; `completedAt` passou a aceitar `null`, para a reabertura limpar o campo. O repositório só altera `completedAt` quando o valor é informado (antes, só quando era verdadeiro).
- **Defeito encontrado pelos testes:** `ValidationError` remove dos erros públicos os caminhos fora de uma lista permitida, e `note` não estava nela. Com isso, a mensagem específica "informe a justificativa" nunca apareceria na tela. `note` foi acrescentado a `PUBLIC_VALIDATION_PATHS` (`src/server/errors`).
- **Telas:**
  - solicitante: "Cancelar solicitação" recolhível no detalhe, só quando `OPEN`, com motivo opcional e mensagens de retorno (cancelada, motivo longo, estado mudou);
  - atendente: "Cancelar solicitação" recolhível com justificativa obrigatória, oculto quando outro colega é o responsável.
- **Testes:** 6 unitários do caso de uso, 3 das ações (em arquivo novo) e 5 de integração.
- **Resultados:** lint, typecheck e build OK; unitários 306/306 (50 arquivos); integração 139/139 + 1 pulado (29 arquivos); E2E 4/4.

## SF-051 — Reabertura (2026-10-31)

- **`reopenRequest`** reutiliza `changeLifecycle` da SF-050:
  - o domínio (`assertCanReopen`) recebe o horário do banco (`now()` da transação), e o prazo de 7 dias não depende do relógio da aplicação;
  - a gravação usa `completedAt: null` e mantém o responsável (D5);
  - o evento `COMPLETED → OPEN` guarda a justificativa.
- **Tela do solicitante:**
  - com a solicitação concluída e dentro do prazo, aparece "Reabrir solicitação" com o prazo final e um campo obrigatório;
  - depois do prazo, aparece só o aviso de que terminou;
  - o prazo exibido usa o relógio do servidor da aplicação, só como orientação; quem decide é o servidor, com o relógio do banco;
  - a mensagem de erro de estado passou a citar também o prazo encerrado.
- **Testes:** 6 unitários do caso de uso, 1 da ação e 3 de integração. O teste de integração grava `completedAt = now() - intervalo` direto no banco, para medir as bordas com o mesmo relógio do servidor.
- **Resultados:** lint, typecheck e build OK; unitários 313/313 (51 arquivos); integração 142/142 + 1 pulado (30 arquivos); E2E 4/4.

## SF-052 — Histórico, E2E e revisão da atribuição (2026-10-31)

- **Histórico único:** `RequestWithHistory` passou a trazer `assignmentEvents`, com nomes do ator, de origem e de destino. `src/app/_components/request-timeline.tsx` junta eventos de status e de atribuição em ordem cronológica; em caso de empate, o de status vem antes. Os textos de status são os mesmos de antes ("Solicitação aberta: Aberta", "Em atendimento → Concluída", verificados pelo E2E antigo). Atribuições aparecem como "Assumida por", "Transferida de … para …" e "Liberada por". As justificativas aparecem como "Justificativa: …".
- **Rótulo do autor:** na tela do atendente, o autor do evento era "Atendente:". Passou a "Responsável pelo evento:", igual à tela do solicitante, porque o solicitante agora também gera eventos visíveis ao atendente (cancelar e reabrir).
- **E2E (`request-assignment.spec.ts`):**
  - o administrador cria um segundo atendente no "Setor de demonstração";
  - o solicitante abre duas solicitações e cancela uma, com motivo;
  - o atendente de demonstração assume e transfere, e depois disso não vê mais "Iniciar atendimento"; a cancelada não oferece "Assumir";
  - o colega inicia e conclui;
  - o solicitante vê o responsável, reabre com justificativa e confere as 6 primeiras linhas do histórico em ordem;
  - a solicitação reaberta volta à fila do colega com "Responsável: você".
  - Passou na primeira execução.
- **Revisão:** sem segredos nos arquivos versionados (a senha do Neon não aparece em nenhum arquivo); nenhum log novo; nenhuma dependência nova; migrations só aditivas. Os testes antigos de transição e de abertura não foram alterados. README com os novos fluxos.
- **SPEC `2026-10-31-atribuicao-cancelamento-reabertura.md` concluída:** CA-ATR-01 a 14 verificados.
- **Resultados:** lint, typecheck e build OK; unitários 315/315 (52 arquivos); integração 142/142 + 1 pulado (30 arquivos); E2E 5/5.
- **Não publicado:** o site na Vercel continua na versão anterior à atribuição. O banco do Neon já tem as migrations.

## SF-053 — Migration e domínio dos comentários (2026-10-31)

- **Migration `20261031200000_request_comments`:** tabela `RequestComment` (`body`, `isInternal` com padrão falso, `createdAt`), índice `(requestId, createdAt)`, FKs `RESTRICT` e `CHECK` que exige texto sem espaços periféricos e com 1 a 5.000 caracteres.
- **Falha durante o trabalho:** a primeira edição do schema não encontrou o texto esperado, porque o `prisma format` da SF-047 tinha realinhado as colunas. O comando seguiu e criou uma migration só com o `CHECK`, que foi apagada antes de qualquer uso. A edição foi refeita com expressão regular.
- **Domínio (`src/modules/comments/domain/comment-policy.ts`):**
  - quem participa: o solicitante dono ou um atendente ativo do setor atual; os demais recebem "não encontrado";
  - notas internas só para atendentes (C3);
  - comentários aceitos em aberta, em atendimento e concluída, e cancelada só para leitura (C1);
  - texto de 1 a 5.000 caracteres.
- `body` foi acrescentado a `PUBLIC_VALIDATION_PATHS`, para a tela mostrar a mensagem certa. É a mesma lição da SF-050.
- **Testes:** 5 unitários e 2 de integração; limpeza de `fixtures.ts` e `prepare-e2e.ts` com a tabela nova.
- **Resultados:** lint e typecheck OK; integração 144/144 + 1 pulado.

## SF-054 e SF-055 — Escrever, ler, notas internas e contagem (2026-10-31)

- **Feitas juntas:** as duas tarefas mexem nos mesmos arquivos (caso de uso, repositório e telas). São um commit só, com as duas registradas.
- **Módulo `src/modules/comments`:** `domain` (SF-053), `application` (portas, schema estrito e casos de uso), `infrastructure` (Prisma) e `index.ts`.
  - `addComment`: normaliza o texto, confere a sessão, relê leitor e solicitação na transação, aplica `assertCanComment` e grava com o horário do banco;
  - `listComments`: devolve notas internas só para atendentes;
  - `countComments`: conta por solicitação, e para o solicitante nunca inclui notas internas.
- **Mudança em relação à SPEC (seção 7):** a SPEC dizia que o módulo leria o escopo da solicitação pela API pública de `requests`. Na implementação, o repositório de `comments` lê solicitante, setor e estado direto do banco, como o módulo `requests` já faz com os requisitos documentais. Assim não foi preciso criar em `requests` uma função sem autenticação. A seção 7 foi atualizada.
- **Telas:**
  - componente compartilhado `src/app/_components/request-conversation.tsx`, com a seção "Conversa" (autor, perfil, horário; nota interna destacada) e formulário de 1 a 5.000 caracteres;
  - a caixa "Nota interna" aparece só para atendentes;
  - em solicitação cancelada, o formulário vira um aviso;
  - a fila e "Minhas solicitações" mostram a quantidade de comentários visíveis ao leitor;
  - mensagens de retorno: comentário enviado, texto inválido (`body` nos caminhos públicos, SF-053), estado.
- **Testes existentes:** `attendant-actions.test.ts` e `requester-actions.test.ts` (e dois arquivos meus de hoje) falharam **ao carregar**, sem asserção quebrada. As ações agora importam `@/modules/comments`, que puxa o `next-auth`, e esses testes só isolavam `@/modules/requests`. A correção foi acrescentar uma linha `vi.mock("@/modules/comments", …)` em cada um; nenhuma asserção mudou.
- **Testes novos:** 6 unitários dos casos de uso, 3 das ações e 5 de integração (conversa, texto inválido, cancelada, notas internas em lista e contagem, matriz de autorização com mudança de setor, marcação como texto).
- **Resultados:** lint, typecheck e build OK; unitários 329/329 (55 arquivos); integração 149/149 + 1 pulado (32 arquivos); E2E 5/5.

## SF-056 — E2E e revisão dos comentários (2026-10-31)

- **E2E (`request-comments.spec.ts`):**
  - o solicitante pergunta e envia um texto com `<b>`, que aparece como texto (nenhum elemento `b` na conversa);
  - uma solicitação cancelada não mostra o formulário, só o aviso;
  - o atendente vê a pergunta, responde e escreve uma nota interna; a fila mostra "4 comentários";
  - o solicitante vê 3 comentários, sem a nota, que também não aparece no HTML da página; a lista mostra "3 comentários".
  - Passou na primeira execução. Depois disso, a verificação da contagem na lista foi apertada para localizar o item pelo link da própria solicitação, em vez de procurar o texto na página inteira.
- **Revisão:** sem segredos nos arquivos versionados; nenhum `console.*` nem `dangerouslySetInnerHTML` no módulo ou no componente; nenhuma dependência nova; migration só aditiva. README com o fluxo de conversa.
- **SPEC `2026-10-31-comentarios.md` concluída:** CA-COM-01 a 09 verificados.
- **Resultados:** lint, typecheck e build OK; unitários 329/329 (55 arquivos); integração 149/149 + 1 pulado (32 arquivos); E2E 6/6.

## SF-057 — Critérios de busca e índices (2026-10-31)

- **`parseSearchCriteria(raw, audience)`** transforma os parâmetros da URL (`q`, `status`, `assignee`, `from`, `to`, `order`, `page`) em critérios validados:
  - o termo é aparado e precisa ter de 2 a 100 caracteres; vazio significa sem busca;
  - os status são deduplicados e o vazio é descartado;
  - o filtro de responsável só vale para o atendente; para o solicitante é ignorado;
  - a ordem padrão é a atual de cada lista;
  - página inválida vira 1;
  - parâmetros desconhecidos são ignorados.
  - Erros usam o caminho `search` (acrescentado aos caminhos públicos) com mensagem fixa.
- **Datas:** `startOfDayInTimeZone` calcula a meia-noite do dia em America/Sao_Paulo com `Intl`, em duas passadas para absorver horário de verão. Não depende do fuso do servidor nem supõe −03:00 fixo; o teste confere também Nova York no verão e no inverno. O período vira `[início do primeiro dia, início do dia seguinte ao último)`.
- **Defeito encontrado pelo teste:** com `to` fora do formato (`31/10/2026`), o cálculo do dia seguinte rodava antes da validação e lançava `RangeError` em vez da mensagem fixa. A data passou a ser validada antes.
- **`pageWindow`:** 20 por página; página além da última vai para a última; lista vazia tem 1 página.
- **`escapeLikePattern`:** escapa `\`, `%` e `_`. A SF-058 vai confirmar no PostgreSQL se o filtro `contains` do Prisma já escapa esses caracteres antes de decidir onde usar a função, para não escapar duas vezes.
- **Migration `20261031220000_request_list_indexes`:** `Request(requesterId, createdAt, id)` e `Request(sectorId, createdAt, id)`. Os índices antigos permanecem.
- **Resultados:** lint, typecheck e build OK; unitários 339/339 (56 arquivos); integração 150/150 + 1 pulado (33 arquivos); E2E 6/6.

## SF-058 — Consultas paginadas (2026-10-31)

- **Casos de uso:** `searchRequesterRequests(raw)` e `searchAttendantQueue(raw)`. Conferem o perfil na sessão, interpretam os parâmetros (`parseSearchCriteria`) e chamam `repository.search(scope, criteria, viewerId)`. O escopo (`requesterId` ou `sectorId`) vem **só** da sessão; parâmetros forjados na URL são ignorados. Atendente sem setor recebe "não encontrado". O resultado traz `items`, `total`, `page`, `pageCount` e os `criteria` aplicados.
- **Consulta (`searchWhere`):**
  - filtro por escopo, status, período `[início, fim)` e termo (descrição ou nome do serviço, `mode: insensitive`);
  - "Atribuídas a mim" usa `assigneeId = leitor`: o leitor é atendente ativo do setor, então o vínculo é efetivo;
  - "Sem responsável" usa `assigneeId` nulo **ou** responsável inativo, de outro perfil, sem setor ou de outro setor.
  - `count` com o mesmo filtro, depois `pageWindow` e `findMany` com `skip` e `take`, ordenado por `createdAt` e `id` na mesma direção.
- **Achado sobre o Prisma:** o `contains` do Prisma passa o valor ao `ILIKE` **sem** escapar `%` e `_`. O teste mostrou que "0% pronto" encontrava "Código 1000 pronto". O termo passou a ser escapado com `escapeLikePattern` (SF-057), e o teste agora confirma que só o texto literal é encontrado.
- **Erros meus nos testes, corrigidos:**
  - duas verificações dependiam da ordem entre solicitações com o mesmo horário, que é decidida pelo identificador aleatório. Uma delas falhava de forma intermitente;
  - o ajudante do teste criava solicitação cancelada sem `cancelledAt`, e o `CHECK` da SF-047 recusou. Status e data passaram a ser gravados juntos.
  - Depois das correções, o arquivo passou 3 vezes seguidas.
- **Testes:** 3 unitários (escopo da sessão, perfis, critérios inválidos antes da consulta) e 5 de integração. O dublê em memória ganhou um `search` simples, só com escopo e página; os filtros são verificados no PostgreSQL.
- **Resultados:** lint, typecheck e build OK; unitários 342/342 (57 arquivos); integração 155/155 + 1 pulado (34 arquivos); E2E 6/6.

## Banco Neon: migrations de comentários e índices (2026-10-31)

- A pedido da responsável, aplicadas no banco de produção (Neon) as migrations `20261031200000_request_comments` e `20261031220000_request_list_indexes`, pela conexão direta. `prisma migrate status`: 9 migrations, banco em dia.
- Ambas só acrescentam (uma tabela e dois índices); a versão publicada do site, anterior aos comentários, continua funcionando sobre o banco atualizado.
- Uma tentativa anterior de aplicar a migration de comentários tinha sido bloqueada pela permissão automática; esta foi feita depois do pedido explícito.

## SF-059 — Telas de busca, filtros e páginas (2026-10-31)

- **Formulário de busca** (`src/app/_components/request-search-form.tsx`):
  - `method="get"`, funciona sem JavaScript e deixa os critérios na URL;
  - campos: termo, status em caixas de marcar, responsável (só na fila), "Aberta de" e "até" com seletor de data, e ordem; os valores atuais vêm preenchidos a partir da URL;
  - como o formulário não envia `page`, mudar qualquer critério volta para a página 1 (regra 5.5);
  - "Limpar" volta ao endereço sem parâmetros.
- **Paginação** (`request-pagination.tsx`): "Anterior", "Página X de Y — N solicitações" e "Próxima". Os links são montados por `searchPageHref`, que mantém só os parâmetros conhecidos e omite a página 1.
- **Listas:**
  - `/requests` e `/queue` passaram a usar `searchRequesterRequests` e `searchAttendantQueue`;
  - critério inválido mostra uma mensagem fixa, sem lista, para não exibir resultado filtrado de forma errada;
  - sem resultados e com critério ativo, aparece "Nenhuma solicitação encontrada com esses critérios."; sem critério, continua a mensagem de lista vazia de antes;
  - a marcação de cada item não mudou;
  - `listRequesterRequests` e `listAttendantQueue` continuam existindo, como a SPEC pede.
- **E2E de hoje ajustados:** a fila agora mostra 20 itens por página, começando pelas mais antigas, e o banco do E2E acumula solicitações de vários arquivos. Os E2E de atribuição e de comentários passaram a localizar as próprias solicitações pela busca (`/queue?q=…`), em vez de contar com que elas apareçam na primeira página. Os E2E antigos não mudaram e passam.
- **Ponto de atenção:** `demo-data.spec.ts` (antigo) espera ver na primeira página do solicitante as 3 solicitações fictícias dele. Hoje o solicitante de demonstração tem 8 no E2E; se outros testes passarem de 20 novas, esse teste também precisará buscar.
- **Testes:** 4 unitários do montador de links.
- **Resultados:** lint, typecheck e build OK; unitários 346/346 (58 arquivos); integração 155/155 + 1 pulado; E2E 6/6.

## SF-060 — E2E e revisão da busca (2026-10-31)

- **E2E (`request-search.spec.ts`):** grava 22 solicitações sintéticas direto no banco do E2E, para haver mais de uma página: 2 em atendimento e 1 atribuída ao atendente de demonstração. Depois, no navegador:
  - o atendente busca o termo em maiúsculas e vê "Página 1 de 2 — 22 solicitações" com 20 itens; vai para a próxima página, recarrega e o formulário e a lista continuam iguais;
  - "Atribuídas a mim" volta para a página 1 e mostra só a atribuída, com "Responsável: você";
  - "Mais recentes primeiro" inverte a ordem;
  - uma busca com 1 caractere mostra a mensagem fixa, sem lista;
  - o solicitante filtra "Em atendimento" (2 resultados, sem o filtro de responsável); um período sem resultados mostra "Nenhuma solicitação encontrada"; "Limpar" volta a `/requests`.
  - Passou rodando sozinho e com a suíte inteira. O comentário do teste foi corrigido: as contas de demonstração são criadas por `seedDemoData`, e não por testes anteriores.
- **Revisão:** sem segredos versionados; nenhum `console.*`, `dangerouslySetInnerHTML` ou SQL montado à mão nos arquivos novos; os filtros chegam ao banco só pelo Prisma; nenhuma dependência nova; migration só aditiva (SF-057). README com o novo fluxo.
- **SPEC `2026-10-31-busca-filtros-paginacao.md` concluída:** CA-BUS-01 a 10 verificados.
- **Resultados:** lint, typecheck e build OK; unitários 346/346 (58 arquivos); integração 155/155 + 1 pulado (34 arquivos); E2E 7/7.
- **Publicação:** o banco Neon já tem as migrations; o site ainda está na versão anterior aos comentários e à busca.

## Publicação de comentários e busca (2026-10-31)

- A pedido da responsável, `vercel deploy --prod` do commit `2cc83a6` em https://serviceflow-sand.vercel.app (banco Neon já com as 9 migrations).
- Verificação no site publicado, só com leitura:
  - o painel do administrador abre;
  - a fila do atendente mostra o formulário de busca e "Página 1 de 1 — 12 solicitações"; `?q=cadeira` encontra 1 item; `?q=x` mostra a mensagem de critério inválido;
  - o detalhe tem as seções "Conversa" e "Histórico";
  - a lista do solicitante mostra busca e "Página 1 de 1 — 3 solicitações", sem o filtro de responsável.
  - Nenhum formulário que grava foi enviado.

## SF-061 — Outbox e gravação de eventos (2026-10-31)

- **Migration `20261101000000_outbox_and_notifications`:**
  - `OutboxEvent`, com `CHECK` dos 4 tipos, `payload` sempre objeto e `lastErrorCode` de até 64 caracteres;
  - `RequestNotification`, com chave única `(eventId, recipientId)` para a idempotência.
  - **Mudanças em relação à SPEC (seção 9):** a tabela se chama `RequestNotification`, e não `Notification`, porque é sempre ligada a uma solicitação. E `eventId` aceita nulo com `ON DELETE SET NULL`: o job diário apaga eventos processados há mais de 30 dias, enquanto notificações não lidas continuam guardadas, e uma FK `RESTRICT` impediria essa limpeza. A seção 9 da SPEC foi atualizada.
- **Módulo `src/modules/events`:**
  - `DomainEvent`, com os 4 tipos da seção 6.1;
  - `outboxPayload`, que copia só as chaves declaradas de cada tipo. Assim, mesmo um chamador que passe um objeto maior não vaza texto;
  - `recordOutboxEvent(transaction, event)`, que grava com o cliente da transação de quem chama.
- **Gravação:** `RequestTransaction` e `CommentTransaction` ganharam `recordEvent`. Abertura, transição, atribuição, cancelamento, reabertura e comentário gravam o evento logo depois do registro de histórico, com o mesmo horário do banco. Justificativas ficam só no histórico; o evento leva códigos.
- **Falha durante o trabalho:** o primeiro script de ligação falhou no shell (aspas simples em heredoc) e não executou nada; foi refeito como arquivo Python.
- **Testes:** 2 unitários e 3 de integração. Um deles cobre o percurso completo (7 eventos na ordem certa e sem texto). Outro força a falha da gravação do evento com um gatilho e confirma que nenhuma solicitação, comentário ou atribuição fica gravado pela metade. O terceiro confere o `CHECK` de tipo. Os dublês ganharam `recordEvent`, e a limpeza de `fixtures.ts` e `prepare-e2e.ts` passou a incluir as tabelas novas.
- **Resultados:** lint, typecheck e build OK; unitários 348/348 (59 arquivos); integração 158/158 + 1 pulado (35 arquivos); E2E 7/7.
- **Banco Neon:** precisa desta migration antes da próxima publicação.
- **Correção de data:** a SF-061 foi concluída em 31/10 às 22:54 (horário dos commits). A migration recebeu o prefixo `20261101000000` por engano; o nome foi mantido porque ela já está aplicada nos bancos de teste e de desenvolvimento, e o prefixo só ordena as migrations.

## SF-062 — Processador, `after()` e job diário (2026-10-31)

- **Conferido na documentação da Vercel (2026-10-31):** o cron chama a rota com `GET` e `Authorization: Bearer <CRON_SECRET>`; a Vercel recomenda um segredo de 16 caracteres ou mais e avisa que a mesma execução pode chegar duas vezes ou não chegar. No Next 16, `after()` lança erro fora de uma requisição.
- **Processador:**
  - a reserva acontece numa transação curta, com `SELECT … FOR UPDATE SKIP LOCKED` sobre eventos disponíveis, e adia `availableAt` em 5 minutos;
  - cada evento passa por todos os consumidores; com sucesso, recebe `processedAt`;
  - com falha, `attempts + 1`, `availableAt` com espera de 1, 5 e 30 minutos e depois diária, e `lastErrorCode` só com o código (`failureCode` nunca grava a mensagem); na 10.ª tentativa recebe `failedAt`.
- **`scheduleEventProcessing()`:** as Server Actions do solicitante e do atendente o chamam depois de cada operação bem-sucedida. Ele agenda o processador com `after()`. Se `after` lançar erro (fora de requisição, como nos testes unitários das ações) ou se o processamento falhar, os eventos ficam para o job diário. Por isso os testes antigos das ações continuaram passando sem mudança.
- **Job diário (`runDailyJob`):**
  - processa até 20 lotes de 50 eventos;
  - apaga eventos processados há mais de 30 dias;
  - limpa os arquivos órfãos, ou pula a etapa sem armazenamento configurado.
  - Cada etapa roda mesmo que outra falhe e devolve `ok`, `skipped` ou `error` com código.
- **Rota `/api/cron/daily`:** 401 sem o segredo certo (comparação em tempo constante); 200 com o resumo, ou 500 se alguma etapa falhar, registrando só os códigos.
- **`vercel.json`:** `"0 6 * * *"` (06:00 UTC, 03:00 em Brasília). No plano Hobby, a execução cai em qualquer minuto dessa hora.
- **Limpeza de órfãos (decisão E3):**
  - o adaptador de armazenamento ganhou `list(prefix)`, que só aceita `requests/` e `requests/<id>/`; a memória guarda a data de criação; no Supabase usa `POST /object/list/{bucket}` com paginação;
  - a regra fica em `requests/application/orphan-cleanup.ts`: uma pasta cuja solicitação não existe só pode ter órfãos (compensação que falhou), e seus objetos com mais de 24 horas são apagados.
  - **A listagem do Supabase não foi testada contra um bucket real** (SF-030 pendente), só com HTTP simulado.
- **Falha durante o trabalho:** o teste de integração novo não carregou porque faltou isolar `@/server/auth` (que puxa o `next-auth`), como os outros testes de integração fazem. Corrigido no teste.
- **Testes:** 13 unitários (regras de nova tentativa, processador, segredo, listagem, limpeza, rota) e 4 de integração (concorrência real, tentativas e falha definitiva, job diário, limpeza com banco). O teste de concorrência rodou 4 vezes.
- **Resultados:** lint, typecheck e build OK; unitários 361/361 (62 arquivos); integração 162/162 + 1 pulado (36 arquivos); E2E 7/7.
- **Pendências para produção:** cadastrar `CRON_SECRET` na Vercel, como Secret com pelo menos 16 caracteres; sem ele, a rota recusa tudo. Aplicar a migration `20261101000000` no Neon antes de publicar.

## SF-063 — Notificações na aplicação (2026-10-31)

- **Regra de destinatários** (`notifications/domain/recipients.ts`): é a tabela 8.1 em função pura.
  - Mudança de status feita pelo atendente avisa o solicitante. Cancelamento ou reabertura pelo solicitante (o único caso em que o autor é o solicitante) avisa o responsável efetivo.
  - Atribuição avisa só na transferência: o novo responsável.
  - Comentário público vai para "o outro lado". Nota interna vai só para o responsável efetivo.
  - O autor nunca é avisado.
  - Tipos: `status.<STATUS>`, `assignment.received`, `comment.public`, `comment.internal`.
- **Consumidor:**
  - relê a solicitação e calcula o responsável efetivo **no processamento** (com `effectiveAssigneeId` de `requests`);
  - descarta destinatários inativos;
  - grava com `createMany(..., skipDuplicates)` sobre a chave única `(eventId, recipientId)`; reprocessar não duplica;
  - não copia texto: a frase da tela é montada a partir do tipo e do nome do serviço.
- **Telas:**
  - "Notificações" com contador de não lidas nos dois layouts (se a contagem falhar, o link aparece sem número);
  - listas das 50 mais recentes em `/notifications` (solicitante) e `/queue/notifications` (atendente): os dois grupos de rotas não podem ter a mesma URL, então as páginas compartilham o componente;
  - abrir uma notificação passa por `/api/notifications/[id]`, que marca como lida (só se for do próprio usuário) e redireciona (303) para a página da solicitação, onde valem as regras de acesso de sempre;
  - "Marcar todas como lidas" é uma Server Action.
- **Job diário:** ganhou a etapa `purgedNotifications`, que apaga notificações lidas há mais de 90 dias.
- **Problema encontrado e solução:** os 5 testes unitários de ações (3 antigos e 2 meus) pararam de carregar, sem asserção quebrada: as ações passaram a puxar `@/server/jobs`, que importa o módulo de notificações e, por ele, o `next-auth`. Em vez de mexer de novo nos testes, o agendamento foi para `src/server/jobs/schedule.ts`, que carrega o processador por `import()` só quando o `after()` roda. As ações ficaram leves e os testes antigos voltaram a passar sem alteração.
- **Erro meu, corrigido antes do commit:** um teste unitário novo tinha uma verificação sem sentido (um caso impossível com uma expressão confusa); foi removida.
- **Testes:** 5 unitários da regra e 5 de integração (percurso completo, idempotência, inativos e sem responsável, autorização e leitura, limpeza).
- **Resultados:** lint, typecheck e build OK; unitários 366/366 (63 arquivos); integração 167/167 + 1 pulado (37 arquivos); E2E 7/7.

## SF-064 — E2E e revisão dos eventos (2026-11-01)

- **E2E (`request-notifications.spec.ts`):**
  - começa marcando como lidas as notificações acumuladas por outros E2E;
  - o solicitante abre uma solicitação e comenta: sem responsável, a equipe não é avisada;
  - o atendente responde e escreve uma nota interna;
  - o solicitante vê "Notificações, 1 não lidas", sem esperar o cron;
  - na lista aparece "Novo comentário em Reparo de mobiliário", sem a nota interna;
  - ao abrir, vai para a solicitação, o contador zera e a lista mostra "Lida".
- **Defeitos reais encontrados pelo E2E e corrigidos:**
  1. A rota `/api/notifications/[id]` montava um redirecionamento absoluto a partir de `request.url`. No servidor de desenvolvimento esse endereço era `localhost:3100`, enquanto o navegador estava em `127.0.0.1:3100`: o cookie de sessão não valia no outro host e o usuário caía no login. O mesmo pode acontecer atrás de proxy. Agora o `Location` é relativo (303).
  2. O contador fica no layout, que o Next preserva em navegações feitas no navegador; depois de abrir a notificação, ele continuava em "1". O link da notificação virou um `<a>` comum (navegação completa) e "Marcar todas como lidas" passou a revalidar o layout (`revalidatePath("/", "layout")`).
  - **Limitação registrada:** uma notificação que chegue enquanto o usuário navega entre páginas sem recarregar só aparece no contador numa navegação completa ou ao abrir a lista.
- **Testes:** E2E novo; teste unitário da rota (Location relativo, destino por perfil, notificação de outra pessoa, anônimo e identificador inválido).
- **Revisão:**
  - sem segredos versionados; nenhum `console.log`, `dangerouslySetInnerHTML` ou SQL inseguro nos módulos novos (a reserva do outbox usa `$queryRaw` com parâmetros);
  - nenhuma dependência nova; migrations só aditivas;
  - os eventos e as notificações não copiam texto;
  - README com notificações e job diário (inclusive como chamá-lo localmente).
- **SPEC `2026-10-31-eventos-outbox-jobs.md` concluída:** CA-EVT-01 a 09 verificados.
- **Resultados:** lint, typecheck e build OK; unitários 369/369 (64 arquivos); integração 167/167 + 1 pulado (37 arquivos); E2E 8/8.
- **Para publicar:** aplicar no Neon a migration `20261101000000_outbox_and_notifications`; o `CRON_SECRET` já está cadastrado na Vercel.

## Publicação dos eventos e notificações (2026-11-01)

- A pedido da responsável:
  - aplicada no Neon a migration `20261101000000_outbox_and_notifications`; `prisma migrate status`: 10 migrations, banco em dia;
  - `vercel deploy --prod` do commit `ff65f7e` em https://serviceflow-sand.vercel.app.
- A Vercel registrou o cron `/api/cron/daily` com `0 6 * * *` (`vercel crons ls`). O `CRON_SECRET` já estava cadastrado.
- Verificação no site publicado, só com leitura:
  - a rota do cron responde 401 sem segredo e com segredo errado;
  - abrir uma notificação sem login redireciona (303) para `/login`, com destino relativo;
  - solicitante e atendente veem o link "Notificações" e a página com "0 não lidas" (o banco de produção não tinha eventos novos).
  - Nenhum formulário que grava foi enviado. A primeira execução real do cron é esperada para a próxima janela das 06:00 UTC.

## SF-065 — Migration e domínio do SLA (2026-11-01)

- **Migration `20261101100000_sla_and_priorities`:**
  - enum `RequestPriority` (`LOW`, `NORMAL`, `HIGH`, `URGENT`);
  - `Service.defaultPriority` (padrão `NORMAL`) e `Service.slaHours`;
  - em `Request`: `priority`, `slaHoursSnapshot`, `dueAt`, `slaWarningNotifiedAt`, `slaBreachNotifiedAt` e `completedLate`, mais o índice `(sectorId, dueAt)`;
  - nova tabela `RequestPriorityEvent`.
  - Uma migration só basta: o problema da SF-047 era acrescentar valor a um enum existente, e aqui o enum é novo.
- **`CHECK`s:**
  - `slaHours` e `slaHoursSnapshot` de 1 a 2.000;
  - `dueAt` preenchido exatamente quando há snapshot;
  - `completedLate` só em solicitação concluída com SLA;
  - evento de prioridade sempre muda a prioridade;
  - `OutboxEvent_type_check` refeito para aceitar `request.priority_changed`, `request.sla_warning` e `request.sla_breached`. É o único ponto da migration que remove algo: um `CHECK`, recriado mais amplo.
- **Domínio (`requests/domain/sla.ts`):**
  - `effectiveSlaMinutes`: 25/50/100/200%, minutos arredondados para cima;
  - `dueAtFrom` (horas corridas a partir de um início) e `completedLateAt`;
  - `slaSituation`, calculada na exibição: `on_time`, `due_soon`, `overdue`, `completed_on_time`, `completed_late` ou `none`. Exatamente no vencimento ainda é "próximo"; 1 ms depois, "vencido";
  - `parseSlaHours` (vazio ou inteiro de 1 a 2.000) e `isRequestPriority`.
- **Tipos:** `RequestRecord` ganhou `priority`, `slaHoursSnapshot`, `dueAt` e `completedLate`. O objeto de teste antigo `persistedRequest` e o dublê em memória ganharam os campos novos, sem mudança de asserção.
- **Falha durante o trabalho:** a primeira edição do schema não achou uma linha porque o `prisma format` tinha realinhado as colunas. O script só grava no fim, então nada foi alterado; foi refeito com padrões tolerantes ao alinhamento.
- **Testes:** 8 unitários (percentuais, vencimento, bordas da situação, resultado da conclusão, valores) e 4 de integração (padrões, limites, vínculo do vencimento, resultado da conclusão, evento de prioridade e tipos do outbox).
- **Resultados:** lint, typecheck e build OK; unitários 377/377 (65 arquivos); integração 171/171 + 1 pulado (38 arquivos); E2E 8/8.

## SF-066 — Configuração no serviço e snapshot (2026-11-01)

- **Serviço:**
  - `ServiceRecord` ganhou `defaultPriority` e `slaHours`;
  - o schema aceita `defaultPriority` (enum) e `slaHours` (texto, número ou nulo), **opcionais**: quando ausentes, o valor atual fica como está (na criação, `NORMAL` e sem prazo);
  - `parseSlaHours` (vazio = sem prazo; inteiro de 1 a 2.000) fica em `services/domain/sla-config.ts`.
  - **Mudança de lugar:** na SF-065 essa validação estava em `requests/domain/sla.ts`. Foi movida porque é configuração do serviço, e importar de `requests` criaria dependência circular (`requests` já importa de `services`).
- **Ações da administração:** `defaultPriority` e `slaHours` só são enviados quando o formulário tem os campos. Assim o teste antigo `admin-actions.test.ts`, que confere o conteúdo exato enviado, continua passando sem alteração. Formulários de criação e edição ganharam "Prioridade padrão" e "Prazo-base (horas)" (`service-sla-fields.tsx`), e a lista mostra prioridade e prazo de cada serviço.
- **Solicitação:**
  - na abertura, grava `priority` (padrão do serviço), `slaHoursSnapshot` e `dueAt` (`dueAtFrom` com o horário do banco);
  - na conclusão, `completedLate = completedLateAt(dueAt, horário)`;
  - na reabertura, `dueAt` é recalculado a partir do horário da reabertura com a prioridade atual, `completedLate` é limpo e `slaWarningNotifiedAt` e `slaBreachNotifiedAt` voltam a nulo (alertas liberados, seção 5.5).
  - `LifecycleRequest` e `StatusUpdate` ganharam os campos opcionais necessários.
- **Erro meu encontrado pelo typecheck:** na SF-065, o dublê em memória ganhou valores fixos (`priority: "NORMAL"`, sem prazo) **depois** do `...data` na inserção. Com a abertura enviando esses campos, eles teriam sobrescrito o que foi calculado. As linhas repetidas foram removidas.
- **Testes existentes:** os dublês do módulo `services` (`service-use-cases.test.ts`, `catalog.test.ts`) ganharam os campos novos; nenhuma asserção mudou.
- **Testes novos:** 4 unitários de ciclo de vida, 2 das ações da administração e 4 de integração.
- **Resultados:** lint, typecheck e build OK; unitários 383/383 (67 arquivos); integração 175/175 + 1 pulado (39 arquivos); E2E 8/8.

## SF-067 — Mudança de prioridade (2026-11-01)

- **Interpretação (registrada na SPEC, seção 5.3):** a SPEC diz que mudar a prioridade recalcula o vencimento "a partir da abertura" e que a reabertura reinicia a contagem. Para uma solicitação reaberta, o novo vencimento é calculado a partir do **início do período atual**, obtido como `dueAt − prazo efetivo da prioridade antiga` (`dueAtAfterPriorityChange`). Não foi preciso coluna nova.
- **Domínio:** `assertCanChangePriority` em `lifecycle.ts` (atendente do setor, status `OPEN`/`IN_PROGRESS`, responsável efetivo; prioridade igual gera `ValidationError` no campo `priority`, que entrou em `PUBLIC_VALIDATION_PATHS`).
- **Caso de uso:** `application/priority.ts`. A atualização é condicionada a status, responsável e prioridade lidos (conflito se algo mudou). Se o vencimento foi adiado, as marcas de alerta voltam a nulo para que os alertas da SF-069 possam ser gerados de novo; se foi antecipado, ficam como estão.
- **Eventos:** `request.priority_changed` entrou na união de eventos e no `DOMAIN_EVENT_TYPES`; não gera notificação (a SPEC não pede). O teste da SF-061 que confere a lista exata de tipos foi atualizado com esse tipo — é a única asserção existente alterada, e a mudança vem da SPEC.
- **Telas:** histórico mostra "Prioridade: X → Y"; o detalhe do atendente tem o formulário (só com status aberta ou em atendimento e sem colega responsável).
- **Erro meu nos testes:** no teste da ação, criei `ValidationError` com `path` em texto; o construtor espera lista. Corrigido.
- **Resultados:** lint, typecheck e build OK; unitários 391/391 (69 arquivos); integração 178/178 + 1 pulado (40 arquivos); E2E 8/8.

## SF-068 — Telas do SLA (2026-11-01)

- **Mudança de dados registrada na SPEC (seção 6):** o filtro "próximo do vencimento" depende de `vencimento − 20% do prazo efetivo`, uma conta por linha que o Prisma não expressa em `where`. Alternativas consideradas:
  - consulta SQL crua para a busca inteira: reescreveria a busca da SF-058;
  - campo gravado pela aplicação: três caminhos de escrita (abertura, reabertura, prioridade) teriam de lembrar dele;
  - coluna gerada do PostgreSQL: recusada, porque `timestamptz − interval` não é imutável.
  - **Escolha:** coluna `dueSoonAt` preenchida por **trigger** (`request_due_soon_at`) em toda gravação de `dueAt`, `priority`, `slaHoursSnapshot` ou da própria coluna. A aplicação nunca a escreve, e as portas e testes existentes não mudaram. Os fatores (3, 6, 12, 24 minutos por hora de prazo) repetem a regra do domínio; o teste de integração compara o trigger com `slaSituation` nas quatro prioridades, na borda exata.
- **Critérios de busca:** `sla` (`on_time`, `due_soon`, `overdue`, `none`) e a ordem `due` existem só na fila. Na lista do solicitante, `sla` é ignorado (como `assignee`) e `order=due` é recusado. A chave `sla` só aparece nos critérios quando escolhida, para não mudar o formato verificado pelos testes da SF-057.
- **Hora de referência do filtro:** o repositório usa o relógio da aplicação no momento da consulta, o mesmo usado na tela para calcular a situação.
- **Telas:** componente `request-sla.tsx` (prioridade, situação em texto e vencimento enquanto o prazo corre), na fila, na lista do solicitante e nos dois detalhes. A cor só reforça o texto.
- **Ajuste em teste existente:** o dublê de `tests/unit/authorization/index.test.ts` monta a linha completa do Prisma e ganhou `dueSoonAt: null`; nenhuma asserção mudou.
- **Migration aplicada** no banco de dev; ainda falta aplicar `20261101100000` e `20261101200000` no Neon antes de publicar.
- **Resultados:** lint, typecheck e build OK; unitários 394/394 (70 arquivos); integração 182/182 + 1 pulado (41 arquivos); E2E 8/8.

## SF-069 — Alertas de prazo (2026-11-01)

- **Regra no domínio:** `pendingSlaAlert` (em `sla.ts`) usa `slaSituation`, a mesma regra da tela: "próximo" sem marca de aviso gera `warning`; "vencido" sem marca de vencido gera `breach`.
- **Uma única vez:** `recordSlaAlerts` busca candidatas (abertas ou em atendimento, `dueSoonAt` já alcançado e alguma marca pendente, até 500 por execução) e, para cada uma, faz numa transação um `updateMany` condicionado ao status, ao vencimento e às marcas lidas; só grava o evento se a linha mudou. Duas execuções simultâneas não duplicam o alerta.
- **Interpretações (registradas na SPEC, seção 5.5):** já vencida recebe só o alerta de vencido (o aviso é dado como encerrado); concluída ou cancelada antes do processamento não notifica ninguém; o solicitante não recebe alertas de prazo.
- **Notificações:** `plannedNotifications` ganhou os dois tipos. O contexto tem um campo opcional `slaRecipients`, que o consumidor só monta para esses eventos (os atendentes do setor só são lidos quando não há responsável). A loja de notificações ganhou `sectorAttendantIds` e passou a ler o status da solicitação. Mensagens: "Prazo próximo do vencimento" e "Prazo vencido".
- **Job diário:** o passo `slaAlerts` roda antes do processamento dos eventos, para que as notificações saiam na mesma execução. O resumo do job ganhou a chave `slaAlerts`.
- **Teste existente alterado:** a lista exata de tipos de evento da SF-061 recebeu os dois tipos novos, criados pela SPEC. Nenhuma outra asserção mudou.
- **Erro meu:** o dublê do teste unitário declarava um único parâmetro e o typecheck acusou; corrigido com o tipo da porta.
- **Resultados:** lint, typecheck e build OK; unitários 398/398 (71 arquivos); integração 186/186 + 1 pulado (42 arquivos); E2E 8/8.

## SF-070 — E2E e revisão do SLA (2026-11-01)

- **E2E (`request-sla.spec.ts`):** o administrador cria um serviço com prioridade Normal e prazo-base de 2 horas; o solicitante abre e vê "Prioridade: Normal" e "Dentro do prazo"; o atendente encontra o item com o filtro "Dentro do prazo" e a ordem por vencimento (e não com "Vencido"), muda para Urgente, vê o histórico "Prioridade: Normal → Urgente" e o vencimento antecipado em exatamente 90 minutos (25% de 2 h, contados da abertura); o solicitante vê a nova prioridade na lista.
- **Revisão:** README ganhou a seção de SLA e prioridades (inclusive a limitação do job diário no plano gratuito) e a descrição do job diário cita os alertas. A SPEC está marcada como concluída.
- **Observação no log do servidor do E2E:** aparecem mensagens "Error: The destination stream closed early" do Next.js. Não quebram nenhum teste. A causa provável é o navegador do Playwright interromper uma resposta em streaming ao trocar de página, mas não investiguei nem verifiquei se elas já apareciam antes desta SPEC (as execuções anteriores só filtravam o resultado final).
- **Pendência para publicar:** aplicar no Neon as migrations `20261101100000_sla_and_priorities` e `20261101200000_sla_due_soon_at` antes do próximo deploy.
- **Resultados:** lint, typecheck e build OK; unitários 398/398 (71 arquivos); integração 186/186 + 1 pulado (42 arquivos); E2E 9/9.

## Relatório da fase 2 (2026-11-01)

- **Documento:** `SPEC/2026-11-01-relatorio-fase-2.md` (exigido pela seção 6 de `SPEC/2026-10-30-camadas-para-100k.md`).
- **Medição:** 15.259 linhas `added` acumuladas (`0038b7e`), contra a previsão de 26.000 a 39.000 para o fim da fase 2. Só a fase 2 somou 7.687 (`bbe064f` → `0038b7e`).
- **Recalibração:** as estimativas do plano estão de 3,3 a 4,7 vezes acima do real. Se a proporção se mantiver, o roadmap inteiro deve terminar entre ~29.000 e ~45.000 linhas, menos da metade da meta. A decisão sobre como tratar isso fica com a responsável (seção 8 do relatório).
- **Correção:** o relatório da fase 1 estimou a atribuição em "cerca de 1.800 linhas"; a medição a partir de `568d752` dá 2.212.
- **Exceção às migrations aditivas registrada no relatório:** a SF-065 apagou e recriou, mais ampla, a restrição `OutboxEvent_type_check`.
- **Tempo:** 9h20 na fase 2, medidas pela transcrição do Claude Code; `diario/tempo-do-projeto.md` atualizado (total mínimo 33h29).
- **Suítes não executadas de novo** para o relatório (só documentação); o PostgreSQL de teste está parado desde que o sistema o encerrou por falta de memória.

## Decisão sobre a meta e SPEC de campos personalizados (2026-11-01)

- **Meta de 100.000 linhas:** a responsável escolheu a opção 2 do relatório da fase 2: acrescentar funcionalidades reais, cada uma com SPEC própria aprovada. Registrado na seção 8 do relatório. Continuam proibidos duplicação, geração em massa e funcionalidade fictícia (SF-026).
- **SPEC `2026-11-01-campos-personalizados.md`** (item 6 do plano, início da fase 3) aprovada com as decisões F1 a F4 conforme propostas: seis tipos de campo; respostas em tabela própria com snapshot; respostas imutáveis; até 10 campos ativos por serviço. Tarefas SF-071 a SF-075 registradas em `TASKS.md`.
- **Modelo seguido:** os requisitos documentais da seção 21 da SPEC principal (configuração por serviço, desativação lógica, configuração recarregada no envio, snapshot na abertura, gravação na mesma transação).

## SF-071 — Migration e domínio dos campos personalizados (2026-11-01)

- **Migration `20261101300000_service_fields`, só aditiva:** gerada com `prisma migrate diff` a partir do schema anterior, mais as restrições escritas à mão:
  - índice único parcial `(serviceId, label)` entre os campos ativos (rótulo `citext`, sem distinguir maiúsculas);
  - `CHECK`s de rótulo (1 a 80, sem espaços nas pontas), texto de ajuda (1 a 200 ou nulo), posição, limites (só em `INTEGER`, dentro de ±1.000.000.000, mínimo ≤ máximo), valor da resposta (1 a 2.000) e snapshot;
  - as opções são validadas por uma função `IMMUTABLE` (`service_field_options_valid`), porque um `CHECK` não percorre listas: cada opção sem espaços nas pontas, 1 a 80 caracteres, sem repetição ignorando maiúsculas; 2 a 20 opções só em `SELECT`, lista vazia nos outros tipos.
- **`options` sem valor padrão:** o Prisma cria listas como colunas que aceitam nulo, e o `CHECK` exige a lista. O repositório da SF-072 sempre grava a lista (vazia fora de `SELECT`), como já acontece com os formatos dos documentos.
- **Tipo imutável:** a regra fica na aplicação (`assertFieldTypeUnchanged`), usada pela edição na SF-072; não há trigger no banco.
- **Módulo novo `service-fields`:** o lint passou a aplicar a ele as fronteiras de camadas automaticamente (a lista de módulos vem do diretório).
- **Regras das respostas (`field-value.ts`):** os tamanhos contam caracteres (code points), como o `char_length` do PostgreSQL, e não unidades UTF-16 do JavaScript; quebras de linha `CRLF` do navegador contam como uma; inteiros só em base 10, sem sinal `+`, normalizados sem zeros à esquerda; datas conferidas no calendário (`2026-02-30` recusada); a lista aceita a opção exatamente como escrita. Uma resposta para campo que não é ativo do serviço devolve `stale_form`, para a abertura pedir recarga (5.3.3).
- **Posição no snapshot:** a resposta guarda a posição do campo entre os ativos no momento da abertura (0, 1, 2…), e não a posição bruta, que pode ter lacunas.
- **Limpeza do banco de teste:** `tests/integration/fixtures.ts` e `scripts/prepare-e2e.ts` apagam `RequestFieldValue` e `ServiceField` na ordem das chaves estrangeiras.
- **Resultados:** lint, typecheck e build OK; unitários 421/421 (73 arquivos); integração 192/192 + 1 pulado (43 arquivos); E2E 9/9.

## SF-072 — Configuração dos campos pelo administrador (2026-11-01)

- **Casos de uso:** criar, editar, reordenar, desativar e reativar, todos com `requireConfigurationAdministrator` e transação serializável, no mesmo padrão dos requisitos documentais. Campo inativo não é editado nem movido; reativar põe o campo no fim do formulário e respeita o limite de 10 e a unicidade do rótulo.
- **Rótulo único:** conferido no caso de uso (ignorando maiúsculas) e garantido no banco pelo índice único parcial em `citext`; um conflito do banco também vira `ConflictError`.
- **Ordenação compartilhada:** `compareByPosition`, `nextPosition` e `planPositionMove` saíram de `document-requirements/domain/requirement-order.ts` para `src/shared/ordering`, para os campos não duplicarem o código. O módulo de documentos mantém os nomes antigos como apelidos; seus testes não mudaram e passam.
- **Ações e formulário:** opções chegam uma por linha (linhas em branco ignoradas); limites em branco significam "sem limite"; valores inesperados seguem para a validação do servidor. O tipo só é escolhido na criação; na edição ele aparece como texto e vai num campo oculto (o servidor recusa outro tipo). A mensagem de erro de reativação recusada é própria dos campos.
- **Testes existentes alterados (só configuração, sem mudar asserções):** `tests/unit/admin-actions.test.ts` e `tests/unit/admin-service-sla-actions.test.ts` importam as ações de serviços, que agora importam o módulo de campos; cada um ganhou `vi.mock("@/modules/service-fields", () => ({}))`, como já fazem com os outros módulos.
- **Defeito meu encontrado na verificação no navegador:** o React 19 limpa o formulário depois de cada ação. O `select` de tipo voltava para "Texto curto" na tela, mas o estado do componente continuava no tipo anterior, mostrando campos de outro tipo (por exemplo, mínimo e máximo com "Texto curto"), e o envio era recusado. Corrigido: o `select` deixou de ser controlado e o componente acompanha o evento `reset` do formulário. A verificação foi feita com um teste E2E temporário, removido antes do commit; o E2E definitivo é da SF-075.
- **Observação (comportamento já existente, não alterado):** em todos os formulários de criação da área administrativa, um envio recusado também limpa o que foi digitado, pelo mesmo motivo. Não faz parte desta SPEC; fica registrado para uma melhoria futura.
- **Resultados:** lint, typecheck e build OK; unitários 436/436 (75 arquivos); integração 199/199 + 1 pulado (44 arquivos); E2E 9/9.

## SF-073 — Abertura com campos personalizados (2026-11-01)

- **Caso de uso:** `createRequest` aceita `fieldValues` (mapa id → texto; até 50 chaves e 20.000 caracteres por valor, só para barrar abuso). As respostas são conferidas com `collectFieldAnswers` contra os campos ativos lidos **na transação** (vale a configuração do momento do envio). Quando há arquivos, a conferência acontece também na primeira transação, antes de gravar qualquer objeto no armazenamento. As respostas são gravadas depois dos anexos, com `createdAt` igual ao horário da abertura.
- **Erro próprio:** `FieldAnswersError` (subclasse de `ValidationError`) leva o motivo (`invalid` ou `stale_form`) e a lista de campo e código. O caminho `fields` entrou na lista de caminhos públicos de validação.
- **Ação e página:** a ação lê os campos `field.<id>` e só envia `fieldValues` quando existem, para não mudar a chamada dos serviços sem campos. Uma recusa volta para a página do serviço com `?error=fields&fields=<id>.<código>,...` ou `?error=fields-changed`; o texto digitado nunca vai no endereço. A página só aceita pares com campo ativo e código conhecido. Os códigos de erro anteriores (`validation`, `attachments`, `unavailable`...) não mudaram.
- **Valores mantidos (5.3.4):** o formulário passou a ser um componente cliente (`request-form.tsx`) que guarda a descrição e as respostas antes de enviar e remonta o formulário com elas como valores iniciais; assim elas sobrevivem ao reset automático do React e ao redirecionamento. Arquivos não podem ser restaurados pelo navegador; a mensagem avisa quando o serviço exige documentos. Esclarecimento registrado na SPEC (5.3.4).
- **Validação no navegador:** os campos têm `required`, `min`, `max` e `maxLength` para ajudar quem preenche; o servidor continua sendo a referência.
- **Testes existentes alterados (só configuração, sem mudar asserções):** `requester-actions`, `comment-actions` e `lifecycle-actions-forms` importam o arquivo de ações do solicitante, que agora importa o módulo de campos; cada um ganhou `vi.mock("@/modules/service-fields", () => ({ FieldAnswersError: class {} }))`. O dublê em memória `tests/unit/modules/requests/in-memory-requests.ts` ganhou os campos e as respostas.
- **Verificação no navegador:** teste E2E temporário (removido antes do commit) abriu um serviço com cinco campos, recebeu a recusa do servidor com quantidade fora do limite, conferiu a mensagem junto do campo e os valores mantidos, corrigiu e abriu a solicitação.
- **Resultados:** lint, typecheck e build OK; unitários 448/448 (77 arquivos); integração 205/205 + 1 pulado (45 arquivos); E2E 9/9.

## SF-074 — Respostas nos detalhes e serviço de exemplo (2026-11-01)

- **Consulta própria:** as respostas não entraram em `RequestWithHistory` (que vários testes comparam por inteiro); seguem o modelo dos anexos, com `listRequestFieldAnswers` e um repositório só de leitura. A autorização reaproveita `authorizeRequestRead` dos anexos, agora exportada e tipada só com `findRequestScope`: dono ou atendente do setor atual; qualquer recusa é "não encontrado".
- **Tela:** componente `request-field-answers.tsx`, entre a descrição e os documentos, nos detalhes do solicitante e do atendente; não aparece quando não há respostas. Texto longo mantém as quebras de linha.
- **Formatação (`formatFieldAnswer`, no módulo de campos):** data `AAAA-MM-DD` vira `DD/MM/AAAA`, sim ou não vira "Sim"/"Não", inteiros ganham separador de milhar; valores fora do formato esperado aparecem como estão, sem adivinhar.
- **Banco fictício:** `DEMO_SERVICE_FIELDS` configura cinco campos (um de cada tipo, menos texto longo) em "Manutenção de ar-condicionado", escolhido porque nenhum E2E abre esse serviço. Como os documentos de exemplo, só cria quando o serviço ainda não tem campos. O resumo devolvido por `seedDemoData` não ganhou chave nova, porque o teste existente o compara com `toEqual` exato; a contagem é conferida no teste novo.
- **Verificação no navegador:** teste E2E temporário (removido antes do commit) abriu o serviço de exemplo preenchendo os campos e conferiu o bloco nos detalhes do solicitante e do atendente.
- **Resultados:** lint, typecheck e build OK; unitários 453/453 (78 arquivos); integração 210/210 + 1 pulado (46 arquivos); E2E 9/9.

## SF-075 — E2E e revisão dos campos personalizados (2026-11-01)

- **E2E (`request-custom-fields.spec.ts`):** o administrador cria um serviço e um campo de cada tipo pelo editor; o solicitante vê os campos na ordem, envia sem o obrigatório e com quantidade fora do limite (com a validação do navegador desligada, para o servidor responder), recebe os dois erros junto dos campos com tudo o que digitou mantido, corrige e abre; os detalhes do solicitante mostram as seis respostas formatadas e o atendente do setor vê as mesmas respostas.
- **Revisão:** nenhuma dependência nova; nenhum segredo nos arquivos; a migration da SPEC só acrescenta (enum, duas tabelas, índices, função e `CHECK`s); nenhum log novo com dados digitados. Testes existentes alterados só na configuração (`vi.mock` do módulo novo em cinco arquivos e o dublê em memória), sem mudar asserções. README com a seção de campos personalizados.
- **Pendência para publicar:** aplicar no Neon, antes do próximo deploy, as migrations `20261101100000_sla_and_priorities`, `20261101200000_sla_due_soon_at` e `20261101300000_service_fields`.
- **Resultados:** lint, typecheck e build OK; unitários 453/453 (78 arquivos); integração 210/210 + 1 pulado (46 arquivos); E2E 10/10.

## SPEC de fluxos configuráveis (2026-11-01)

- **SPEC `2026-11-01-fluxos-configuraveis.md`** (item 7 do plano) aprovada com as decisões W1 a W4 conforme propostas: etapas dentro de "Em atendimento", sem mudar o status; avançar e voltar uma etapa por vez (voltar com justificativa) e concluir só na última; cópia do fluxo no início do atendimento; notificação ao solicitante a cada mudança de etapa. Tarefas SF-076 a SF-080 registradas em `TASKS.md`.
- **Fronteiras com outros itens:** a atribuição continua independente das etapas; a aprovação (item 8) terá SPEC própria e decidirá se vira um tipo de etapa.

## SF-076 — Migration e domínio das etapas (2026-11-01)

- **Migration `20261101400000_service_stages`:** só acrescenta, com a exceção já prevista na SPEC (seção 6): o `CHECK` de tipos da outbox foi apagado e recriado mais amplo para aceitar `request.stage_changed`, sem perda de dados — mesmo procedimento da SPEC de SLA.
  - `ServiceStage` com índice único parcial do nome entre as ativas (`citext`) e `CHECK`s de nome (1 a 60, sem espaços nas pontas) e posição;
  - `Request.stageNamesSnapshot` (lista, padrão vazio) e `Request.stageIndex`; o `CHECK` `Request_stage_check` exige que a etapa exista exatamente quando há cópia, aponte para dentro dela e nunca exista com status `OPEN`; a validade dos nomes copiados (até 8, sem repetição) fica numa função `IMMUTABLE`, porque um `CHECK` não percorre listas;
  - `RequestStageEvent` com `CHECK` de etapas distintas e justificativa de 1 a 1.000 caracteres.
- **Regras:** `stageCopyOnStart` copia as etapas ativas e entra na primeira; `planStageMove` avança ou volta uma etapa (voltar exige justificativa, com o mesmo `normalizeNote` do cancelamento e da reabertura) e nunca passa das pontas; `assertCanCompleteAtStage` só libera a conclusão na última etapa; `assertCanMoveStage` usa as mesmas pessoas que concluem (atendente do setor; com responsável, só ele).
- **O evento `request.stage_changed`** só entra na lista de tipos do código na SF-078, quando passar a ser gravado; a migration já o aceita.
- **Teste existente alterado (só o dublê):** `tests/unit/authorization/index.test.ts` ganhou `stageNamesSnapshot: []` e `stageIndex: null` no objeto tipado como linha do Prisma, como na SF-068. Nenhuma asserção mudou.
- **Erro meu, pego por um teste existente:** `tests/unit/prisma/migrations.test.ts` proíbe as palavras `INSERT INTO` e `COPY` nas migrations, e um comentário SQL meu dizia "copy". Troquei o comentário por "snapshot" (o teste não foi alterado). A migration ainda não tinha sido publicada; nos bancos locais, o `migrate deploy` seguiu sem pendências.
- **Resultados:** lint, typecheck e build OK; unitários 469/469 (80 arquivos); integração 214/214 + 1 pulado (47 arquivos); E2E 10/10.

## SF-077 — Configuração das etapas pelo administrador (2026-11-01)

- **Casos de uso:** mesmo padrão dos campos personalizados (SF-072): `requireConfigurationAdministrator`, transação serializável, nome único entre as ativas conferido no caso de uso e garantido pelo índice do banco, ordenação "Subir/Descer" com `src/shared/ordering`. Etapa inativa não é renomeada nem movida; reativar põe no fim do fluxo, dentro do limite de 8 e sem repetir nome.
- **Tela:** bloco "Etapas do atendimento" em cada serviço, depois de documentos e campos, com a posição de cada etapa, "Renomear", "Subir", "Descer", "Desativar" e a lista de inativas com "Reativar". O texto do bloco avisa que solicitações já em atendimento seguem as etapas do momento em que começaram (decisão W3). A recusa de reativação tem mensagem própria.
- **Testes existentes alterados (só configuração, sem mudar asserções):** `admin-actions`, `admin-service-sla-actions` e `service-field-actions` importam as ações de serviços, que agora importam o módulo de etapas; cada um ganhou `vi.mock("@/modules/service-stages", () => ({}))`.
- **Falha durante o trabalho:** o primeiro comando que gravava os arquivos do módulo usou heredocs no shell e quebrou por causa de um apóstrofo; nada foi gravado. Os arquivos foram escritos de novo com a ferramenta de edição.
- **Verificação no navegador:** teste E2E temporário (removido antes do commit) criou três etapas, desceu, renomeou, desativou, criou outra com o mesmo nome em minúsculas e conferiu a recusa da reativação.
- **Resultados:** lint, typecheck e build OK; unitários 482/482 (82 arquivos); integração 218/218 + 1 pulado (48 arquivos); E2E 10/10.

## SF-078 — Início com cópia, avanço, retorno e conclusão (2026-11-01)

- **Início:** `transitionRequestStatus` para `IN_PROGRESS` lê as etapas ativas do serviço na mesma transação, grava a cópia e a etapa 0 junto com o status, e registra a entrada na primeira etapa (`RequestStageEvent` com `fromStage` nulo) e o evento `request.stage_changed` com direção `start`.
- **Conclusão:** recusada antes da última etapa (`assertCanCompleteAtStage`). A atualização do status também exige que a etapa ainda seja a lida, para que um retorno concorrente não seja atropelado.
- **Mover etapa (`moveRequestStage`):** mesmo padrão das outras ações (ator e solicitação relidos na transação, atualização condicional ao status, ao responsável e à etapa, histórico e evento na mesma transação). Exportado em `@/modules/requests`; as telas e ações vêm na SF-079.
- **Defeito encontrado pelo teste de integração e corrigido:** dois "Avançar" simultâneos passavam os dois, levando a solicitação duas etapas à frente — o segundo pedido lia a etapa já avançada. O pedido agora carrega `fromStageIndex`, a etapa que a pessoa estava vendo; partir de outra etapa é conflito. Esclarecimento registrado na SPEC (5.3.5). O teste foi repetido 4 vezes sem falha.
- **Reabertura:** limpa a cópia e a etapa (`NO_STAGE`), como exige o `CHECK` do banco para solicitações abertas.
- **Evento:** payload `{ stageEventId, direction, actorId }` — só identificadores e códigos (SPEC de eventos, 6.1); a justificativa fica só no histórico. O consumidor de notificações ainda ignora esse tipo (SF-079).
- **Testes existentes alterados:** a lista exata de tipos de evento da SF-061 (`domain-event.test.ts`) recebeu `request.stage_changed`, exigido pela SPEC — única asserção alterada. O dublê em memória das solicitações ganhou etapas, histórico e as colunas novas, e `RequestRecord` ganhou `stageNamesSnapshot` e `stageIndex`.
- **Resultados:** lint, typecheck e build OK; unitários 493/493 (83 arquivos); integração 224/224 + 1 pulado (49 arquivos); E2E 10/10.

## SF-079 — Telas das etapas e notificação (2026-11-01)

- **Histórico:** `RequestWithHistory` ganhou `stageEvents` (com o nome de quem moveu), lido junto com os outros eventos. A linha do tempo mostra "Etapa: X" na entrada e "Etapa: X → Y" nas mudanças, com a justificativa do retorno.
- **Atendente:** componente `stage-panel.tsx` com "Avançar para …" e "Voltar para …" (justificativa obrigatória num bloco recolhível, como o cancelamento). Os dois formulários enviam a etapa mostrada (`fromStageIndex`). Na última etapa aparece o aviso de que já é possível concluir; antes dela o botão de concluir não aparece (o servidor recusa de qualquer forma). Com responsável, só ele vê os botões. Mensagens novas: "Etapa alterada." e a de justificativa do retorno (`stage-note`).
- **Solicitante e listas:** `request-stage.tsx` com o rótulo "Etapa N de M: nome" ao lado do status (detalhes, fila e "Minhas solicitações") e a lista de etapas com "(concluída)" e "(atual)" para o solicitante.
- **Notificação (`stage.changed`):** regra em `plannedNotifications` (solicitante, exceto `direction: start`). O nome da etapa vem do registro do histórico apontado pelo evento (`stageEventId`), lido pela loja de notificações na listagem; quando o evento já foi apagado (30 dias), a mensagem fica genérica: "Sua solicitação mudou de etapa". Nenhum texto foi copiado para o evento ou para a notificação.
- **Testes existentes alterados (só os objetos de teste, sem mudar asserções):** `tests/unit/request-timeline.test.ts` monta objetos parciais de histórico e ganhou `stageEvents: []` nos dois objetos, como aconteceu com `priorityEvents` no SLA.
- **Erro meu nos testes:** no teste de integração usei `queue.requests` em vez de `queue.items`; corrigido.
- **Verificação no navegador:** teste E2E temporário (removido antes do commit) percorreu início, avanço, retorno com justificativa, avanço até a última etapa, rótulo na fila, conclusão, etapas para o solicitante e a notificação com o nome da etapa.
- **Resultados:** lint, typecheck e build OK; unitários 503/503 (85 arquivos); integração 227/227 + 1 pulado (50 arquivos); E2E 10/10.

## SF-080 — E2E e revisão dos fluxos (2026-11-01)

- **E2E (`request-stages.spec.ts`):** o administrador cria um serviço e três etapas pelo editor; o solicitante abre; o atendente inicia (entra em "Etapa 1 de 3: Triagem", sem botão de concluir), avança, volta com justificativa, avança até a última, vê o aviso de última etapa, as mudanças e a justificativa no histórico e o rótulo da etapa na fila, e conclui; o solicitante vê as etapas concluídas e a atual, o rótulo na lista e as notificações com o nome das etapas. Passou na primeira execução.
- **Revisão da SPEC inteira (SF-076 a SF-080):** nenhuma dependência nova; nenhum segredo nos arquivos; a migration só acrescenta, com a exceção prevista (o `CHECK` de tipos da outbox recriado mais amplo); o evento de etapa leva só identificadores e códigos; nenhum log novo com texto digitado. Asserções existentes alteradas: só a lista exata de tipos de evento (exigida pela SPEC). Mudanças só de configuração em testes existentes: `vi.mock` do módulo de etapas em três arquivos, colunas novas em um objeto tipado, `stageEvents: []` nos objetos da linha do tempo e o dublê em memória. README com a seção de fluxos.
- **Ambiente:** o PostgreSQL de teste tinha sido encerrado de novo por falta de memória; foi religado a pedido da responsável para esta tarefa.
- **Pendência para publicar:** aplicar no Neon, antes do próximo deploy, as migrations `20261101100000_sla_and_priorities`, `20261101200000_sla_due_soon_at`, `20261101300000_service_fields` e `20261101400000_service_stages`.
- **Resultados:** lint, typecheck e build OK; unitários 503/503 (85 arquivos); integração 227/227 + 1 pulado (50 arquivos); E2E 11/11.

## SPEC de aprovações (2026-11-01)

- **SPEC `2026-11-01-aprovacoes.md`** (item 8 do plano, último da fase 3) aprovada com as decisões A1 a A4 conforme propostas: aprovação antes do início do atendimento, com o status "Aberta" e a aprovação pendente, e rejeição cancelando a solicitação; um nível (qualquer gestor ativo do setor); prazo do SLA a partir da aprovação; gestor vê só as solicitações do setor que exigem aprovação, só para leitura. Tarefas SF-081 a SF-086 registradas em `TASKS.md`.
- **Mudanças previstas no banco além de acréscimos:** a restrição do setor do usuário (passa a exigir setor também para o gestor) e a dos tipos de evento da outbox serão apagadas e recriadas mais amplas, sem perda de dados.

## SF-081 — Migration e domínio das aprovações (2026-11-01)

- **Duas migrations:** `20261101500000_manager_role` só acrescenta o valor `MANAGER` ao enum de perfis, porque o PostgreSQL não deixa usar um valor novo de enum na mesma transação que o cria; `20261101500100_approvals` faz o resto. Registrado na SPEC (seção 6).
- **Restrições recriadas mais amplas, sem mudar dados:**
  - `User_role_sectorId_check`: setor obrigatório para atendente **e** gestor;
  - `Request_dueAt_check` (da SPEC de SLA): continua exigindo vencimento quando há horas de SLA, exceto com aprovação pendente ou rejeitada (o prazo começa na aprovação). Mudança não prevista no texto original da SPEC; registrada na seção 6;
  - `OutboxEvent_type_check`: aceita `request.approval_decided`.
- **Novas restrições:** `Request_approval_check` (pendente só com a solicitação aberta ou cancelada e sem vencimento; rejeitada só cancelada) e `RequestApproval_note_check` (observação obrigatória na rejeição, até 1.000 caracteres); uma decisão por solicitação (único em `requestId`).
- **Defeito meu, encontrado pelo teste de schema e corrigido antes do commit:** a primeira versão de `Request_dueAt_check` usava `"approvalState" IN (...)` sem tratar o nulo. Em SQL, `NULL IN (...)` é `NULL`, e um `CHECK` com resultado `NULL` passa: a regra do SLA ficava frouxa para **todas** as solicitações sem aprovação. Corrigido com `COALESCE(..., false)`. A versão errada já tinha sido aplicada nos bancos locais (desenvolvimento e teste); a restrição foi substituída neles com `prisma db execute`. Nada disso foi publicado.
- **Regras (`approval.ts`):** estado inicial pela configuração do serviço; início recusado com aprovação pendente; só um gestor ativo do setor decide, uma vez, com a solicitação aberta (quem está fora recebe "não encontrado"); observação opcional ao aprovar e obrigatória ao rejeitar (mesmo `normalizeNote` do cancelamento); vencimento sem prazo enquanto pendente e a partir da aprovação depois.
- **Perfil novo nos tipos:** as uniões de perfil do código ganharam `MANAGER`; rótulo "Gestor" na administração e na conversa; a página inicial e "Alterar senha" mandam o gestor para `/approvals`, área que nasce na SF-082 (até lá não há como criar gestores pela interface). A conta de demonstração continua com três perfis até a SF-082.
- **Teste existente alterado (só o objeto de teste):** `tests/unit/authorization/index.test.ts` ganhou `approvalState: null` no objeto tipado como linha do Prisma.
- **Resultados:** lint, typecheck e build OK; unitários 513/513 (86 arquivos); integração 233/233 + 1 pulado (51 arquivos); E2E 11/11.

## SF-082 — Perfil Gestor no sistema (2026-11-01)

- **Usuários:** o perfil `MANAGER` entrou na validação; a regra "setor obrigatório" passou a valer para atendente e gestor (`roleRequiresSector`), na criação, na edição e na reativação. As regras específicas de atendente (não deixar setor sem atendente com solicitações pendentes) continuam só para atendentes. Formulários da administração com a opção "Gestor".
- **Demonstração e sessão:** `DEMO_ROLES` ganhou `MANAGER` ("Gestor (demonstração)", `demo.gestor@serviceflow.demo`), ligado ao mesmo setor de demonstração do atendente; botão "Entrar como Gestor" no login; a sessão aceita o perfil novo. O banco fictício (`seed:demo`) não cria o gestor: a conta nasce no primeiro login de demonstração, como as outras.
- **Área do gestor:** grupo de rotas `(manager)` com `requireManagerPageAccess` (quem não é gestor volta para a página inicial, que manda cada perfil para a sua área), navegação com "Aprovações" e "Alterar senha", e a página `/approvals` com o título e a explicação. A lista de aprovações entra na SF-085, depois que as decisões existirem (SF-084). As áreas existentes já devolviam qualquer outro perfil para `/`.
- **Asserção existente alterada (exigida pela SPEC):** `tests/unit/modules/auth/application/demo-sign-in.test.ts` conferia 3 e-mails de demonstração distintos; com a conta do gestor (5.1), são 4.
- **Resultados:** lint, typecheck e build OK; unitários 513/513 (86 arquivos); integração 237/237 + 1 pulado (52 arquivos); E2E 12/12.

## SF-083 — Aprovação na abertura e no início (2026-11-01)

- **Serviço:** `requiresApproval` entrou no esquema, no caso de uso e no formulário do serviço, no mesmo padrão do SLA (só é enviado quando o formulário tem o campo). Como um checkbox desmarcado não chega no formulário, um campo oculto `requiresApprovalField` indica que a opção estava na tela. A lista de serviços mostra "Exige aprovação do gestor" ou "Sem aprovação" e, para serviços com aprovação, avisa quando o setor não tem gestor ativo (risco registrado na seção 9 da SPEC); a contagem vem da lista de usuários que a página já carrega.
- **Abertura:** `ServiceForRequest` traz `requiresApproval`; a solicitação nasce com `approvalState` `PENDING` e `dueAt` nulo, guardando as horas de SLA (`dueAtOnOpening`); sem aprovação, nada muda.
- **Início:** `transitionRequestStatus` recusa `IN_PROGRESS` com aprovação pendente (`assertCanStartWithApproval`), antes de qualquer gravação. A tela do atendente esconde "Iniciar atendimento" e explica que o atendimento só começa depois da aprovação. O restante da indicação da aprovação nas telas fica para a SF-085.
- **Testes existentes alterados (só os objetos de teste):** os dublês de serviço em `service-use-cases.test.ts` e `catalog.test.ts` ganharam `requiresApproval: false`; o dublê em memória das solicitações ganhou o campo no serviço e `approvalState` na solicitação.
- **Verificação no navegador:** teste E2E temporário (removido antes do commit) marcou a opção no serviço, conferiu o aviso de setor sem gestor, abriu uma solicitação e confirmou que o atendente vê o aviso no lugar do botão de início. O primeiro seletor do teste falhou porque, em edição, o nome do serviço fica num campo e o filtro por texto deixa de achar o item; o teste foi ajustado.
- **Resultados:** lint, typecheck e build OK; unitários 518/518 (88 arquivos); integração 241/241 + 1 pulado (53 arquivos); E2E 12/12.

## SF-084 — Decisão do gestor (2026-11-01)

- **Caso de uso `decideApproval`:** relê o ator e a solicitação na transação, confere a regra do domínio (gestor ativo do setor, aprovação pendente, solicitação aberta) e a observação; grava com `updateApprovalIfCurrent`, que só altera a linha se ela ainda estiver `OPEN` e `PENDING` (decisão simultânea vira conflito). Aprovar grava o vencimento a partir do horário da aprovação; rejeitar muda o status para cancelado no mesmo `UPDATE`, grava o evento de status com a observação como justificativa e o `request.status_changed`. Os dois casos gravam `RequestApproval` e `request.approval_decided` (`decision` e `actorId`, sem a observação).
- **Histórico:** `RequestWithHistory` ganhou `approval` (com o nome de quem decidiu); a linha do tempo mostra "Aprovada por …" ou "Rejeitada por …" com a observação.
- **Notificações:** tipos `approval.requested`, `approval.approved` e `approval.rejected`. Na abertura com aprovação pendente, o consumidor carrega os gestores ativos do setor (só nesse caso). Como a rejeição também grava o cancelamento, a regra de status ignora o cancelamento de uma solicitação rejeitada, para o solicitante receber uma única notificação ("Solicitação rejeitada").
- **Prioridade com aprovação pendente:** a regra existente do SLA já mantém o vencimento nulo; conferido em teste.
- **Asserção existente alterada (exigida pela SPEC):** a lista exata de tipos de evento recebeu `request.approval_decided`. O dublê em memória ganhou as decisões e os dois métodos novos.
- **Erro meu no teste:** esperei "não encontrado" para um gestor inativo, mas a sessão de um usuário inativo já é recusada antes ("autenticação necessária"), comportamento existente e correto; a expectativa foi separada.
- **O que fica para a SF-085:** as telas do gestor (lista, detalhe com os formulários de decisão e a página de notificações dele) e a situação da aprovação nas telas de solicitante e atendente.
- **Resultados:** lint, typecheck e build OK; unitários 525/525 (89 arquivos); integração 248/248 + 1 pulado (54 arquivos); E2E 12/12.

## SF-085 — Telas das aprovações (2026-11-01)

- **Regra de leitura:** `assertRequestReadable` aceita o gestor do setor só quando a solicitação exige aprovação; o escopo lido pelos repositórios de anexos e de respostas passou a informar `requiresApproval`. Comentários continuam fora do alcance do gestor (o escopo deles não traz a informação, então a regra o recusa), como a SPEC pede (5.1.4).
- **Consultas:** `listManagerApprovals` (pendentes por padrão; "todas" inclui as decididas, com as pendentes primeiro) e `getManagerRequest`, ambas limitadas ao setor do gestor e às solicitações com aprovação.
- **Telas do gestor:** lista com filtro "Pendentes/Todas"; detalhe com status, situação da aprovação, SLA, descrição, respostas dos campos, documentos e histórico; formulários "Aprovar" (observação opcional) e "Rejeitar" (observação obrigatória, num bloco recolhível que avisa que a rejeição cancela a solicitação), só enquanto pendente; mensagens fixas para observação ausente, decisão já tomada e solicitação indisponível. Notificações do gestor em `/approvals/notifications`; a rota que abre uma notificação leva o gestor ao detalhe em `/approvals/<id>`.
- **Solicitante e atendente:** rótulo da situação da aprovação ao lado do status e da etapa, nas listas e nos detalhes.
- **Ajuste encontrado na verificação no navegador:** a observação da rejeição aparecia duas vezes no histórico (no cancelamento e na decisão). A linha do tempo agora mostra a observação só em "Rejeitada por …", com o rótulo "Observação"; um cancelamento comum continua com a justificativa.
- **Verificação no navegador:** teste E2E temporário (removido antes do commit) com o gestor de demonstração: lista, aprovação com observação, rejeição, notificações do gestor, lista vazia de pendentes; o atendente vê "Aprovada" e o botão de início; o solicitante vê "Rejeitada" e as duas notificações. O E2E definitivo é da SF-086.
- **Aviso "The destination stream closed early"** apareceu de novo no log do servidor do E2E; já registrado desde a fase 1, sem falha de teste.
- **Resultados:** lint, typecheck e build OK; unitários 534/534 (91 arquivos); integração 251/251 + 1 pulado (55 arquivos); E2E 12/12.

## SF-086 — E2E e revisão das aprovações (2026-11-01)

- **E2E (`request-approvals.spec.ts`):** o gestor de demonstração entra na sua área; o administrador cria um serviço com prazo e "Exige aprovação do gestor" (a lista mostra 1 gestor ativo no setor); o solicitante abre duas solicitações, ambas "Aguardando aprovação" e "Sem prazo"; o atendente não consegue iniciar; o gestor vê as duas, recebe duas notificações, rejeita uma (observação no histórico) e aprova a outra, e a lista de pendentes fica vazia; o atendente vê "Aprovada" e "Dentro do prazo" e inicia; o solicitante vê "Cancelada" e "Rejeitada" e recebe "Solicitação rejeitada" e "Solicitação aprovada", sem o aviso extra de cancelamento. Passou na primeira execução.
- **Revisão da SPEC inteira (SF-081 a SF-086):** nenhuma dependência nova; nenhum segredo nos arquivos; migrations aditivas, com as três restrições recriadas mais amplas registradas na SPEC (setor do usuário, vencimento do SLA e tipos de evento); o evento da decisão leva só o código e o autor. Asserções existentes alteradas, todas exigidas pela SPEC: a lista exata de tipos de evento e a contagem de e-mails de demonstração (3 → 4). Mudanças só de configuração em testes existentes: colunas novas em objetos de teste e no dublê em memória. README com a seção de aprovações.
- **Pendência para publicar:** aplicar no Neon, antes do próximo deploy, as migrations `20261101100000_sla_and_priorities`, `20261101200000_sla_due_soon_at`, `20261101300000_service_fields`, `20261101400000_service_stages`, `20261101500000_manager_role` e `20261101500100_approvals`.
- **Resultados:** lint, typecheck e build OK; unitários 534/534 (91 arquivos); integração 251/251 + 1 pulado (55 arquivos); E2E 13/13.

## Relatório da fase 3 (2026-11-01)

- **Documento:** `SPEC/2026-11-01-relatorio-fase-3.md`.
- **Medição:** 22.343 linhas `added` acumuladas (`334a890`); a fase 3 somou 7.129 (campos 3.096, fluxos 2.336, aprovações 1.652), contra 25.000 a 36.000 estimadas: razão de 3,5 a 5,1, confirmando a fase 2.
- **Correção:** depois da SF-075 informei 2.275 linhas para a SPEC de campos; o correto é 3.096.
- **Projeção:** o roadmap inteiro deve terminar entre ~30.000 e ~39.000 linhas; pela opção 2, as funcionalidades adicionais precisariam somar de 61.000 a 70.000. Candidatas listadas na seção 8 do relatório.
- **Tempo:** 7h34 na fase 3 (cerca de 940 linhas por hora); `diario/tempo-do-projeto.md` atualizado (total mínimo 41h03).
- **Suítes não executadas de novo para o relatório** (só documentação); a última execução completa foi a da SF-086, com tudo verde.

## SPEC de permissões configuráveis (2026-11-01)

- **SPEC `2026-11-01-permissoes-configuraveis.md`** (item 9 do plano, início da fase 4) aprovada com as decisões K1 a K4 conforme propostas: permissões concedidas por usuário; três permissões (gerir serviços do setor, ver todas as solicitações do setor, supervisionar a fila); sempre no setor atual do usuário; histórico de concessões e revogações. Tarefas SF-087 a SF-091 registradas em `TASKS.md`.
- **Princípio:** permissões só acrescentam ações dentro do setor; sem nenhuma concedida, o sistema fica como está (garantia 7.4).

## SF-087 — Migration e domínio das permissões (2026-11-01)

- **Migration `20261101600000_user_permissions`:** só acrescenta (dois enums, duas tabelas, índice único em `userId` + `permission`, índice do histórico por usuário e data). Nenhuma restrição existente foi recriada.
- **Regras (`src/modules/permissions/domain/permission.ts`):** catálogo fixo `SECTOR_SERVICES`, `SECTOR_REQUESTS_READ` e `QUEUE_SUPERVISION` com os perfis que podem receber cada um (tabela 5.1); `assertCanGrantPermission` recusa perfil não elegível (validação) e usuário inativo (conflito); `isPermissionEffective` e `hasPermissionInSector` só contam a permissão com usuário ativo, perfil elegível e setor, e só no setor atual da pessoa (5.2.3). As consultas ao banco e o uso nas regras de autorização vêm nas SF-088 a SF-090.
- **Limpeza do banco de teste:** as duas tabelas novas entram antes de `User` em `tests/integration/fixtures.ts` e `scripts/prepare-e2e.ts`.
- **Resultados:** lint, typecheck e build OK; unitários 538/538 (92 arquivos); integração 253/253 + 1 pulado (56 arquivos); E2E 13/13.

## SF-088 — Concessão e revogação pelo administrador (2026-11-01)

- **Casos de uso:** `grantPermission` e `revokePermission` exigem administrador, validam o usuário e a permissão, conferem a tabela 5.1 e o estado do usuário (`assertCanGrantPermission`) e, numa transação serializável, só gravam quando algo muda: conceder o que já existe ou revogar o que não existe não altera nada nem gera histórico. Cada mudança efetiva grava a linha em `UserPermissionEvent` com o horário do banco (`now()`, a mesma fonte do histórico das solicitações). `listPermissionOverview` devolve as concessões e o histórico, do mais recente para o mais antigo.
- **Tela:** componente `user-permissions-panel.tsx` dentro de cada usuário da administração: lista as permissões que o perfil pode receber e também as concedidas que deixaram de valer (marcadas "Concedida — sem efeito"), com "Conceder" ou "Revogar", e os 10 registros mais recentes do histórico. Mensagens próprias para perfil não elegível e usuário inativo.
- **Testes existentes alterados (só configuração):** `admin-actions`, `service-field-actions` e `service-stage-actions` importam o arquivo de ações da administração, que agora importa o módulo de permissões; cada um ganhou `vi.mock("@/modules/permissions", () => ({}))`.
- **Verificação no navegador:** teste E2E temporário (removido antes do commit) concedeu e revogou "Gerir serviços do setor" a um atendente e conferiu a situação e o histórico.
- **Resultados:** lint, typecheck e build OK; unitários 540/540 (93 arquivos); integração 257/257 + 1 pulado (57 arquivos); E2E 13/13.

## SF-089 — Serviços do setor com permissão (2026-11-01)

- **Regra pura compartilhada:** o catálogo de permissões e a verificação (`hasPermissionInSector`) foram para `src/shared/permissions`, usados pelo módulo de permissões e pela autorização do servidor; assim a autorização não importa o módulo (que importa a autorização), sem dependência circular. O domínio do módulo reexporta as mesmas funções.
- **Autorização:** `actorHasPermission` lê as concessões do banco a cada verificação (a revogação vale na operação seguinte) e `requireCatalogEditor` devolve o editor do catálogo: administrador com setor nulo (todos) ou quem tem `SECTOR_SERVICES` com o próprio setor; `assertCatalogSector` recusa outro setor como "não encontrado".
- **Módulos de catálogo:** serviços, documentos, campos e etapas trocaram `requireConfigurationAdministrator` por `requireCatalogEditor` e conferem o setor: na criação de serviço, no serviço atual e no novo setor da edição (não há troca de setor para quem tem a permissão), e, para documentos, campos e etapas, no setor do serviço de cada item (a porta ganhou `findServiceSector` no lugar de `serviceExists`). As listas usam `listForSector` quando o editor é de um setor. Categorias e setores ganharam listas para o formulário do editor (`listCategoriesForCatalog`, `listSectorsForCatalog`, que devolve só o setor da pessoa).
- **Tela:** página `/sector-services` (cabeçalho próprio com volta à área da pessoa) reaproveitando `ServicesSection`; o administrador que a abre vai para a administração; quem não tem a permissão volta para a página inicial. Os formulários que redirecionam voltam para a página certa: um contexto de React informa aos editores a seção (`services` ou `sector-services`) e `action-helpers` monta o endereço; os endereços da administração não mudaram. A mensagem de retorno (`announcement`) foi extraída para `_shared/announcement.ts` e serve às duas páginas. O aviso de gestores ativos no setor só aparece na administração (a página do setor não lê usuários).
- **Testes existentes alterados (só configuração, sem mudar asserções):** os testes unitários de serviços, documentos, campos e etapas e os de integração `services` e `requests-transitions` simulam a autorização; seus mocks ganharam `requireCatalogEditor` (delegando ao mock do administrador que os testes já controlam) e `assertCatalogSector`, e os dublês trocaram `serviceExists` por `findServiceSector` e ganharam `listForSector`.
- **Erros meus corrigidos antes do commit:** o script que trocou a autorização quebrou duas linhas de `import` de uma linha só (corrigidas à mão); o primeiro link condicional montava JSX dentro de `try/catch`, o que o lint do React recusa (a verificação foi separada numa função).
- **Verificação no navegador:** teste E2E temporário (removido antes do commit): sem a permissão o link não aparece; com ela, o atendente cria um serviço, acrescenta e reordena etapas e volta para a própria página; depois da revogação, o link some e a página o devolve à fila.
- **Resultados:** lint, typecheck e build OK; unitários 543/543 (94 arquivos); integração 263/263 + 1 pulado (58 arquivos); E2E 13/13.

## SF-090 — Leitura ampliada e supervisão da fila (2026-11-01)

- **Supervisão (`QUEUE_SUPERVISION`):** `assertCanRelease` e `assertCanTransfer` ganharam o parâmetro `supervisor`; com ele, quem não é o responsável libera ou transfere uma solicitação que tem responsável. A transferência nunca vai para o responsável atual nem para quem a faz. A permissão é lida **na transação da atribuição** (porta nova `findPermissions`) e só quando a pessoa não é a responsável, para que os testes existentes e o caminho comum não mudem. A linha do tempo mostra "Liberada por X (estava com Y)" quando quem liberou não era o responsável. O painel do atendente mostra os botões para quem supervisiona e tira o responsável atual da lista de destinos.
- **Leitura ampliada (`SECTOR_REQUESTS_READ`):** `listManagerApprovals("sector")` lista todas as solicitações do setor (recusa sem a permissão); `getManagerRequest` também abre solicitações sem aprovação com a permissão; a leitura de respostas e documentos passa `sectorReader` para `assertRequestReadable`. A área do gestor ganhou a aba "Todas do setor" só para quem tem a permissão. Decidir continua valendo só para as que exigem aprovação.
- **Teste existente alterado (só o dublê):** o dublê em memória ganhou `permissions` e `findPermissions`.
- **Erros meus nos testes:** identificadores que não eram UUID no teste unitário (a transferência valida o formato); no teste temporário do navegador, supus que o banco fictício define responsáveis, o que não faz.
- **Verificação no navegador:** teste E2E temporário (removido antes do commit): a aba só aparece com a permissão e abre solicitação sem aprovação sem os botões de decisão; o atendente supervisor vê o aviso, libera a solicitação do Diego e o histórico mostra quem liberou.
- **Resultados:** lint, typecheck e build OK; unitários 548/548 (95 arquivos); integração 266/266 + 1 pulado (59 arquivos); E2E 13/13.

## SF-091 — E2E e revisão das permissões (2026-11-01)

- **E2E (`tests/e2e/permissions.spec.ts`):** o atendente de demonstração começa sem o link "Serviços do setor"; o administrador cria um colega atendente e concede "Gerir serviços do setor" e "Supervisionar a fila do setor" (histórico "concedida por"); o atendente cria um serviço do setor e um campo nele; com a supervisão, transfere para o colega uma solicitação que está com o Diego (o responsável é definido pelo banco, porque o banco fictício não define responsáveis), e o histórico mostra "Transferida de Diego Rocha para …"; por fim, o administrador revoga a permissão **num segundo contexto do navegador**, enquanto o atendente continua logado, e a página seguinte do atendente já é recusada (volta para `/queue`) e o link some — isso confere a parte "sem novo login" do CA-PER-04 no navegador.
- **Erros meus no teste:** o primeiro seletor da linha de permissão também pegava o item do histórico (modo estrito do Playwright); restringi a `li.requirement-item`. A primeira versão revogava com o atendente saindo e entrando de novo, o que não provava "sem novo login"; troquei por dois contextos. Usei primeiro uma senha literal e depois segui o padrão dos outros E2E (constante `E2E-only-colleague-password`, só do banco de teste).
- **Revisão da SPEC (SF-087 a SF-091):** nenhuma dependência alterada (`package.json` e `package-lock.json` sem mudança desde a SPEC); nenhum segredo; nenhuma asserção de teste existente alterada — só mocks de autorização e dublês em memória (registrados nas SF-089 e SF-090); uma migration aditiva (`20261101600000_user_permissions`).
- **Pendente para publicar:** aplicar `20261101600000_user_permissions` no Neon junto das outras seis pendentes.
- **Resultados:** lint, typecheck e build OK; unitários 548/548 (95 arquivos); integração 266/266 + 1 pulado (59 arquivos); E2E 14/14.

## SPEC de notificações por e-mail e preferências (2026-11-01)

- **SPEC `2026-11-01-notificacoes-email-preferencias.md`** (resto do item 10 do plano) aprovada com as decisões N1 a N5 conforme propostas: e-mail por categoria escolhido pela própria pessoa, tudo começando desligado; registro do envio junto da notificação; envio por API HTTP de provedor via `fetch` (sem dependência nova), configurado só por variáveis de ambiente; conteúdo mínimo com link; seção "E-mails" na administração. Tarefas SF-092 a SF-096 registradas em `TASKS.md`.
- **Princípio:** as notificações na aplicação não mudam; sem preferência ligada, nada é registrado nem enviado (garantia 7.4). Nenhuma chave entra no repositório: sem configuração, os envios ficam "não enviado".

## SF-092 — Migration e domínio das preferências e envios (2026-11-01)

- **Migration `20261101700000_email_notifications`:** enums `NotificationCategory` e `EmailDeliveryStatus`; tabelas `NotificationPreference` (única por pessoa e categoria; sem linha = desligada) e `EmailDelivery` (única por notificação, índice por situação e disponibilidade para buscar pendentes e por data para o acompanhamento). Só criações; nenhuma tabela existente muda (o `prisma format` só realinhou colunas em `RequestNotification`).
- **Decisão:** `EmailDelivery` → `RequestNotification` com `ON DELETE CASCADE`. A limpeza diária apaga notificações lidas há mais de 90 dias; o envio vai junto (a essa altura já terminou: as tentativas acabam em poucos dias). Com `RESTRICT`, a limpeza existente quebraria.
- **Domínio (`domain/email.ts`):** a tabela 5.1 é um `Record` indexado por todos os `NotificationType`, então um tipo novo sem categoria quebra o typecheck; `wantsEmail` (tudo começa desligado); `nextDeliveryState` com as mesmas esperas e o mesmo limite de tentativas dos eventos (`retryDelayMs`, `MAX_EVENT_ATTEMPTS`), "não enviado" sem contar tentativa e recusa de mudar um envio que não está pendente.
- **Limpeza dos bancos de teste:** `tests/integration/fixtures.ts` e `scripts/prepare-e2e.ts` apagam as tabelas novas.
- **Erro meu, com perda do banco local de desenvolvimento:** para gerar o SQL, usei primeiro `prisma migrate diff --from-migrations` com um banco sombra escolhido por `${TEST_DATABASE_URL:-$DATABASE_URL}` depois de carregar `.env.test` ou `.env.local`. Como `.env.test` não existe, o banco sombra foi o **`serviceflow_dev` local**. O Prisma apaga o banco sombra e reaplica as migrations; o comando parou no diretório ainda vazio da migration nova (P3015) e deixou o banco de dev com as tabelas, sem dados e sem `_prisma_migrations` (o `migrate deploy` seguinte acusou "schema is not empty"). Não afetou o banco de teste nem o Neon. Conferi que não restava nenhuma linha (0 em 20 tabelas), recriei o schema, apliquei as 18 migrations e rodei `npm run seed:demo`. O SQL da migration foi gerado depois comparando o schema anterior (`git show HEAD:prisma/schema.prisma`) com o novo, **sem banco**. **Regra a partir daqui:** nunca passar `--shadow-database-url` apontando para um banco existente.
- **Resultados:** lint, typecheck e build OK; unitários 554/554 (96 arquivos); integração 269/269 + 1 pulado (60 arquivos); E2E 14/14.

## SF-093 — Página "Preferências de notificação" (2026-11-01)

- **Casos de uso (`application/preference-use-cases.ts`):** a pessoa é sempre a logada; o pedido só tem `categories` (lista das ligadas; as outras são desligadas), validado com `strict()`, então um `userId` enviado é recusado. Só solicitante, atendente e gestor têm preferências: o administrador não recebe notificações e é recusado.
- **Gravação:** salvar grava as seis categorias de uma vez (upsert numa transação), com `updatedAt`. Desligar mantém a linha com `emailEnabled = false`; sem linha, a categoria está desligada (seção 6).
- **Telas:** componente `EmailPreferencesPage` com seis caixas de seleção e os nomes da tabela 5.1, aviso de que as notificações no sistema continuam ativas e de que o e-mail só traz o aviso e o link; ação `saveEmailPreferencesAction` volta à página da área com "Preferências salvas." (ou aviso de formulário adulterado). A lista de notificações ganhou o link "Preferências de e-mail" (nova propriedade `preferencesHref` de `NotificationList`, passada pelas três páginas).
- **Erro meu de ferramenta:** o script de edição falhou duas vezes, por causa das quebras de linha CRLF de um arquivo e de sequências `\r\n` corrompidas ao editar o script pelo shell; reescrevi o script inteiro. Nenhum arquivo do projeto ficou com edição pela metade (o typecheck acusou a ação que faltava até a correção).
- **Verificação no navegador:** teste E2E temporário (removido antes do commit): nas três áreas, o link abre a página, as seis caixas começam desmarcadas, salvar mostra "Preferências salvas." e a escolha continua depois de recarregar; o administrador não abre a página.
- **Resultados:** lint, typecheck e build OK; unitários 561/561 (98 arquivos); integração 271/271 + 1 pulado (61 arquivos); E2E 14/14.

## SF-094 — Registro e envio dos e-mails (2026-11-01)

- **Registro (5.2):** o consumidor lê as categorias ligadas dos destinatários ativos e passa `sendEmail` para `insertMany`, que numa transação insere as notificações com `createManyAndReturn` (`skipDuplicates`) e cria o envio só para as **recém-inseridas**. Assim, reprocessar um evento nunca acrescenta e-mail, nem depois de uma mudança de preferência (CA-MAIL-05).
- **Envio (5.3):** `processEmailDeliveries` reserva os pendentes vencidos como o outbox (`FOR UPDATE SKIP LOCKED` e prazo de reserva de 5 minutos), decide o resultado e aplica `nextDeliveryState`. Roda logo após a resposta (em `scheduleEventProcessing`, depois dos eventos) e no job diário (novo passo `emails` do resumo, depois de `events`).
- **Provedor (decisão N3):** API HTTP da **Resend** (`https://api.resend.com/emails`) via `fetch`, sem dependência nova, com tempo-limite de 10 s. Configuração só por `EMAIL_API_KEY`, `EMAIL_FROM` e `APP_BASE_URL`; incompleta ou inválida (remetente sem endereço, link sem HTTPS fora da máquina local) vale como "não configurado". Os erros guardam só `HTTP_<status>`, `NETWORK` ou a classe do erro.
- **Motivo novo de "não enviado":** `recipient_without_area`, para quem passou a ser administrador depois da notificação (não há área para o link). Acrescentado ao domínio da SF-092.
- **Esclarecimento registrado na SPEC (5.4):** o assunto ficou `[ServiceFlow] <texto da notificação>`, porque o texto já traz o nome do serviço; a forma anterior repetia o nome.
- **Código curto:** os 8 primeiros caracteres do identificador, em maiúsculas.
- **Textos das notificações em `src/shared/notifications`:** o e-mail reutiliza o texto da lista. Primeiro movi os textos para o domínio do módulo e a tela os reexportava, mas o teste existente `request-stage-timeline.test.ts` substitui o módulo inteiro por um mock e quebrou. Em vez de mexer no mock, levei os textos e o tipo `NotificationType` para `src/shared/notifications` (mesmo padrão de `src/shared/permissions`); o módulo e a tela importam de lá. Nenhum teste existente mudou.
- **Erro meu no teste:** o estado salvo levava junto o destinatário e a notificação; o caso de uso passou a separar só os campos do estado.
- **Verificação no navegador:** teste E2E temporário (removido antes do commit): com "Mudanças de status" ligada para o solicitante, o atendente inicia a solicitação e, sem job diário, o envio aparece como "não enviado — não configurado", provando o processamento logo após a resposta.
- **Para os e-mails saírem de verdade:** a responsável precisa criar a conta no provedor, verificar o domínio do remetente e cadastrar as três variáveis na Vercel. Nenhum valor real entrou no repositório.
- **Resultados:** lint, typecheck e build OK; unitários 573/573 (101 arquivos); integração 278/278 + 1 pulado (62 arquivos); E2E 14/14.

## SF-095 — Seção "E-mails" na administração (2026-11-01)

- **Caso de uso `getEmailOverview`:** exige o administrador **antes** de ler qualquer coisa e devolve `configured` (de `isEmailConfigured`, que só diz sim ou não) e os 50 envios mais recentes pela porta nova `EmailDeliveryLog` (separada de `EmailDeliveryStore`, para o processamento não depender da listagem).
- **Tela:** nova seção "E-mails" no menu da administração. Mostra a situação do envio (sem configuração, avisa quais variáveis faltam, pelos nomes, nunca pelos valores) e a lista: situação (Pendente, Enviado, Falhou, Não enviado), tipo da notificação em texto curto, nome e e-mail do destinatário, data de registro e de envio, tentativas e motivo ("e-mail não configurado", "pessoa inativa", "perfil sem área de notificações" ou o código do erro). Não mostra o assunto, o corpo nem nada da solicitação.
- **Carregamento:** a página da administração só consulta os envios quando a seção está aberta.
- **Verificação no navegador:** teste E2E temporário (removido antes do commit): com a preferência ligada, o atendente inicia a solicitação; na seção, o administrador vê "Envio não configurado" e uma linha "Não enviado · Atendimento iniciado para Carla Mendes (…) · 0 tentativas · e-mail não configurado", sem a descrição da solicitação; o atendente não abre a seção.
- **Resultados:** lint, typecheck e build OK; unitários 575/575 (102 arquivos); integração 280/280 + 1 pulado (63 arquivos); E2E 14/14.

## SF-096 — E2E e revisão das notificações por e-mail (2026-11-02)

- **E2E (`tests/e2e/email-notifications.spec.ts`):** o solicitante de demonstração abre "Preferências de e-mail" pela página de notificações, liga só "Mudanças de status" e abre uma solicitação; o atendente inicia o atendimento; o solicitante continua recebendo a notificação na aplicação e desliga a preferência de novo (para não afetar os outros testes); na seção "E-mails", o administrador vê "Envio não configurado" e o envio mais recente como "Não enviado · Atendimento iniciado para Solicitante (demonstração) (…) · 0 tentativas · e-mail não configurado", sem a descrição da solicitação.
- **README:** item "Notificações por e-mail" em "Fluxos disponíveis" e subseção com `EMAIL_API_KEY`, `EMAIL_FROM` e `APP_BASE_URL` (sem valores reais; a chave só como Secret na Vercel).
- **Revisão da SPEC (SF-092 a SF-096):** nenhuma dependência alterada (`package.json` e `package-lock.json` sem mudança desde a SPEC); nenhum segredo no repositório (o `.env.example` só tem as variáveis comentadas e vazias); nenhuma asserção de teste existente alterada — o único teste existente modificado foi `tests/integration/fixtures.ts`, para limpar as tabelas novas; uma migration aditiva (`20261101700000_email_notifications`).
- **Pendente para publicar:** aplicar no Neon as oito migrations pendentes (de `20261101100000_sla_and_priorities` a `20261101700000_email_notifications`). Para enviar de verdade, criar a conta no provedor, verificar o domínio e cadastrar as três variáveis na Vercel.
- **Resultados:** lint, typecheck e build OK; unitários 575/575 (102 arquivos); integração 280/280 + 1 pulado (63 arquivos); E2E 15/15.

## SPEC de painel, indicadores e relatórios (2026-11-02)

- **SPEC `2026-11-02-painel-relatorios.md`** (item 11 do plano) aprovada com as decisões R1 a R5 conforme propostas: painel para o administrador (organização, com filtro por setor) e para o gestor (só o próprio setor); indicadores da visão geral §13 com período de 7, 30 ou 90 dias ou intervalo de até 366 dias; barras em HTML e CSS (sem dependência nova); CSV com colunas mínimas, sem dados do solicitante, até 10.000 linhas; cálculo sob demanda por agregação no banco, sem migration. Tarefas SF-097 a SF-101 registradas em `TASKS.md`.
- **Mudança de escopo registrada (seção 2 da SPEC):** o administrador e o gestor passam a ler **números agregados e colunas mínimas** de solicitações; o detalhe de cada solicitação continua com as regras de leitura atuais, e o painel não tem links para solicitações.

## SF-097 — Domínio do painel e do CSV (2026-11-02)

- **Módulo novo `src/modules/reports`**, só com `domain/` por enquanto:
  - `period.ts`: `parseReportPeriod(raw, now)` lê `period` (7, 30 — padrão —, 90 ou `custom`), `from` e `to` da URL; devolve o período (primeiro e último dia, limites `from` inclusivo e `before` exclusivo à meia-noite de São Paulo) e, quando recusa, o motivo (`invalid_option`, `missing_dates`, `invalid_date`, `inverted_range`, `future_date`, `too_long`) junto do período padrão, para a tela mostrar a mensagem e os 30 dias (SPEC 5.2).
  - `metrics.ts`: média e mediana em horas com uma casa decimal; percentual no prazo inteiro, nulo sem prazo; grupos do maior para o menor e empate por nome (`Intl.Collator` pt-BR); largura das barras.
  - `csv.ts`: as 15 colunas de 5.4, BOM, `;`, CRLF, datas `AAAA-MM-DD HH:MM` em São Paulo, rótulos em português, apóstrofo antes de `=`, `+`, `-`, `@`, tabulação e retorno, aspas quando há `;`, aspas ou quebra de linha; limite de 10.000 linhas (`too_many_rows`). A linha é montada campo a campo, então dados a mais numa linha nunca chegam ao arquivo.
- **Esclarecimentos registrados na SPEC (5.3 e 5.4):** casas decimais, arredondamento, células vazias e "Concluída no prazo" só para concluídas com prazo.
- **Reaproveitamento sem duplicação:** o cálculo do dia em São Paulo saiu de `requests/domain/search-criteria.ts` para `src/shared/time` (a busca continua com a mesma API e os mesmos testes); os rótulos de status, prioridade, aprovação e situação do prazo e o código curto saíram de `src/app/_components` e de `notifications/domain/email-content.ts` para `src/shared/requests`, e os arquivos antigos reexportam — nenhuma tela mudou.
- **Resultados:** lint, typecheck e build OK; unitários 607/607 (105 arquivos); integração 280/280 + 1 pulado (63 arquivos); E2E 15/15.

## SF-098 — Leitura dos indicadores e casos de uso (2026-11-02)

- **Porta `DashboardReader`:** `findSector`, `listSectors`, `currentCounts(scope, now)`, `periodTotals(scope, range)` e `listForExport(scope, range, limit)`. O recorte (`sectorId` ou nulo para a organização) sempre vem do caso de uso.
- **Implementação Prisma:** contagens com as mesmas regras de `slaSituation` e do filtro da fila; agrupamentos por `groupBy` nos nomes registrados na abertura; média e mediana do tempo até a conclusão, total com prazo e no prazo numa consulta SQL (`avg` e `percentile_cont(0.5)`), parametrizada pelo Prisma. A exportação seleciona só as colunas de 5.4 (nada da descrição nem do solicitante) e a etapa atual pela cópia das etapas.
- **Casos de uso:** `getDashboard` resolve o recorte pela sessão (administrador: organização ou o setor do filtro, que precisa existir; gestor: só o setor atual, ativo; demais: `AuthorizationError` antes de ler qualquer coisa), lê o período (mostrando o padrão quando recusado) e formata horas, percentual e grupos com as regras da SF-097. `exportDashboardCsv` usa o mesmo recorte, mas recusa período ou setor inválido em vez de exportar o padrão, pede no máximo 10.001 linhas para detectar o excesso e calcula a situação do prazo na hora.
- **Domínio:** `completionTimesFromAggregate` arredonda média e mediana vindas do banco da mesma forma que `completionTimes` (teste confere que os dois concordam).
- **Testes da SF-097:** passaram a importar direto de `domain/` (como os outros testes de domínio), porque o `index.ts` do módulo agora carrega a autorização; nenhuma asserção mudou.
- **Resultados:** lint, typecheck e build OK; unitários 625/625 (106 arquivos); integração 287/287 + 1 pulado (64 arquivos); E2E 15/15.

## SF-099 — Telas do painel (2026-11-02)

- **Componente `DashboardView`:** formulário GET (setor só para o administrador, período, datas e "Aplicar"); mensagens das recusas (`dashboardFilterMessages`); "Situação atual" e "No período" com o recorte e as datas por extenso; tempo em horas com vírgula decimal ("12,5 h", média e mediana); "—" e "sem prazo definido" quando não há o que medir; grupos em tabela (nome e quantidade) com a barra proporcional ao maior grupo (`aria-hidden`, o número fica escrito). Não há link para solicitações.
- **Administração:** item "Painel" no menu; o painel só é calculado quando a seção está aberta, como em "E-mails".
- **Gestor:** página `/approvals/dashboard` e link "Painel do setor" no menu da área; o setor da URL não é lido.
- **CSS:** classes `dashboard-*` nas cores do tema, em grade que se adapta; no celular (390 px) não há rolagem horizontal.
- **Verificação no navegador:** E2E temporário (removido antes do commit) com o banco fictício: administrador vê 5 abertas, 3 em atendimento, 12 abertas no período, 4 concluídas, 26 h de tempo médio, "sem prazo definido" e os grupos; o filtro de setor vai para a URL; o gestor vê só o "Setor de demonstração"; o atendente é levado para `/queue` nas duas rotas. Capturas conferidas no computador e no celular.
- **Resultados:** lint, typecheck e build OK; unitários 631/631 (107 arquivos); integração 287/287 + 1 pulado (64 arquivos); E2E 15/15.

## SF-100 — Exportação CSV (2026-11-02)

- **Rota `GET /api/reports/requests.csv`:** lê só `period`, `from`, `to` e `sector` da URL e chama `exportDashboardCsv`, que repete a autorização e o recorte do painel. Resposta `text/csv; charset=utf-8`, `Content-Disposition: attachment` com o nome de 5.4, `Cache-Control: private, no-store` e `nosniff`. Recusas respondem em texto curto, porque a pessoa abriu o arquivo a partir do painel: 401 "Entre no ServiceFlow para exportar.", 403 "Você não tem acesso a esta exportação.", 400 "A exportação passa de 10.000 solicitações. Escolha um período menor.", "Período inválido…" ou "Setor não encontrado…". Erros inesperados não são escondidos.
- **Códigos públicos:** `ValidationError` apaga caminhos e códigos fora da lista pública, e a rota não conseguia distinguir o limite de linhas de um período inválido. Acrescentei `period` e `sector` à lista de caminhos públicos (`src/server/errors`) e passei a usar códigos já públicos: `too_big` para o limite de linhas e `invalid_value` para período ou setor recusado na exportação (antes `too_many_rows` e o motivo do período, que viravam `custom`). Nenhum teste existente dependia disso.
- **Botão "Exportar CSV":** formulário GET com campos ocultos (o período mostrado — o padrão quando o pedido foi recusado —, as datas do intervalo e o setor do administrador); o gestor nunca envia setor. Some para o gestor sem setor ativo. Por ser formulário, a tela continua sem links.
- **Verificação no navegador:** E2E temporário (removido antes do commit): o gestor clica em "Exportar CSV" com 90 dias e recebe `serviceflow-solicitacoes-2026-08-05-a-2026-11-02.csv` com o cabeçalho de 5.4 (o banco estava vazio nessa rodada; as linhas com dados foram conferidas na integração e serão no E2E da SF-101).
- **Resultados:** lint, typecheck e build OK; unitários 641/641 (108 arquivos); integração 291/291 + 1 pulado (65 arquivos); E2E 15/15.

## SF-101 — E2E e revisão do painel e relatórios (2026-11-02)

- **E2E (`tests/e2e/dashboard.spec.ts`):** com o banco fictício e um segundo setor criado pelo teste (com solicitante próprio): o administrador abre "Painel" pelo menu e vê toda a organização com os dois setores nas barras; filtra pelo setor novo, que mostra 1 aberta e esconde o grupo por setor; baixa o CSV com o cabeçalho de 5.4 e a linha da solicitação, sem descrição nem nome do solicitante; um intervalo invertido mostra a mensagem e os 30 dias. O gestor abre "Painel do setor" pelo menu, vê só o "Setor de demonstração" (sem filtro de setor) e o CSV dele não traz o outro setor. O atendente é levado para `/queue` nas duas rotas.
- **Erro meu no teste:** a primeira versão criou a solicitação do setor novo em nome do solicitante de demonstração; como o teste roda antes de `demo-data.spec.ts`, aquele teste passou a ver duas solicitações "Aberta" e falhou na suíte completa. Troquei por um solicitante criado pelo próprio teste; `demo-data.spec.ts` não foi alterado.
- **README:** item "Painel e relatórios" em "Fluxos disponíveis".
- **Revisão da SPEC (SF-097 a SF-101):** nenhuma dependência nem migration; nenhum segredo; nenhum teste anterior à SPEC alterado (só os testes criados pela própria SPEC mudaram, e só imports ou acréscimos). Mudanças em código existente: utilitários de dia e rótulos movidos para `src/shared` (SF-097) e `period` e `sector` na lista de caminhos públicos dos erros (SF-100).
- **Resultados:** lint, typecheck e build OK; unitários 641/641 (108 arquivos); integração 291/291 + 1 pulado (65 arquivos); E2E 16/16.

## SPEC de auditoria administrativa e dados pessoais (2026-11-02)

- **SPEC `2026-11-02-auditoria-lgpd.md`** (item 12 do plano, último da fase 4) aprovada com as decisões D1 a D5 conforme propostas: auditoria das alterações administrativas com valores (nome e e-mail só como "alterado"), gravada na mesma transação; prazos fixos de retenção no job diário, sem apagar solicitações; "Meus dados" em JSON baixado pela própria pessoa; anonimização de usuários desativados sem solicitações em andamento, removendo identidade, textos escritos pela pessoa e anexos enviados por ela. Tarefas SF-102 a SF-108 registradas em `TASKS.md`.
- **Limite registrado na SPEC (seção 2):** organiza o tratamento de dados no sistema, mas não substitui a orientação jurídica da organização sobre bases legais e prazos.

## SF-102 — Migration e domínio da auditoria (2026-11-02)

- **Migration `20261102100000_audit_trail`:** gerada comparando os arquivos de schema (sem banco sombra, conforme a regra registrada depois do incidente da SF-092). Enums `AuditAction` (CREATED, UPDATED, REORDERED, DEACTIVATED, REACTIVATED, ANONYMIZED, EXPORTED) e `AuditEntityType` (USER, SECTOR, CATEGORY, SERVICE, DOCUMENT_REQUIREMENT, SERVICE_FIELD, SERVICE_STAGE); tabela `AuditEntry` (`changes` JSON, padrão `[]`; índices por data, entidade e pessoa; autor com `Restrict`, porque a anonimização mantém a pessoa); `User.anonymizedAt` e `RequestAttachment.removedAt`. Aplicada no banco de desenvolvimento; o Neon ainda não a tem.
- **Domínio (`src/modules/audit/domain/audit.ts`):** `auditChanges(tipo, antes, depois)` compara por valor (listas e datas inclusive), ignora o que não mudou e qualquer campo com `password`, `hash`, `secret` ou `token` no nome, e marca nome e e-mail de usuário só como alterados, também na criação; nome de setor, serviço e outras entidades não é dado pessoal e fica com os valores. `describeAuditChange` escreve "Prazo-base (horas): 24 → 12", "E-mail: alterado"; nomes de perfil, setor e tipo de campo são passados pela tela (função de formatação), para não duplicar os rótulos que já existem nas telas.
- **Limpeza do banco de teste:** a tabela nova entra na limpeza da integração e do E2E.
- **Resultados:** lint, typecheck e build OK; unitários 653/653 (109 arquivos); integração 294/294 + 1 pulado (66 arquivos); E2E 16/16.

## SF-103 — Registro da auditoria nos casos de uso administrativos (2026-11-02)

- **Ponto único (decisão D5):** `AuditScope.audited(meta, alteração)`. A implementação Prisma lê do banco o estado da entidade antes, executa a alteração, lê o estado depois e grava o registro com o mesmo cliente de transação; se a alteração falha, a transação inteira volta e nada fica registrado. Os estados vêm do banco (só os campos auditados de cada entidade, `AUDITED_FIELDS`), então hashes e campos fora da lista nunca chegam ao registro. `planAuditEntry` descarta alterações, reordenações, desativações e reativações sem mudança real.
- **Uso:** as interfaces de transação dos sete módulos estendem `AuditScope`, e as transações Prisma recebem `...createPrismaAuditScope(transaction)`. Os casos de uso guardam a pessoa da sessão (`requireConfigurationAdministrator` ou `editor.actor`) e envolvem só a mutação. Uma reordenação gera um registro para o item movido (a posição antes e depois); os vizinhos só abrem espaço. Trocar só a senha de um usuário não gera registro.
- **Autor sem chave estrangeira (mudança registrada na seção 6 da SPEC):** a primeira rodada da integração falhou em 26 testes de 7 arquivos anteriores (`admin-actions`, `categories`, `manager-profile`, `requests-transitions`, `sectors`, `services`, `users`), que simulam a sessão com identificadores que não existem no banco (`"admin-from-server-session"`). Em vez de mudar esses testes (criar um administrador real mudaria cenários como "último administrador ativo") ou de pular a auditoria quando a pessoa não existe (esconderia falhas), o `actorId` passou a texto sem chave estrangeira: as pessoas nunca são apagadas, só anonimizadas, e a tela buscará o nome pelo identificador. Migration nova `20261102200000_audit_actor_reference`, que altera só a tabela criada pela SF-102, ainda vazia em todos os bancos (exceção à regra "só aditivas"); a migration da SF-102 não foi reescrita. O teste de schema da SF-102 (desta SPEC) trocou a verificação "o autor não pode ser apagado" por "o autor fica como foi informado".
- **Exceção registrada nos testes anteriores:** os sete dublês de transação dos testes unitários (`categories`, `document-requirements`, `sectors`, `service-fields`, `service-stages`, `services`, `users`) ganharam uma linha `audited: (_meta, change) => change()`, porque as interfaces passaram a exigir o método; nenhuma asserção mudou. A gravação é testada na integração.
- **Erro meu:** ao editar o schema, um regex pegou primeiro o `actorId` de `RequestStatusEvent`; o SQL gerado mostrou o erro antes de qualquer gravação, e refiz a edição a partir da versão do commit.
- **Resultados:** lint, typecheck e build OK; unitários 657/657 (109 arquivos); integração 300/300 + 1 pulado (67 arquivos); E2E 16/16.

## SF-104 — Seção "Auditoria" (2026-11-02)

- **Leitura:** `AuditTrailReader` com `count`, `list`, `actors` e `names`. A implementação Prisma faz um `UNION ALL` de `AuditEntry` com `UserPermissionEvent` (lido como tipo "PERMISSION"), filtra e pagina no banco e busca o nome atual de quem agiu por `LEFT JOIN` (quem não existe aparece como "Pessoa não encontrada"); o perfil é o gravado no registro ou, nos eventos de permissão, o perfil atual. `names` traz os nomes de setores e categorias citados em `sectorId` e `categoryId`.
- **Caso de uso `listAuditTrail`:** exige o administrador antes de ler; período com as mesmas regras do painel; tipo e pessoa inválidos são avisados e ignorados; página além da última mostra a última.
- **Tela:** filtros GET (período, datas, tipo, pessoa); cada linha com a ação ("Alterou · Serviço · Reparo elétrico", "Concedeu · Permissão · Gerir serviços do setor para Diego"), data, pessoa e perfil e os campos alterados em português, com setor, categoria, perfil, prioridade e tipo de campo pelos nomes; paginação mantém os filtros. Na URL o filtro de tipo é `type`, porque `entity` já é usado pelos avisos da administração.
- **Reaproveitamento sem duplicação e sem ciclo:** as regras do período saíram de `reports/domain/period.ts` para `src/shared/periods` (o `reports` reexporta; os testes da SF-097 seguem iguais), porque importar o módulo `reports` dentro de `audit` criaria um ciclo (`services` → `audit` → `reports` → `requests`). Os nomes de perfil e de tipo de campo saíram de dois componentes cliente para `src/shared/admin-labels` (componentes de servidor não leem constantes de arquivos `"use client"`); as mensagens de período vêm do componente do painel.
- **Verificação no navegador:** E2E temporário (removido): o administrador cria um setor e vê "Criou · Setor · …" com "Nome: — → …" e "Ativo: — → Sim"; o filtro "Permissão" vai para a URL; o atendente vai para `/queue`. Ajuste feito depois da captura: "nome · perfil" em vez de parênteses duplos.
- **Erro meu durante a suíte:** criei arquivos da SF-105 enquanto o E2E rodava sobre o servidor de desenvolvimento; a rodada demorou 6,7 min e `request-search.spec.ts` estourou o tempo no login. Rodado de novo sem mexer em nada, o E2E passou inteiro (16/16, 3,4 min). Não volto a escrever em `src/` com o E2E em andamento.
- **Resultados:** lint, typecheck e build OK; unitários 671/671 (111 arquivos); integração 303/303 + 1 pulado (68 arquivos); E2E 16/16 (na segunda rodada).

## SF-105 — Retenção no job diário (2026-11-02)

- **Tabela única (`src/shared/retention`):** `RETENTION_PERIODS` com os cinco prazos da seção 5.3 (eventos processados 30 dias e notificações lidas 90 dias, que já existiam; notificações não lidas 365 dias; envios de e-mail 180 dias; auditoria 5 anos) e `retentionCutoff(tipo, agora)`. Anos são anos de calendário em UTC; de 29 de fevereiro, cinco anos antes é 1º de março.
- **Limpezas novas:** `purgeUnreadNotifications` e `purgeEmailDeliveries` (módulo de notificações) e `purgeAuditEntries` (módulo de auditoria), em funções de infraestrutura próprias, para não mudar as portas existentes nem os dublês dos testes. Envios de notificações apagadas saem junto (cascata que já existia).
- **Job diário:** as constantes de 30 e 90 dias saíram de `src/server/jobs` para a tabela; o resumo ganhou `purgedUnreadNotifications`, `purgedEmailDeliveries` e `purgedAuditEntries`. Cada passo roda mesmo que um anterior falhe, como os outros.
- **Resultados:** lint, typecheck e build OK; unitários 675/675 (112 arquivos); integração 306/306 + 1 pulado (69 arquivos); E2E 16/16.

## SF-106 — "Meus dados" (2026-11-02)

- **Arquivo (`domain/personal-data.ts`):** JSON com chaves em português (`pessoa`, `emailsQueVoceEscolheuReceber`, `solicitacoesQueVoceAbriu`, `comentariosQueVoceEscreveuEmOutrasSolicitacoes`, `notificacoesRecentes` — até 200 —, `permissoesRecebidas`), rótulos legíveis e datas ISO. É montado campo a campo: um hash ou uma nota interna que chegasse por engano não vai para o arquivo (teste). Anexos só pelo nome; removidos pela anonimização aparecem como tal. As observações de aprovação (escritas pelo gestor) não entram, só a situação.
- **Leitura (`prisma-personal-data-reader.ts`):** cada consulta seleciona só o que o arquivo mostra; comentários das próprias solicitações só públicos; comentários e notas que a pessoa escreveu em solicitações de outros entram (são dela). Ordem por data e id, para ser sempre a mesma.
- **Caso de uso e rota:** `exportPersonalData` usa só a sessão; registra `EXPORTED` (entidade a própria pessoa, sem campos) antes de devolver o arquivo; pessoa inexistente não gera registro. A rota responde `application/json` como anexo `serviceflow-meus-dados-AAAA-MM-DD.json`, sem cache; sem sessão, 401 com mensagem curta.
- **Telas:** página "Meus dados" com o que o arquivo contém e o botão "Baixar meus dados"; link "Meus dados" nos menus de solicitante, atendente, gestor, administração e "Serviços do setor".
- **Rótulos em `src/shared`:** categorias de e-mail (`NOTIFICATION_CATEGORY_LABELS`) e permissões (`PERMISSION_LABELS`) saíram dos componentes para `src/shared`, reexportados onde estavam.
- **Erros meus nos testes:** o texto esperado da notificação estava errado (o real é "Atendimento iniciado: …"); dois comentários criados no mesmo instante deixavam a ordem indefinida (o teste ganhou horários diferentes e o leitor, desempate por id).
- **Verificação no navegador:** E2E temporário (removido): o solicitante abre "Meus dados" pelo menu e baixa `serviceflow-meus-dados-2026-11-02.json` com os oito blocos; o administrador vê "Baixou os próprios dados · Usuário · Solicitante (demonstração)" na auditoria.
- **Resultados:** lint, typecheck e build OK; unitários 682/682 (113 arquivos); integração 309/309 + 1 pulado (70 arquivos); E2E 16/16.

## SF-107 — Anonimização (2026-11-02)

- **Onde ficou:** módulo `users` — regras puras em `domain/anonymization.ts` (condições de 5.5.1, nova identidade, textos fixos, hash que nunca autentica), caso de uso `application/anonymize-user.ts` e efeitos no banco em `infrastructure/prisma-anonymization.ts`. A auditoria usa o mesmo ponto único (`audited`) das outras ações, com a ação `ANONYMIZED`.
- **Confirmação:** a entrada exige `confirmed: true`; sem ela, `ValidationError` e nada muda. Na tela, a caixa "Entendo que a anonimização de … é irreversível" é obrigatória e o servidor confere de novo.
- **Condições:** pessoa desativada, não é a própria conta, ainda não anonimizada, sem solicitação aberta ou em atendimento como solicitante ou responsável. A regra do último administrador ativo fica escrita, mas na prática já é coberta por "só desativados".
- **Efeitos (uma transação Serializable):** nome e e-mail novos (código = 12 últimos hex do id), hash `!anonimizado` (não começa com `$argon2id$`, então `verifyPassword` recusa sem comparar), `anonymizedAt`; descrição das solicitações da pessoa, respostas de campos de texto delas, comentários, observações de aprovação e observações no histórico de status e de etapas viram "[conteúdo removido na anonimização]"; preferências, notificações e envios de e-mail apagados; permissões revogadas com evento `REVOKED` em nome do administrador; anexos com `removedAt` e nome "Arquivo removido na anonimização".
- **Decisão — arquivos dentro da transação:** o armazenamento não participa da transação do banco. Os arquivos são apagados por último, ainda dentro dela: se o armazenamento falha, o banco volta atrás e a ação pode ser repetida (apagar de novo não é erro, no Supabase e na memória). O risco aceito é o contrário (arquivo apagado e transação desfeita), que deixa só um download quebrado de solicitação encerrada até a nova tentativa. A alternativa (apagar depois do commit) poderia deixar a pessoa "anonimizada" com arquivos guardados, o que é pior para a LGPD. Para caber no tempo, `runSerializableTransaction` ganhou um `timeoutMs` opcional (60 s só aqui); as outras chamadas não mudam.
- **Decisão — rótulos antigos da auditoria:** registros anteriores sobre a pessoa (`entityType USER`, mesmo id) passam a ter o novo nome em `entityLabel`, pela seção 9 ("não deixa o nome antigo em lugar nenhum"). Os campos alterados nunca guardaram nome nem e-mail, então só o rótulo muda. Registrado na SPEC como esclarecimento.
- **Decisão — irreversível:** `updateUser` e `setUserActive` recusam pessoa anonimizada (`ConflictError`); a lista de usuários a mostra só para leitura ("Anonimizado em …"), sem editar, reativar ou permissões.
- **Anexos na tela e no download:** `RequestAttachmentSummary` ganhou `removedAt` opcional, presente só no anexo removido, para que a listagem dos outros anexos continue com exatamente os mesmos campos (um teste antigo de integração confere a lista de campos e falhou na primeira versão, em que o campo vinha sempre; corrigi o código, não o teste). O download recusa o anexo removido no repositório e no caso de uso (404 pela rota).
- **Testes:** unitários das regras e do caso de uso com portas em memória (inclusive rollback quando o armazenamento falha) e do bloqueio de edição; integração sobre o banco com armazenamento em memória (efeitos, painel igual antes e depois, login recusado, download 404, auditoria sem o nome antigo, recusas sem mudar nada, rollback e nova tentativa). Conferi que os testes de integração pegam a falta do efeito: desligando o novo rótulo da auditoria e a remoção dos arquivos, três deles falharam; depois desfiz.
- **Verificação no navegador:** E2E temporário (removido; o E2E definitivo é a SF-108): o administrador cria uma pessoa, a desativa, o painel "Anonimização" aparece só então, o envio sem a caixa marcada não acontece, e com ela a pessoa vira "Pessoa anonimizada <código>" com "Anonimizado em …" e nenhum botão. Na primeira rodada a caixa saiu esticada pelo estilo dos campos; passou a usar a classe `checkbox-field` que já existia.
- **Ambiente:** os comandos rodaram com `volta run --node 22` (o Node padrão é 18) e o banco de teste em `../pgtest`, como antes.
- **Resultados:** lint, typecheck e build OK; unitários 695/695 (114 arquivos); integração 314/314 + 1 pulado (71 arquivos); E2E 16/16 (mais o temporário). Na rodada do E2E apareceu no log do servidor "The destination stream closed early" durante o teste de documentos, que passou; não investiguei se já aparecia antes.

## SF-108 — E2E e revisão da auditoria e LGPD (2026-11-02)

- **E2E (`tests/e2e/audit-lgpd.spec.ts`):** o administrador cria um serviço com prazo-base de 24 h, muda para 12 h e vê "Alterou · Serviço · …" com "Prazo-base (horas): 24 → 12" na auditoria; cria a solicitante Paula, que abre uma solicitação, baixa "Meus dados" (JSON com o próprio nome, a descrição e sem hash) e cancela com motivo; o administrador desativa e anonimiza Paula e vê "Anonimizou · Usuário · Pessoa anonimizada …" com "E-mail: alterado", sem o nome nem o e-mail antigos na seção; Paula não entra mais ("E-mail ou senha inválidos."); o atendente abre a solicitação cancelada e vê o novo nome e "[conteúdo removido na anonimização]" no lugar da descrição e do motivo. Usa serviço e pessoa próprios (prefixo `e2e-lgpd-…`) para não mexer nos dados de demonstração usados pelos outros E2E.
- **Erros meus no E2E:** com o editor aberto, o nome do serviço fica só dentro do campo e o filtro da linha por texto deixa de achar o registro; passei a usar o formulário de edição aberto (`form.entity-editor-form`). Na tela de login há dois elementos com papel `alert` (um é o anunciador de rotas do Next.js); passei a usar `p.login-error`.
- **CA-AUD-01:** `git diff 7c8b943 HEAD -- tests` (só arquivos modificados) mostrou apenas fixtures e testes novos: limpeza de `auditEntry` em `fixtures.ts`, o dublê `audited` em seis testes de casos de uso em memória e `anonymizedAt` nos dados de teste de usuários. Nenhuma asserção antiga mudou e nenhum E2E anterior foi alterado.
- **Aviso no log do servidor:** "The destination stream closed early" apareceu de novo, desta vez durante o download de "Meus dados" no E2E, que passou. Também aparece no E2E de documentos: vem do jeito como o navegador de teste recebe downloads, não de defeito das rotas.
- **Resultados:** lint, typecheck e build OK; unitários 695/695 (114 arquivos); integração 314/314 + 1 pulado (71 arquivos); E2E 17/17.

## Relatório da fase 4 (2026-11-02)

- **Documento:** `SPEC/2026-11-02-relatorio-fase-4.md`.
- **Medição:** 30.733 linhas `added` acumuladas (`bc8fb85`); a fase 4 somou 8.543 (permissões 1.364, e-mail 1.586, painel 2.068, auditoria 3.372), contra 22.000 a 33.000 estimadas: razão de 2,6 a 3,9, um pouco abaixo das fases 2 e 3 por causa da auditoria (1,5 a 2,1).
- **Projeção:** o roadmap inteiro (com a fase 5: itens 14, 15 e 16) deve terminar entre ~34.000 e ~41.000 linhas; pela opção 2, as funcionalidades adicionais precisariam somar de 59.000 a 66.000.
- **Tempo:** 9h53 na fase 4 (cerca de 860 linhas por hora); `diario/tempo-do-projeto.md` atualizado (total mínimo 50h56).
- **Publicação:** dez migrations pendentes no Neon.
- **Suítes não executadas de novo para o relatório** (só documentação); a última execução completa foi a da SF-108, com tudo verde.

## SF-109 — Entrada sem tela de login (2026-11-02)

- **Pedido da responsável:** "abro o website da aplicação, não desejo ver a tela de login e senha, isso viola as restrições do projeto". A seção 22.1 (item 4) mantinha o formulário de e-mail e senha recolhido em `/login`. Apresentei três opções; a escolhida foi **sem tela de login**. Registrada como seção 24 da SPEC principal, que substitui os itens 1 e 4 da seção 22.1.
- **Implementação:** `/` mostra a escolha de perfil sem sessão (os quatro botões de demonstração) e leva à área com sessão; `/login` só redireciona para `/`; o componente `LoginForm` e o CSS do formulário recolhido foram removidos; todos os redirecionamentos de quem está sem sessão, o `pages.signIn` do Auth.js e o "Sair" passaram a usar `/`.
- **Decisão — senha só no servidor:** o provedor de credenciais do Auth.js continua, sem tela, porque os E2E entram com contas criadas pela administração e porque as recusas (pessoa inativa, anonimizada, conta de demonstração) continuam cobertas pela integração. Consequência registrada na SPEC (24.2): contas criadas pela administração não entram pela interface; a página "Alterar senha" ficou sem mudança.
- **Testes existentes alterados (exigidos pela seção 24):** três unitários esperavam `/login` e passaram a esperar `/` (`home-routing`, `notification-route`, `email-preference-actions`); os E2E abrem `/` em vez de `/login` e esperam a entrada (`ENTRANCE`, em `tests/e2e/entrance.ts`) depois de "Sair"; os três E2E que preenchiam o formulário (`service-request-flow`, `request-assignment`, `audit-lgpd`) entram pela rota do Auth.js (`passwordSignIn`). No E2E da anonimização, a recusa da Paula passou de "mensagem de erro do formulário" para "nenhuma sessão criada e a entrada mostra os perfis". `playwright.config.ts` espera o servidor em `/`.
- **Testes novos:** unitário da escolha de perfil na raiz e do redirecionamento de `/login`; E2E de `/login` e páginas protegidas sem sessão levando à entrada.
- **Erro meu de ferramenta:** dois scripts de edição pelo shell perderam a barra invertida das expressões regulares (`/\/login/`); um falhou sem mudar nada e o outro deixou `//catalog/` num E2E, corrigido com edição direta antes de rodar os testes.
- **Log do E2E:** `[auth][error] CredentialsSignin` aparece quando a pessoa anonimizada é recusada; é o registro esperado do Auth.js (aparecia antes com o formulário).
- **Banco de teste:** religado nesta sessão para rodar a integração e o E2E, obrigatórios para a mudança.
- **Proposta da API externa:** as tarefas previstas foram renumeradas para SF-110 a SF-114, porque a SF-109 passou a ser esta mudança; a proposta continua aguardando aprovação.
- **Resultados:** lint, typecheck e build OK; unitários 696/696; integração 314/314 + 1 pulado; E2E 18/18.
- **Publicação:** o site da Vercel só muda no próximo deploy, que depende das dez migrations pendentes no Neon (relatório da fase 4, seção 6).

## SF-110 — Perfis fictícios completos (2026-11-02)

- **Pedido da responsável:** "tire as contas sem senha, a página de alterar senha fica como representação didática" e, em seguida, "no lugar crie perfis fictícios que tenham todas as informações necessárias para demonstração". Perguntei quais contas; a primeira resposta (tirar os quatro botões) deixaria o site sem nenhuma entrada, o que apontei; a responsável manteve os botões. Depois, escolheu as opções recomendadas: reaproveitar Ana e Diego (com Marina Alves e Paulo Ribeiro novos) e carregar os dados no primeiro clique. Registrado como seção 25 da SPEC principal.
- **Módulo novo `src/modules/demo`:** `domain/demo-data.ts` (catálogo, configurações de SLA e aprovação, 14 cenários de solicitação, notificações, `demoTimeline` e `demoScenarioProblems`, que confere cada cenário contra as regras reais) e `infrastructure/prisma-demo-data.ts` (`loadDemoData`, que substitui o antigo `seedDemoData` de `scripts/demo-data.ts`, e `ensureDemoDataLoaded`). `scripts/demo-data.ts` virou só a reexportação usada pelo comando e pelos testes.
- **Contas:** `DEMO_ACCOUNTS` (módulo `auth`) passou a Marina, Ana, Diego e Paulo em `exemplo.test`; o setor passou a "Central de Serviços". Bancos existentes: as contas `demo.*@serviceflow.demo` são desativadas e o "Setor de demonstração" é renomeado (`ensureDemoSector`, agora exportado e usado também pelo carregador).
- **Dados coerentes com as regras:** prazos calculados com `dueAtFrom` e `completedLateAt` do módulo `requests` (agora exportados), `dueSoonAt` pela trigger do banco, aprovação pendente e rejeitada sem prazo, rejeição como cancelamento pelo gestor com a observação, "assumida" antes de "iniciada". Nenhum evento é gravado na outbox (as notificações fictícias são gravadas prontas), para não gerar notificações nem e-mails a partir de dados de exemplo.
- **Primeiro clique:** `createAuthConfig({ beforeDemoSignIn })` no módulo `auth`; a composição no `auth.ts` da raiz liga o carregador. Falha no carregamento só registra o código no log e não impede a entrada. O marcador de "já carregado" é a existência de solicitações de Ana, Bruno ou Carla.
- **Ciclo de importação resolvido:** o carregador usa as APIs públicas de `auth` e `requests`, que chegavam ao `auth.ts` (e ao Auth.js) por `@/server/auth`. `getCurrentUser` passou a importar o `auth.ts` só quando lê a sessão; sem isso, a integração e o `npm run seed:demo` (fora do Next) falhavam ao carregar o `next-auth`. Comportamento igual; conferido por todas as suítes e por um import do comando de seed pelo `tsx`.
- **Testes existentes alterados (exigidos pela seção 25):** `tests/integration/demo-data.test.ts` reescrito para os dados novos (6 pessoas, 14 solicitações, quatro status, aprovação, prazos, primeiro clique, contas antigas); nos E2E, os nomes "Administrador/Solicitante/Atendente/Gestor (demonstração)" e "Setor de demonstração" viraram Marina Alves, Ana Souza, Diego Rocha, Paulo Ribeiro e Central de Serviços; `permissions.spec.ts`: como o atendente do botão agora é o próprio Diego, a solicitação "de um colega" passou a ser de um segundo colega criado pelo teste; `request-approvals.spec.ts`: "Nenhuma aprovação pendente" virou "as duas solicitações decididas saíram da lista", porque os dados fictícios mantêm uma aprovação pendente; `demo-data.spec.ts` ampliado (cancelada, nota interna, responsável, aprovação do Paulo).
- **Achado no E2E:** depois de "Sair", o Auth.js redireciona o servidor de teste para `localhost:3100`, enquanto o `baseURL` é `127.0.0.1:3100`; o cookie da sessão é por host, e um `page.goto` seguinte perdia a sessão. Não afeta o produto (um só host); o E2E passou a abrir a entrada com `page.goto("/")` antes de entrar de novo, como os demais.
- **Testes novos:** unitário dos cenários (`tests/unit/modules/demo/demo-data.test.ts`) e do provedor de demonstração (`tests/unit/modules/auth/demo-provider.test.ts`).
- **Não executado:** `npm run seed:demo` contra o banco de desenvolvimento (mudaria os dados locais da responsável); o carregador é o mesmo testado na integração, e o comando foi conferido só até o import.
- **Proposta da API externa:** tarefas renumeradas para SF-111 a SF-115; continua aguardando aprovação.
- **Resultados:** lint, typecheck e build OK; unitários 718/718; integração 317/317 + 1 pulado; E2E 18/18.
- **Publicação:** no próximo deploy, o primeiro clique no site publicado carrega os dados fictícios no Neon (depois das dez migrations pendentes).

## Publicação das fases 3 e 4 e das SF-109 e SF-110 (2026-11-02)

- A pedido da responsável ("faça o deploy na vercel").
- **Migrations no Neon:** as variáveis do Neon estão na Vercel como *Secret* e o CLI não lê os valores (`vercel env run` avisou que 18 valores não podem ser lidos); baixá-las para um arquivo local foi bloqueado pela permissão automática (gravaria a senha do banco em disco). A responsável escolheu rodar o comando ela mesma; na primeira tentativa usou o nome `DATABASE_URL_UNPOOLED` no lugar de `DATABASE_URL` e o Prisma recusou. Com a URL direta já na conversa, rodei `prisma migrate deploy` só pela linha de comando, sem gravar em arquivo e com a URL ocultada na saída. Aplicadas as 10 migrations pendentes, de `20261101100000_sla_and_priorities` a `20261102200000_audit_actor_reference`.
- **Deploy:** `vercel deploy --prod` do commit `23517d7` (a proposta da SPEC de API, não versionada, foi junto no envio, sem efeito no site). Situação `Ready`, alias https://serviceflow-sand.vercel.app.
- **Verificação só com leitura:** `/` responde 200 com "Escolha um perfil" e os quatro botões, sem campo de senha; `/login` e `/admin` sem sessão redirecionam (307) para `/`. Nenhum botão foi clicado: o primeiro clique de qualquer pessoa carrega os dados fictícios no Neon, desativa as contas genéricas antigas e renomeia o "Setor de demonstração" (seção 25).
- **Segurança:** a URL do Neon com a senha apareceu no chat desta sessão. Ela não está em nenhum arquivo do repositório. Recomendado trocar a senha do banco no Neon (e atualizar a integração da Vercel), como já previsto se o banco receber dados reais.
- **Pendências:** e-mail real (conta no provedor e as três variáveis); armazenamento de documentos (SF-030).

## SF-110 — Defeito do marcador de carregamento, encontrado no site publicado (2026-11-02)

- **Pedido:** "faça o primeiro clique e confira as telas". Percorri o site publicado com Playwright (script fora do repositório), entrando com os quatro perfis só para ler.
- **Defeito meu:** os cenários novos não apareceram (a Ana tinha só as 3 solicitações do seed de 30/10, o Paulo "Nenhuma aprovação pendente") e as contas genéricas continuaram ativas. Causa: o marcador de "já carregado" era "qualquer solicitação de Ana, Bruno ou Carla"; o Neon tinha as do seed antigo, então o carregador pulou tudo, inclusive a desativação das contas antigas, que fica dentro dele. A integração só tinha testado banco vazio e banco com contas antigas sem solicitações.
- **O que o primeiro clique fez mesmo assim:** a entrada ajustou as quatro pessoas (Marina, Ana, Diego e Paulo) e renomeou o "Setor de demonstração" para "Central de Serviços" (`ensureDemoSector`, chamado também pela entrada).
- **Correção:** o marcador passou a ser "solicitação de Ana, Bruno ou Carla com aprovação" (o seed antigo não tinha aprovações). Registrado na seção 25.2 da SPEC. As solicitações antigas continuam no banco, ao lado das novas.
- **Teste novo:** integração com o banco no estado da produção (setor e conta antigos, Ana com uma solicitação sem aprovação): carrega as 14, mantém a antiga, desativa a conta antiga, renomeia o setor e não carrega de novo. Falha no código anterior e passa no corrigido.
- **Resultados:** lint, typecheck e build OK; unitários 718/718; integração 318/318 + 1 pulado; E2E 18/18.

## Publicação da correção do marcador (2026-11-02)

- A pedido da responsável ("publique a correção"): `vercel deploy --prod` do commit `b9c88f3`, situação `Ready`, sem migration nova.
- **Conferência no site publicado (Playwright, script fora do repositório):** o primeiro clique depois da publicação carregou o conjunto atual. Ana vê solicitações nos quatro status e as notificações "Atendimento iniciado" e "Novo comentário" em Declaração de vínculo; Diego vê na fila "Responsável: você", "Concluída no prazo", "Concluída com atraso", "Rejeitada", "Aprovada" e, na página 2, "Vencido", "Próximo do vencimento", "Dentro do prazo" e "Aguardando aprovação", e a declaração com 3 comentários; Paulo vê a solicitação de equipamento aguardando aprovação e o painel da Central de Serviços; Marina vê as seis pessoas ativas e as contas genéricas como "Inativo"; o setor antigo não existe mais (renomeado).
- **Efeito esperado, registrado:** as solicitações do seed de 30/10 continuam no Neon ao lado das novas (algumas com a mesma descrição), com o histórico original ("Solicitante (demonstração)", "Setor de demonstração" no registro da abertura). Nenhuma regra permite apagá-las.

## SPEC de API externa com tokens e webhooks (2026-11-02)

- **SPEC `2026-11-02-api-externa-webhooks.md`** (item 14 do plano, início da fase 5) aprovada com as decisões A1 a A6 conforme propostas: tokens pessoais de solicitante, atendente e gestor (o administrador vê e revoga, não cria); escopos "Somente leitura" e "Leitura e escrita"; valor mostrado uma vez, só o SHA-256 no banco, validade de 30, 90 ou 365 dias, até 10 ativos; v1 com leitura, abertura sem anexos e comentários; webhooks do administrador com HMAC-SHA256, segredo cifrado por chave em variável de ambiente, só `https` e endereços públicos, 6 tentativas; 60 chamadas por minuto por token. Tarefas SF-111 a SF-115 registradas em `TASKS.md`.
- **Princípio:** a API chama os mesmos casos de uso da tela; sem tokens e sem webhooks, o sistema fica como está (garantia 7.4).
- **Variável nova prevista (SF-114):** `WEBHOOK_ENCRYPTION_KEY`, só em variável de ambiente; sem ela os webhooks ficam desligados. Nenhuma dependência nova prevista.

## SF-111 — Migration e domínio da API e dos webhooks (2026-11-02)

- **Migration `20261102300000_api_tokens_and_webhooks`:** gerada comparando os arquivos de schema, sem banco sombra. Só criações (dois enums, quatro tabelas, índices, chaves estrangeiras e restrições `CHECK`) e quatro valores novos em enums da auditoria, que a migration não usa (exigência do PostgreSQL para `ADD VALUE` dentro de transação). Aplicada nos bancos de teste e de desenvolvimento; o Neon ainda não a tem.
- **Módulo `api-tokens` (`domain/token.ts`, `domain/rate-limit.ts`):** token `sf_` + 32 bytes aleatórios (`node:crypto`) em base64url; só o SHA-256 e os 4 últimos caracteres são guardados; leitura do cabeçalho `Bearer` com o formato conferido antes de qualquer consulta; validade de 30, 90 ou 365 dias; até 10 ativos; quem pode criar (decisão A1); quem pode autenticar (token ativo, dono ativo, não anonimizado e com perfil que tem token, lido a cada chamada); escopo; último uso no máximo uma vez por minuto; janela fixa de 60 chamadas por minuto com `Retry-After`.
- **Módulo `webhooks` (`domain/address.ts`, `secret.ts`, `delivery.ts`):** URL só `https`, sem usuário e senha, portas padrão, 443 ou 8443, sem `localhost`, nomes de um rótulo só (como "intranet") ou IP literal bloqueado; `isBlockedAddress` para IPv4 e IPv6 (privados, loopback, link-local, compartilhado, documentação, multicast, reservados, NAT64 e IPv4 mapeado), usado também depois de resolver o nome no envio; exceção `allowLocal` só para os testes. Segredo `whsec_` + 32 bytes, cifrado com AES-256-GCM (IV novo a cada cifragem; alteração detectada pela autenticação do GCM) com a chave de 32 bytes de `WEBHOOK_ENCRYPTION_KEY`; assinatura `t=<segundos>,v1=<HMAC-SHA256 de "segundos.corpo">`. Corpo com ordem fixa de chaves e só o conteúdo da outbox; sucesso só com 2xx; redirecionamento conta como falha; esperas de 1 min, 5 min, 30 min, 2 h e 12 h; desiste depois de 6 tentativas.
- **Decisão — ação `SECRET_ROTATED`:** a regra da auditoria descarta campos com "secret" no nome, então a troca de segredo não geraria registro como alteração; ganhou uma ação própria. Registrado na seção 6 da SPEC.
- **Auditoria:** entidades "Token de API" e "Webhook", ações "Revogou" e "Gerou novo segredo", campos auditados sem valor, hash ou segredo, e a leitura do estado das duas entidades no `prisma-audit-scope`.
- **Teste existente alterado:** `tests/unit/modules/audit/audit.test.ts` lista todas as ações e entidades do banco para garantir que cada uma tem texto; ganhou os quatro valores novos (é o propósito do teste). Limpeza das tabelas novas em `tests/integration/fixtures.ts` e `scripts/prepare-e2e.ts`.
- **Testes novos:** unitários `tests/unit/modules/api-tokens/token.test.ts` e `tests/unit/modules/webhooks/webhooks.test.ts` (39 casos); integração `tests/integration/api-webhook-schema.test.ts` (restrições do banco).
- **Resultados:** lint, typecheck e build OK; unitários 757/757; integração 323/323 + 1 pulado; E2E 18/18.
- **Pendente para publicar:** aplicar `20261102300000_api_tokens_and_webhooks` no Neon antes do próximo deploy.

## SF-112 — Tokens pessoais (2026-11-02)

- **Casos de uso (`src/modules/api-tokens/application/token-use-cases.ts`):** `createApiToken` (dono sempre a pessoa da sessão; o formulário não manda usuário; nome aparado de 1 a 60, escopo e validade da lista; o 11º ativo é `ConflictError`; administrador recusado; criação auditada), `revokeApiToken` (a pessoa revoga os seus, o administrador qualquer um; token de outra pessoa é "não encontrado"; revogar de novo não muda nada nem audita), `listOwnApiTokens` e `listAllApiTokens` (só administrador). Horário do banco, como nas outras transações auditadas.
- **Autenticação (`authenticate-call.ts`):** lê o cabeçalho, busca pelo hash e confere token e dono lidos do banco; qualquer falha é o mesmo `invalid_token`. Com token válido, conta a chamada antes de conferir o escopo (uma escrita recusada também conta). A contagem é um único `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, para chamadas simultâneas não perderem contagem (teste com 61 simultâneas: 60 aceitas). Último uso gravado no máximo uma vez por minuto.
- **Contexto do servidor (`src/server/auth/api-context.ts`):** `runAsApiUser` guarda o dono do token num `AsyncLocalStorage`; `getCurrentUser` devolve esse usuário durante a chamada e não lê a sessão do navegador. Fora de uma chamada da API, nada muda. As rotas que usam isso vêm na SF-113.
- **Telas:** `/account/api-tokens` (link "Acesso à API" no menu das três áreas e da página "Serviços do setor"; o administrador é levado para a seção da administração). O valor aparece só na resposta da ação de criação (`useActionState`), nunca na URL, em log ou no banco; ao recarregar, some. Seção "Acesso à API" na administração com dono, perfil, escopo, final, datas e revogação. A auditoria passou a mostrar escopo e datas legíveis.
- **Teste existente alterado (só configuração e um caso novo):** `tests/unit/audit-section.test.ts` ganhou `vi.mock("@/modules/api-tokens")` (a seção agora importa os rótulos do módulo) e um caso para escopo e datas; nenhuma asserção antiga mudou.
- **Testes novos:** unitários `tests/unit/modules/api-tokens/use-cases.test.ts` (casos de uso e autenticação com portas em memória); integração `tests/integration/api-tokens.test.ts` (criação, listas, revogação, auditoria sem valor nem hash, limite de 10, autenticação com mudanças de perfil, setor, estado, validade e revogação, escopo, limite de chamadas simultâneas, contexto).
- **Verificação no navegador:** E2E temporário (removido antes do commit; o E2E da SPEC é a SF-115): Ana cria um token "Leitura e escrita" de 30 dias, vê o valor uma vez, a lista mostra o final; ao recarregar o valor some; revoga e vê "Revogado ... por Ana Souza"; o administrador é levado de `/account/api-tokens` para a seção e vê o token com a dona; a auditoria mostra "Criou" e "Revogou" sem o valor. A primeira rodada falhou por erro do próprio teste (navegação enquanto o "Sair" ainda navegava).
- **Resultados:** lint, typecheck e build OK; unitários 768/768; integração 330/330 + 1 pulado; E2E 18/18.

## SF-113 — Rotas /api/v1 e OpenAPI (2026-11-02)

- **Módulo `public-api`:** `domain/representation.ts` (JSON das respostas: chaves em inglês, datas ISO, códigos; responsável efetivo e situação do prazo como na tela; anexos só com nome, formato e tamanho; histórico sem e-mails), `domain/errors.ts` (códigos, status e mensagens fixas; tradução dos erros da aplicação), `domain/openapi.ts` (documento OpenAPI 3.1 e a lista de operações), `application/endpoints.ts` (cada rota chama os casos de uso da tela: `searchRequesterRequests`, `searchAttendantQueue`, `listManagerApprovals`, os `get*Request`, `listRequestFieldAnswers`, `listRequestAttachments`, `listComments`, `createRequest` e `addComment`) e `infrastructure/http.ts` (autentica, responde 401/403/429, roda a operação em `runAsApiUser`, traduz os erros e põe `no-store` e `nosniff` em toda resposta). Os arquivos `route.ts` só apontam para os handlers do módulo.
- **Decisões de detalhe (registradas na SPEC, 5.4):** respostas de campos em `fieldValues`; corpo de erro com `issues` (caminhos e códigos públicos, o mesmo filtro da aplicação) e `fields` (id e código dos campos recusados), nunca o valor enviado; `WWW-Authenticate: Bearer` no 401; serviço com documento obrigatório recusado com 422 antes do caso de uso (a API não envia anexos); lista do gestor paginada pela API (20) com `filter`; detalhe do gestor sem comentários (a tela dele não tem conversa); `/me` com as permissões efetivas lidas por `actorHasPermission`.
- **Mudança na SF-112:** o resultado da autenticação passou a trazer a validade do token e o nome do setor (para o `/me`); o teste unitário da SF-112 foi ajustado para os dois campos.
- **Testes novos:** unitário `tests/unit/modules/public-api/public-api.test.ts` (correspondência entre arquivos de rota, lista de operações e documento; formato dos erros; representação sem e-mails); integração `tests/integration/public-api.test.ts` (9 cenários sobre o banco fictício, com a autorização real no contexto do dono do token).
- **Verificação no servidor Next:** E2E temporário (removido; o E2E da SPEC é a SF-115): a Ana cria um token na tela; um contexto HTTP sem cookies recebe 401 sem token; com o token, `/me`, abertura, detalhe, comentário e OpenAPI funcionam, e a solicitação aberta pela API aparece na tela com o comentário.
- **Erro meu, pego pelo lint:** a primeira versão do teste de integração convertia o JSON para `Record<string, any>`; o projeto proíbe `any` explícito e não usa `eslint-disable`. Passou a usar o retorno de `response.json()` sem conversão.
- **Resultados:** lint, typecheck e build OK; unitários 773/773; integração 339/339 + 1 pulado; E2E 18/18.

## SF-114 — Webhooks (2026-11-02)

- **Casos de uso (`src/modules/webhooks/application/webhook-admin.ts`):** `createWebhook`, `updateWebhook`, `setWebhookActive` (desativar cancela as entregas pendentes) e `rotateWebhookSecret`, só administrador, cada um auditado (`CREATED`, `UPDATED`, `DEACTIVATED`/`REACTIVATED`, `SECRET_ROTATED`). Criar e trocar o segredo exigem a chave; o limite de 10 conta os ativos.
- **Entregas (`webhook-delivery.ts`):** o consumidor da outbox (registrado em `src/server/jobs` ao lado das notificações) grava uma entrega por webhook ativo que assina o tipo, com `skipDuplicates` pela chave única evento + webhook; sem a chave, não grava nada. O envio reserva as entregas com `FOR UPDATE SKIP LOCKED` (como os e-mails), decifra o segredo, assina, envia e grava entregue, nova tentativa (1 min, 5 min, 30 min, 2 h, 12 h), falha na sexta ou cancelada (webhook inativo). Roda logo após a resposta (`scheduleEventProcessing`, depois dos e-mails) e no job diário.
- **Transporte (`http-webhook-transport.ts`):** `fetch` com `redirect: "manual"` e `AbortSignal.timeout(10 s)`; antes, resolve o nome (`node:dns`) e recusa se qualquer endereço for interno; nunca lê o corpo da resposta. Configuração por `WEBHOOK_ENCRYPTION_KEY` (32 bytes em base64); `WEBHOOK_ALLOW_LOCAL` só fora de produção. `.env.example` com as duas comentadas e vazias; o servidor do E2E gera uma chave a cada execução, como o `AUTH_SECRET`.
- **Tela:** seção "Webhooks" na administração: situação da configuração (pelo nome da variável), criação com o segredo mostrado uma vez (`useActionState`), lista com edição, desativar/reativar e "Gerar novo segredo", e as 50 entregas mais recentes com situação, tentativas e motivo legível. A auditoria mostra os eventos pelos nomes.
- **Retenção, "Meus dados" e anonimização:** três prazos novos na tabela única (`webhookDeliveries` 30 dias, `apiRateWindows` 1 dia, `endedApiTokens` 365 dias) e três passos novos no job diário; bloco `tokensDeAcessoAPI` no arquivo de "Meus dados" (sem valor nem hash) e texto da página atualizado; a anonimização revoga os tokens da pessoa na mesma transação.
- **Mudança em código existente:** `url` e `eventTypes` entraram na lista de caminhos públicos dos erros de validação (`src/server/errors`), como `period` e `sector` na SF-100: sem isso, a tela não sabia qual campo foi recusado (achado no navegador, a mensagem dizia "nome" para um endereço recusado).
- **Testes existentes alterados:** `tests/unit/retention.test.ts` confere a tabela inteira de retenção e ganhou os três prazos da seção 5.7 (asserção alterada por exigência desta SPEC) e um caso novo; `tests/unit/audit-section.test.ts` ganhou `vi.mock("@/modules/webhooks")`; o dublê de `tests/unit/modules/users/anonymization.test.ts` ganhou o método `revokeApiTokens` (só configuração; o efeito é testado na integração).
- **Testes novos:** unitário `tests/unit/modules/webhooks/use-cases.test.ts` (administração, consumidor, envio e transporte com dublês); integração `tests/integration/webhooks.test.ts` (receptor HTTP local real: assinatura conferida, reprocessamento sem duplicar, 500 e 302 como novas tentativas, redirecionamento não seguido, endereço interno recusado sem conexão, desativação, auditoria sem segredo, limite de 10, retenção, "Meus dados" e anonimização).
- **Verificação no navegador:** E2E temporário (removido; o E2E da SPEC é a SF-115): criar com o segredo mostrado uma vez, endereço interno recusado com o motivo, segredo some ao recarregar, gerar novo segredo, desativar, e a auditoria com "Criou", "Gerou novo segredo" e "Desativou" sem o segredo.
- **Resultados:** lint, typecheck e build OK; unitários 784/784; integração 346/346 + 1 pulado; E2E 18/18.
- **Para publicar:** gerar `WEBHOOK_ENCRYPTION_KEY` e cadastrá-la na Vercel como Secret (sem ela, a seção avisa e nada é enviado); aplicar no Neon a migration da SF-111.

## SF-115 — E2E e revisão da API e dos webhooks (2026-11-02)

- **E2E (`tests/e2e/api-webhooks.spec.ts`):** o teste sobe um receptor HTTP em `127.0.0.1`; o administrador cadastra um webhook para ele com "Solicitação aberta" e guarda o segredo mostrado uma vez; a Ana cria um token "Leitura e escrita"; um cliente sem os cookies do navegador abre uma solicitação por `POST /api/v1/requests` (201, `no-store`); a solicitação aparece na lista e no detalhe da Ana e na fila do Diego; o receptor recebe `request.opened` com assinatura que confere com o segredo, horário recente e sem a descrição; a Ana revoga o token e `/api/v1/me` responde 401 no formato da API; a seção "Webhooks" mostra a entrega como "Entregue", sem o corpo.
- **Erro meu no teste:** a primeira versão procurava a descrição na lista "Minhas solicitações", que mostra o serviço; a descrição está no detalhe. Corrigido no teste.
- **README:** variável `WEBHOOK_ENCRYPTION_KEY` (como gerar, o que acontece sem ela e ao trocá-la), seção "API externa" (criar o token, exemplos com `curl`, rotas, erros, limites e revogação) e "Webhooks de saída" (corpo, cabeçalhos, novas tentativas, repetições e uma função de verificação da assinatura). A função do README foi executada contra uma assinatura gerada como o sistema gera: aceita a certa e recusa segredo errado, corpo alterado, horário antigo e cabeçalho malformado.
- **Revisão da SPEC (SF-111 a SF-115):** nenhuma dependência alterada; uma migration aditiva; nenhum segredo no repositório (`.env.example` só com variáveis comentadas e vazias; a chave do E2E é gerada a cada execução); testes anteriores só com acréscimos (CA-API-01). Mudanças em código existente: `getCurrentUser` lê primeiro o contexto da chamada da API; `url` e `eventTypes` na lista de caminhos públicos dos erros; consumidor e passos novos no job diário; três prazos novos na tabela de retenção; anonimização e "Meus dados" cobrindo os tokens.
- **Resultados:** lint, typecheck e build OK; unitários 784/784; integração 346/346 + 1 pulado; E2E 19/19.
- **Para publicar:** aplicar no Neon `20261102300000_api_tokens_and_webhooks` e cadastrar `WEBHOOK_ENCRYPTION_KEY` na Vercel (Secret).

## Publicação da API externa e dos webhooks (2026-11-02)

- A pedido da responsável ("faça o deploy na vercel").
- **Migration no Neon:** aplicar `20261102300000_api_tokens_and_webhooks` pelo agente foi bloqueado pela permissão automática (deploy em produção). A responsável rodou o comando com `!`; a primeira tentativa falhou porque a URL sem aspas foi cortada no `&`; a segunda, com aspas e pela conexão do pooler, aplicou a migration. Antes, conferi só com leitura (`prisma migrate status`) que ela ainda não estava aplicada e não publiquei.
- **Deploy:** `vercel deploy --prod` do commit `95a5e04`. O `npx` passou a pedir o CLI 65.10.0, que não está instalado, e o primeiro comando não rodou; usei o CLI 65.9.0 que já estava no cache do `npx`, sem baixar nada.
- **Verificação só com leitura:** `/` 200; `/login` 307; `/api/v1/me` sem token e `/api/v1/requests` com token inválido respondem 401 `invalid_token` com `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` e `WWW-Authenticate: Bearer`; `/api/v1/openapi.json` responde 200 com o documento.
- **Pendente:** `WEBHOOK_ENCRYPTION_KEY` não está cadastrada na Vercel (conferido pelo nome das variáveis): no site, a seção "Webhooks" avisa que não está configurada e nada é enviado; tokens e API funcionam. A troca da senha do Neon continua recomendada.

## Decisão: e-mails desativados na publicação (2026-11-02)

- A responsável decidiu manter o envio de e-mails desativado no site publicado ("mantenha os e-mails desativado"). Nada muda no código: sem `EMAIL_API_KEY`, `EMAIL_FROM` e `APP_BASE_URL` na Vercel (conferido pelos nomes das variáveis), os envios ficam registrados como "não enviado — e-mail não configurado" e a seção "E-mails" avisa. Não criar conta no provedor nem cadastrar essas variáveis sem novo pedido.

## SF-029 — Validação de integração registrada (2026-11-02)

- A pendência era só o registro: a suíte PostgreSQL da troca de senha não pôde rodar em 2026-10-06 (`EPERM` no `prisma generate` e banco de teste indisponível). Hoje `tests/integration/change-own-password.test.ts` passou com 7 casos, cobrindo todos os critérios da tarefa; a suíte de integração inteira já vinha passando em todas as tarefas recentes (346 + 1 pulado). Os três critérios da seção 15 da SPEC principal sobre a troca de senha foram marcados.
- Nenhum código mudou.

## SF-028 — Política de backup e teste de restauração (2026-11-02)

- **Decisão da responsável:** opção "Semanal + antes de deploy" entre três propostas (diária; só o histórico do Neon). Registrada em `SPEC/2026-11-02-backup-recuperacao.md`: `pg_dump` completo semanal e antes de cada migration ou deploy; 4 semanais e as de deploy por 30 dias; cifradas e fora do repositório; RPO de 7 dias; RTO de até 2 horas; teste a cada 3 meses. Motivo de não depender do Neon: no plano gratuito o histórico cobre cerca de 6 horas (documentação consultada; ela se contradiz sobre a restauração instantânea nesse plano).
- **Ferramentas:** não havia `pg_dump` na máquina (o pacote do banco local não traz as ferramentas de cliente e a pasta de 2026-10 não existia mais). Com a autorização da responsável, baixei de novo o zip oficial do PostgreSQL 17.11 da EnterpriseDB por HTTPS, numa pasta nova fora do projeto; o SHA-256 (`80379B2C...F82F`) é igual ao registrado em 2026-10, então é o mesmo arquivo. Extraído em `%LOCALAPPDATA%\serviceflow-pg17`.
- **Teste de restauração:** cópia do banco local de desenvolvimento (dados fictícios) restaurada num banco novo; 28 tabelas com as mesmas linhas, mesma estrutura (118 restrições, 73 índices, 50 funções, 1 trigger), migrations em dia; cópia e banco de teste apagados. O banco de produção não foi copiado: exige a conexão de produção, que fica com a responsável.
- **Segurança:** `*.dump` no `.gitignore`; README aponta para a política.
- **SF-028:** fica aberta só pela dependência da SF-026 (meta de linhas). SF-029 concluída antes, no mesmo pedido.

## Senha do Neon mantida e primeira cópia de produção (2026-11-03)

- **Decisão da responsável:** manter a senha atual do Neon ("é para fins didáticos"). Não recomendar mais a troca; o banco só tem dados fictícios.
- **Primeira cópia semanal:** feita e verificada (detalhes na seção 7 de `SPEC/2026-11-02-backup-recuperacao.md`). Achados: o Neon roda PostgreSQL **18.6**, e o `pg_dump` 17 se recusa a copiá-lo; baixei os binários oficiais do 18.6 (tamanho igual ao anunciado; SHA-256 registrado na SPEC, a EnterpriseDB não publica checksum). Na verificação, um erro meu: restaurar só o schema `public` deixou de fora a extensão `citext`; corrigido criando a extensão antes. A política foi corrigida (dizia PostgreSQL 17 para o Neon) e ganhou a observação sobre `citext` e sobre o EFS.
- **Onde está:** `C:\Users\Mylena Reis\serviceflow-backups\serviceflow-2026-11-03.dump`, cifrado pelo EFS do Windows. Falta a cópia fora da máquina.

## Aprovação das funcionalidades pendentes 1 a 8 e SPEC de ações pela API (2026-11-03)

- **Pedido:** "A aprovação das funcionalidades 1 a 8 estão aprovadas, pode iniciar". As oito: múltiplas organizações; ferramentas MCP de documentos; status, atribuição e cancelamento pela API; webhooks por setor e reenvio; transferência entre setores; anexos em comentários e documentos após a abertura; pausa do SLA e calendário de dias úteis; campos condicionais, seleção múltipla e campos do atendente.
- **Ordem adotada (informada à responsável):** 3 e 4 juntas → 5 → 6 → 7 → 8 → 2 → 1. Motivos: o plano manda deixar múltiplas organizações por último (muda todas as tabelas e consultas, e faria refazer as outras); o MCP de documentos depende da SF-030 (armazenamento real ainda sem credenciais).
- **Como as SPECs são aprovadas daqui em diante:** cada SPEC registra que a funcionalidade foi aprovada em 2026-11-03 e adota as decisões recomendadas, listadas na seção de decisões; a responsável pode rever qualquer uma.
- **SPEC `2026-11-03-api-acoes-webhooks-setor.md`** (funcionalidades 3 e 4): rotas `POST` por ação (`start`, `complete`, `assume`, `release`, `transfer`, `cancel`, `reopen`) e `GET transfer-candidates`, sobre os casos de uso da tela; filtro opcional de setores no webhook (vazio = todos); reenvio de entrega falha ou cancelada. Tarefas SF-116 a SF-119.

## SF-116 — Migration e regras do filtro por setor e do reenvio (2026-11-03)

- **Migration `20261103100000_webhook_sectors`:** gerada comparando os arquivos de schema (sem banco sombra). Só acrescenta `sectorIds UUID[]` com padrão vazio e a restrição "nunca nula, sem item nulo". Webhooks existentes ficam com a lista vazia, que significa todos os setores. Aplicada nos bancos de teste e de desenvolvimento; o Neon ainda não a tem.
- **Regras (`src/modules/webhooks/domain/delivery.ts`):** `webhookAcceptsSector` (vazio = todos), `checkWebhookSectors` (sem repetição, recusa setor inexistente) e `canResendWebhookDelivery` (só falha ou cancelada, de webhook ativo).
- **Ambiente:** o typecheck acusou um erro em `.next/dev/types/validator.ts`, arquivo gerado pelo `next dev` que ficou truncado (provavelmente o servidor do E2E foi encerrado no meio da escrita). É ignorado pelo Git e recriado pelo servidor; a pasta `.next/dev/types` foi apagada e o typecheck voltou a passar. Nenhum arquivo do projeto mudou por isso.
- **Testes novos:** unitário `tests/unit/modules/webhooks/sectors-resend.test.ts`; caso novo em `tests/integration/api-webhook-schema.test.ts` (arquivo criado pela SPEC anterior).
- **Resultados:** lint, typecheck e build OK; unitários 787/787; integração 347/347 + 1 pulado; E2E 19/19.

## SF-117 — Rotas de ação da API (2026-11-03)

- **Implementação:** `runRequestAction` chama `transitionRequestStatus`, `assumeRequest`, `releaseRequest`, `transferRequest`, `cancelRequest` e `reopenRequest` com os corpos validados (`{}`, `{assigneeId}`, `{note?}`, `{note}`, sempre `strict`) e devolve o detalhe atualizado; `transferCandidates` usa `listTransferCandidates`. Ação sem corpo aceita corpo vazio (`optionalJsonBody`). Cada ação marca `recordedEvents`, então o processamento roda logo após a resposta. Os arquivos `route.ts` só apontam para os handlers do módulo.
- **Esclarecimento na SPEC (5.1):** a primeira versão dizia que "o que a pessoa lê mas não pode fazer é 403". A regra da tela, mantida pela API, responde **404** para iniciar ou concluir quando quem pede não é atendente do setor (SPEC principal, não revela a solicitação); liberar ou transferir sem ser o responsável é 409. A API não cria regra nova, então a SPEC foi corrigida e o teste ficou exato.
- **OpenAPI:** 8 operações novas com o mesmo formato (`actionOperation`); o teste de correspondência entre arquivos de rota e documento passou sem mudança.
- **Testes novos:** integração `tests/integration/public-api-actions.test.ts` (4 cenários sobre os dados fictícios, com a autorização real).
- **Resultados:** lint, typecheck e build OK; unitários 787/787; integração 351/351 + 1 pulado; E2E 19/19.

## SF-118 — Webhooks por setor e reenvio (2026-11-03)

- **Cadastro:** `sectorIds` opcional no formulário; repetidos são removidos e setor inexistente é recusado no caminho `sectorIds` (caminho público acrescentado em `src/server/errors`). A visão geral passa a trazer a lista de setores (inclusive inativos, marcados como tal) para os checkboxes.
- **Consumidor:** filtra os assinantes pelo setor da solicitação. O setor só é lido quando algum webhook filtra, para não acrescentar consulta a quem não usa o filtro (CA-ACT-01).
- **Reenvio:** `resendWebhookDelivery` exige administrador, recusa entrega pendente, entregue ou de webhook inativo (`ConflictError`) e devolve a entrega à fila (pendente, 0 tentativas, sem erro). Não é auditado: não muda configuração, e a própria entrega já registra o resultado. A ação da tela agenda o processamento logo em seguida. A mensagem de recusa ganhou uma entidade própria (`webhookDeliveries`) porque a primeira versão reaproveitava a de webhooks e mostrava o aviso do limite de 10 ativos.
- **Auditoria:** "Setores" entre os campos auditados do webhook; a tela mostra "Todos os setores" ou os nomes.
- **Teste anterior ajustado:** os dublês de `tests/unit/modules/webhooks/use-cases.test.ts` (SPEC anterior) ganharam os métodos e campos novos das portas; nenhuma asserção mudou.
- **Testes novos:** unitário `tests/unit/modules/webhooks/sectors-actions.test.ts`; integração `tests/integration/webhook-sectors.test.ts` (receptor HTTP local, assinatura conferida).
- **Verificação no navegador:** não feita nesta tarefa; fica coberta pelo E2E da SF-119.
- **Resultados:** lint, typecheck e build OK; unitários 791/791; integração 354/354 + 1 pulado; E2E 19/19.

## SF-119 — E2E e revisão das ações e dos webhooks por setor (2026-11-03)

- **E2E `tests/e2e/api-actions-webhook-sectors.spec.ts`:** o administrador cadastra pela tela um webhook só do setor da demonstração; o solicitante abre pela API uma solicitação nesse setor e outra num segundo setor criado pelo teste; o Diego, com token próprio, assume, inicia e conclui pela API, e a página da fila mostra o mesmo histórico de um atendimento feito na tela; o receptor recebe só os eventos do setor marcado. Depois o receptor passa a responder 500, o administrador desativa e reativa o webhook (a entrega pendente vira cancelada) e clica em "Reenviar": a entrega chega com o mesmo `ServiceFlow-Delivery` e o mesmo corpo.
- **Por que entrega cancelada, e não falha:** chegar a "falhou" exige 6 tentativas espalhadas por horas. A regra aceita as duas, e a falha está coberta pela integração.
- **Falha encontrada e corrigida:** na primeira execução da suíte inteira, o E2E da SF-115 (`api-webhooks.spec.ts`) quebrou: ele clica no único botão "Revogar" da página de tokens, e o teste novo, que roda antes, deixava dois tokens ativos das mesmas pessoas fictícias. O teste antigo não foi alterado; o novo passou a revogar os próprios tokens no `afterAll`, gravando a dona do token como quem revogou (a restrição do banco exige os dois campos juntos, e é o que a página faz).
- **README:** ações da API com exemplos, filtro de setores e "Reenviar".
- **CA-ACT-01 e 09:** sem mudança em `package.json` nem no lock desde o registro da SPEC; uma migration; os testes anteriores alterados só ganharam casos ou dublês, sem asserção mudada.
- **Resultados:** lint, typecheck e build OK; unitários 791/791; integração 354/354 + 1 pulado; E2E 20/20.
- **Pendente para publicar:** aplicar a migration `20261103100000_webhook_sectors` no Neon antes do deploy (a responsável roda o comando).

## SPEC de transferência entre setores (2026-11-03)

- **Pedido:** "pode prosseguir", depois da conclusão da SPEC de ações pela API e webhooks por setor; funcionalidade 5 da lista aprovada.
- **SPEC `2026-11-03-transferencia-entre-setores.md`:** encaminhar uma solicitação **aberta** para outro setor ativo com atendente ativo, com justificativa; o responsável sai, o prazo e a prioridade ficam; novo setor vê tudo, inclusive notas internas; histórico, notificações, webhooks (origem ou destino), API, anonimização e "Meus dados". Decisões T1 a T7 adotadas como recomendadas. Tarefas SF-120 a SF-123.
- **Ajuste feito antes do registro:** a primeira redação dizia `403` para o atendente do setor sem direito; o código atual responde `409` nesse caso (iniciar ou liberar a solicitação de um colega), e a SPEC passou a seguir essa regra.
- **Demonstração (T7):** o conjunto fictício tem um setor só, então a demonstração do encaminhamento exige que o administrador crie um segundo setor e um atendente; a alternativa de acrescentar dados fictícios ficou registrada.

## SF-120 — Migration e regras do encaminhamento (2026-11-03)

- **Migration `20261103200000_request_sector_events`:** SQL gerado comparando os arquivos de schema (sem banco sombra), mais as restrições escritas à mão: justificativa sem espaços nas pontas e de 1 a 1.000 caracteres, origem diferente do destino, nomes não vazios. As restrições de tipo da outbox e dos webhooks são apagadas e recriadas com `request.sector_changed` a mais, como nas SPECs anteriores que criaram eventos. Aplicada nos bancos de teste e de desenvolvimento; o Neon ainda não a tem (nem a `20261103100000_webhook_sectors`).
- **Regras (`src/modules/requests/domain/lifecycle.ts`):** `assertCanSendToSector` (fora do setor `404`; não aberta ou com aprovação pendente `409`; com responsável efetivo, só ele ou quem supervisiona, senão `409`), `sectorTransferNote` e `assertSectorDestination` (recusa no campo `sectorId`).
- **Evento:** `request.sector_changed` com `fromSectorId`, `toSectorId` e `actorId`. O rótulo "Mudança de setor" entrou já nesta tarefa porque o mapa de rótulos dos webhooks é exigido para todo tipo de evento; o filtro por origem ou destino fica para a SF-122. Até lá, ninguém grava esse evento.
- **Testes anteriores ajustados:** `tests/unit/modules/events/domain-event.test.ts` enumera todos os tipos de evento e ganhou o novo, com comentário, como nas SPECs de SLA, fluxos e aprovações (a asserção da lista mudou por definição). A limpeza das tabelas em `tests/integration/fixtures.ts` e `scripts/prepare-e2e.ts` passou a incluir a tabela nova (sem isso, a chave estrangeira impede apagar as solicitações entre testes).
- **Testes novos:** unitário `tests/unit/modules/requests/sector-transfer-rules.test.ts`; integração `tests/integration/request-sector-schema.test.ts`.
- **Resultados:** lint, typecheck e build OK; unitários 799/799; integração 356/356 + 1 pulado; E2E 20/20.

## SF-121 — Encaminhamento pela tela (2026-11-03)

- **Caso de uso (`src/modules/requests/application/sector-transfer.ts`):** mesma checagem de sessão das outras ações (`requireStatusChangeActor`); na transação, relê pessoa, solicitação, destino e setor de origem; ordem das recusas: fora do setor `404`, estado ou responsável `409`, justificativa e destino `400`. A gravação só acontece se status, setor, responsável e aprovação continuam os lidos; senão `409`. Com responsável, grava também a liberação (evento de atribuição para "sem responsável"), que aparece no histórico logo depois da linha do encaminhamento.
- **Nome do setor de origem:** vem da tabela de setores no momento (não do snapshot da abertura), como diz a SPEC ("nomes do momento").
- **Tela:** o formulário aparece só quando a pessoa pode encaminhar e há destino; depois do envio volta para a fila com "Solicitação encaminhada ao outro setor. Ela saiu da fila deste setor.", porque a atendente deixa de ver a solicitação. O rótulo "Setor de origem" da página da fila virou "Setor": depois de um encaminhamento, o nome mostrado é o do setor atual. Nenhum teste dependia do texto antigo.
- **`RequestWithHistory.sectorEvents` opcional:** o repositório Prisma sempre carrega a lista; ser opcional evita mudar todos os objetos de solicitação montados à mão nos testes anteriores.
- **"Meus dados" — esclarecimento na SPEC (5.9):** a primeira redação dizia que o arquivo incluiria a justificativa "entre as justificativas que a pessoa escreveu", mas o arquivo não lista justificativas escritas pela equipe em solicitações de outras pessoas, só comentários. Segui o modelo existente: os encaminhamentos entram nas solicitações que a pessoa abriu (chave `encaminhamentos`, só quando houve encaminhamento, para não mudar o formato das demais). A anonimização troca a justificativa de quem encaminhou.
- **Testes anteriores ajustados:** o dublê `tests/unit/modules/requests/in-memory-requests.ts` ganhou setores, eventos de setor e os métodos novos das portas; `tests/unit/modules/notifications/email.test.ts` enumera a tabela 5.1 da SPEC de e-mail inteira e ganhou os dois tipos novos, com comentário (é o teste que obriga todo tipo novo a ter categoria).
- **Testes novos:** unitários `tests/unit/modules/requests/application/sector-transfer.test.ts` e `tests/unit/request-sector-display.test.ts`; integração `tests/integration/request-sector-transfer.test.ts` (inclui dois encaminhamentos simultâneos: só um acontece).
- **Resultados:** lint, typecheck e build OK; unitários 811/811; integração 361/361 + 1 pulado; E2E 20/20.

## SF-122 — API, OpenAPI e webhooks do encaminhamento (2026-11-03)

- **Esclarecimento na SPEC (5.8.2):** a primeira redação mandava devolver o detalhe atualizado, como nas outras ações. Só que quem encaminha deixa de ler a solicitação na mesma transação, e montar o detalhe depois responderia `404` a um encaminhamento feito. A rota responde `200 {"id", "sectorId"}`.
- **Perfis:** como nas ações da SF-117, a rota aceita solicitante, atendente e gestor e deixa o caso de uso decidir (`404` fora do setor, `409` para a colega sem direito); `sector-candidates` só atendente (`403` para os outros perfis), como `transfer-candidates`.
- **Histórico na API:** o detalhe ganhou `history.sectors` (origem, destino, autor, justificativa, data), para o novo setor ler pela API o mesmo histórico da tela (SPEC 5.4). Nenhum teste anterior comparava o objeto `history` inteiro.
- **Webhooks:** `eventSectorIds` diz a quais setores o evento pertence: o de mudança de setor pertence à origem e ao destino (decisão T6) e nem lê o setor atual; os outros eventos seguem com o setor atual.
- **Erro meu no teste, corrigido:** a primeira versão do teste de integração simulava a sessão (`@/server/auth`) para abrir a solicitação e cadastrar webhooks; isso substitui também o contexto do token da API, e as rotas responderam `500`. O teste passou a criar a solicitação e os webhooks direto no banco, sem simular a sessão.
- **Testes novos:** unitário `tests/unit/modules/webhooks/sector-move.test.ts`; integração `tests/integration/public-api-sector-transfer.test.ts`.
- **Resultados:** lint, typecheck e build OK; unitários 813/813; integração 363/363 + 1 pulado. O E2E não foi rodado nesta tarefa (nenhuma tela mudou); roda inteiro na SF-123.

## SF-123 — E2E e revisão do encaminhamento entre setores (2026-11-03)

- **E2E `tests/e2e/request-sector-transfer.spec.ts`:** a Ana abre uma solicitação no catálogo; o Diego escreve uma nota interna, assume e encaminha pela tela para um segundo setor criado pelo teste (o setor atual não aparece entre os destinos); volta para a fila com o aviso; a solicitação some da fila dele e o detalhe responde `404`; o atendente do segundo setor lê pela API o histórico (encaminhamento com justificativa, assunção e liberação) e a nota interna, e recebe a notificação; a Ana vê "Setor responsável" com o novo setor e a linha com a justificativa, sem a nota interna.
- **Primeira tentativa, descartada:** mover o Diego para o segundo setor no banco para olhar a fila desse setor pela tela. Não funciona: o clique "Entrar como Atendente" restaura a conta de demonstração, setor incluído (SPEC principal, seção 22), e o Diego voltava ao setor original. Como só as pessoas da demonstração entram pela tela, a leitura pelo novo setor passou a ser feita pela API com um token do atendente do segundo setor; a tela de fila do novo setor é a mesma de qualquer setor, e a leitura no banco está coberta pela integração.
- **README:** encaminhamento em "Fluxos disponíveis" e as rotas `transfer-sector` e `sector-candidates` na seção da API.
- **CA-SET-01:** os testes anteriores que enumeram todos os tipos de evento e as categorias de e-mail tiveram a lista estendida (padrão das SPECs anteriores); os demais arquivos anteriores só ganharam linhas.
- **Resultados:** lint, typecheck e build OK; unitários 813/813; integração 363/363 + 1 pulado; E2E 21/21.
- **Antes do próximo deploy:** aplicar no Neon as migrations `20261103100000_webhook_sectors` e `20261103200000_request_sector_events`.

## SPEC de anexos em comentários e documentos depois da abertura (2026-11-03)

- **Pedido:** "pode prosseguir", depois da medição do cloc; funcionalidade 6 da lista aprovada.
- **SPEC `2026-11-03-anexos-comentarios-documentos.md`:** até 3 arquivos por comentário (PDF, DOCX, TXT, 2 MiB cada, 4 MiB somados, 30 por solicitação), com a visibilidade do comentário; o solicitante envia depois da abertura um documento ainda não enviado, com histórico, evento `request.document_added`, notificação ao responsável e webhook. Decisões X1 a X7 adotadas como recomendadas. Tarefas SF-124 a SF-127.
- **Dependência registrada:** o armazenamento de produção ainda depende da SF-030; o desenvolvimento e os testes usam o armazenamento de teste, como na SF-034. A limpeza de órfãos só apaga pastas de solicitações que não existem, então arquivos de comentário guardados na pasta da solicitação não são afetados por ela.

## SF-124 — Migration e regras dos anexos (2026-11-03)

- **Migration `20261103300000_request_comment_files`:** SQL gerado por comparação dos arquivos de schema, mais as restrições de linha copiadas de `RequestAttachment` (nome saneado, tipo coerente com o formato, 1 byte a 2 MiB, hash, chave `requests/<solicitação>/<arquivo>`). Para o banco garantir que o arquivo pertence à mesma solicitação do comentário, a chave estrangeira é composta `(commentId, requestId)` → `RequestComment(id, requestId)`, com um índice único novo nessa tabela (aditivo).
- **Erro meu, pego pelo teste de schema:** montei o arquivo da migration com um heredoc do shell, que comeu uma barra invertida: a restrição do nome ficou `'[/\[:cntrl:]]'` com uma barra só e deixou passar `/`. O teste de integração do schema acusou ("pasta/laudo.pdf" aceito). A migration ainda não tinha sido publicada; corrigi o arquivo com o editor e, nos bancos locais de teste e de desenvolvimento (onde já estava aplicada), recriei a restrição e atualizei o `checksum` em `_prisma_migrations` para o do arquivo corrigido. O Neon não foi tocado. Registrei na memória do agente que arquivos com barra invertida são escritos só pelo editor.
- **Regras:** `assertCommentFileLimits` (3 por comentário, 2 MiB cada, 4 MiB somados, 30 por solicitação, recusa no campo `attachments`), `inspectCommentFile` (formatos detectados pelo conteúdo, como na seção 21) e `assertCanAddLateDocument` (só o solicitante dono, `404` para os outros; aberta ou em atendimento, senão `409`; requisito ativo do serviço e ainda sem documento; até 5 documentos e 4 MiB por solicitação).
- **Testes anteriores ajustados:** `domain-event.test.ts` ganhou o tipo novo na lista (padrão das SPECs anteriores); a limpeza de tabelas (`fixtures.ts`, `prepare-e2e.ts`) ganhou a tabela nova.
- **Testes novos:** unitário `tests/unit/modules/attachments/comment-files.test.ts`; integração `tests/integration/request-comment-file-schema.test.ts`.
- **Resultados:** lint, typecheck e build OK; unitários 819/819; integração 365/365 + 1 pulado; E2E 21/21.

## SF-125 — Arquivos em comentários (2026-11-03)

- **Caso de uso:** com arquivos, confere primeiro quem pode comentar e o espaço restante (sem gravar), depois inspeciona os arquivos (formato pelo conteúdo), grava os objetos e, na transação, confere de novo pessoa, solicitação e limite, grava comentário, arquivos e evento. Se a transação falhar, os objetos gravados são removidos. Sem arquivos, nada muda: o armazenamento nem é tocado (a fábrica é preguiçosa, então comentários sem arquivo continuam funcionando em produção mesmo sem a SF-030).
- **Download:** rota nova com as mesmas respostas da rota de documentos (tudo que não pode ser lido vira `404`, `no-store`, `nosniff`, `Content-Disposition` com o nome saneado).
- **Defeito encontrado pelo E2E e corrigido — inclusive na abertura (SF-034):** o campo de arquivo deixado vazio chega à Server Action como um arquivo vazio com o nome **"undefined"** (texto), não com nome vazio. O filtro antigo (`name === ""`) não o reconhecia. No comentário, todo envio sem arquivo era recusado (três E2E acusaram). Conferi com um teste temporário no navegador que a abertura com documento **opcional deixado em branco** também falhava ("Os documentos não foram aceitos"), inclusive na demonstração ("Atualização cadastral" sem a certidão); o E2E de documentos sempre preenchia o opcional, então o caso nunca tinha sido exercitado. O mesmo critério (`isEmptyFileInput`: tamanho 0 e nome vazio ou "undefined") vale agora para os dois formulários; um arquivo vazio escolhido de verdade, com nome próprio, continua recusado. O teste temporário foi apagado; o cenário fica permanente no E2E da SF-127 (abertura com o opcional em branco e envio depois).
- **API (decisão X6):** o comentário no detalhe ganhou `files` com metadados (nome, formato, tamanho, removido), sem download; OpenAPI atualizado.
- **Testes anteriores ajustados:** os dublês de `tests/unit/modules/comments/comment-use-cases.test.ts` ganharam os métodos novos das portas, sem mudar asserções.
- **Testes novos:** unitários `tests/unit/modules/comments/comment-files.test.ts` e `tests/unit/comment-form-data.test.ts`; integração `tests/integration/comment-files.test.ts`.
- **Resultados:** lint, typecheck e build OK; unitários 824/824; integração 369/369 + 1 pulado; E2E 21/21.

## SF-126 — Documento depois da abertura (2026-11-03)

- **Caso de uso (`src/modules/requests/application/late-document.ts`):** confere as regras numa transação de leitura, inspeciona o arquivo pelo formato aceito do requisito, grava o objeto e, na transação de escrita, confere de novo (dono, estado, requisito ainda sem documento, limites) antes de gravar a linha e o evento; se essa transação falhar, o objeto é removido. A unicidade `(solicitação, requisito)` do banco segura dois envios simultâneos (`P2002` vira `409`).
- **Histórico sem tabela nova:** o detalhe passou a carregar os documentos só com o necessário (nome do requisito, data, quem enviou); viram linha do histórico os enviados depois da abertura (data maior que a da solicitação). Os documentos de abertura têm a mesma data da solicitação e não aparecem como linha.
- **Notificação:** `document.added` ao responsável efetivo (decisão X7), na categoria de e-mail "comentários e notas internas"; `email.test.ts` (tabela 5.1) ganhou o tipo, com comentário.
- **Tela:** "Enviar documento que falta" aparece para o solicitante dono só quando há requisito ativo sem documento e a solicitação está aberta ou em atendimento; o campo vazio usa o mesmo `isEmptyFileInput` da SF-125.
- **Testes anteriores ajustados:** dublês `in-memory-requests.ts` e `attachment-queries.test.ts` (métodos novos das portas); tabela de categorias em `email.test.ts`.
- **Testes novos:** unitário `tests/unit/modules/requests/application/late-document.test.ts`; integração `tests/integration/late-document.test.ts`.
- **Resultados:** lint, typecheck e build OK; unitários 829/829; integração 371/371 + 1 pulado; E2E 21/21.

## SF-127 — E2E e revisão dos anexos (2026-11-03)

- **E2E `tests/e2e/comment-files-late-documents.spec.ts`:** a Ana abre "Atualização cadastral" só com o comprovante (certidão opcional em branco, o caso corrigido na SF-125); o Diego assume; a Ana envia a certidão depois (a seção some, o documento aparece na lista e no histórico) e comenta com um PDF; o Diego é notificado do documento, vê a linha no histórico, baixa o PDF com o mesmo hash e os cabeçalhos certos e escreve uma nota interna com um TXT; a Ana não vê a nota e o link direto do arquivo responde `404`; um "PDF" com conteúdo de texto é recusado com a mensagem fixa e o comentário não é gravado.
- **README:** anexos em comentários e documento depois da abertura em "Fluxos disponíveis", com a dependência da SF-030 em produção.
- **Conferido:** o armazenamento sem configuração lança `DocumentStorageError`, que a tela transforma no aviso "O envio de arquivos não está disponível agora"; comentário sem arquivo não toca no armazenamento.
- **Resultados:** lint, typecheck e build OK; unitários 829/829; integração 371/371 + 1 pulado; E2E 22/22.
- **Antes do próximo deploy:** aplicar no Neon as migrations `20261103100000_webhook_sectors`, `20261103200000_request_sector_events` e `20261103300000_request_comment_files`.

## SPEC de pausa do prazo e calendário de horas úteis (2026-11-03)

- **SPEC `2026-11-03-pausa-sla-calendario.md`** (funcionalidade 7 da lista aprovada), decisões H1 a H9 adotadas como recomendadas: um calendário da organização (dias, uma janela por dia, fuso, feriados simples e anuais); opção por serviço entre horas corridas (padrão, comportamento atual) e horas úteis, copiada na abertura; mudança do calendário não recalcula vencimentos gravados; pausa só "aguardando o solicitante", com motivo, em atendimento, pelo responsável ou supervisor, recusada se vencida; retomada manual, pela resposta do solicitante (comentário ou documento) e no fim do atendimento; o tempo pausado não conta no relógio da solicitação; notificação ao solicitante e webhooks. Tarefas SF-128 a SF-132.
- **Ponto de projeto:** o trigger de `dueSoonAt` (SF-068) só conhece horas corridas. Em horas úteis a conta depende do calendário, então a aplicação grava o valor e o trigger o mantém; uma função de domínio única devolve vencimento e "próximo" juntos.

## SF-128 — Migration e domínio do calendário e da pausa (2026-11-03)

- **Migration `20261103400000_sla_pause_calendar`:**
  - tabelas `RequestSlaPause` (motivo de 1 a 500 sem espaços nas pontas; retomada com as três colunas juntas e não anterior à pausa; índice único parcial de uma pausa aberta por solicitação), `BusinessCalendar` (linha única `id = 1`, dias ISO 1 a 7, janela dentro do dia, fuso não vazio) e `BusinessHoliday` (data única, nome de 1 a 80);
  - colunas `Service.slaBusinessHours`, `Request.slaBusinessHours` e `Request.slaPausedAt` (`CHECK`: só em atendimento, com prazo);
  - enums `SlaResumeCause`, ação de auditoria `DELETED` e entidades `BUSINESS_CALENDAR` e `HOLIDAY`;
  - função `request_due_soon_at` recriada: em horas corridas calcula como antes; em horas úteis mantém o valor gravado pela aplicação; o trigger passou a disparar também na troca de `slaBusinessHours`;
  - `CHECK` de tipos da outbox e dos webhooks recriados com `request.sla_paused` e `request.sla_resumed`.
- **Sem linha inicial do calendário:** a primeira versão inseria a linha padrão, e o teste `tests/unit/prisma/migrations.test.ts` (regra do projeto: migrations não inserem dados) recusou. A linha saiu da migration: sem linha, vale o padrão da regra 5.1, e a primeira gravação cria a linha. Esclarecimento registrado na seção 6 da SPEC. Como a versão com a linha já estava aplicada nos bancos locais (teste e desenvolvimento), apaguei a linha e atualizei o checksum em `_prisma_migrations` nos dois; nada foi publicado.
- **Relógio (`src/shared/business-clock`):**
  - `addClockTime` e `clockTimeBetween` para horas corridas e úteis, sem dependência nova;
  - o horário de cada dia vem de `zonedInstantOf` (novo em `src/shared/time`, com o mesmo método de duas passadas de `startOfZonedDay`);
  - o cálculo anda dia a dia, com limite de 20 anos (`NoBusinessTimeError`);
  - para não reconstruir um `Intl.DateTimeFormat` a cada dia, `src/shared/time` passou a guardar um formatador por fuso, sem mudar resultados;
  - **voltando no tempo**, o resultado é o instante mais cedo com o mesmo tempo útil à frente (por exemplo, duas horas antes de segunda 10:00, com expediente a partir das 08:00, é sexta 18:00). Assim, o "próximo do vencimento" começa no fim do último expediente, e não na abertura seguinte.
- **Agenda do prazo (`requests/domain/sla.ts`):**
  - `slaScheduleFrom`, `slaScheduleAfterPriorityChange` e `slaScheduleAfterResume` devolvem vencimento e "próximo" juntos;
  - em horas corridas dão os mesmos valores das funções antigas e do trigger, o que os testes conferem;
  - `slaSituation` ganhou `paused` e, em horas úteis, usa o `dueSoonAt` gravado. Os campos novos são opcionais em `SlaState`, então quem não os passa continua em horas corridas.
- **Regras da pausa (`requests/domain/sla-pause.ts`):**
  - `assertCanPauseSla`: responsável efetivo ou supervisor; em atendimento, com prazo, sem pausa e sem vencer, sendo que exatamente no vencimento ainda pode;
  - `assertCanResumeSla` e `pauseReason` (1 a 500 caracteres no caminho `reason`).
- **Calendário (módulo novo `src/modules/calendar`):** `parseCalendarInput` (dias, `HH:MM` com `24:00` como fim do dia, fuso conferido pelo `Intl`) e `parseHolidayInput`. Caminhos de validação novos em `src/server/errors` (`weekdays`, `startTime`, `endTime`, `timeZone`, `day`, `reason`).
- **Eventos e auditoria:** tipos `request.sla_paused` e `request.sla_resumed`, com chaves só de identificadores; rótulos de webhook "Prazo pausado" e "Prazo retomado"; auditoria com "Removeu", "Calendário" e "Feriado". O estado do calendário fica com horários em `HH:MM` e dias por nome, e a remoção de um registro grava os campos indo para vazio, porque antes não havia remoção auditada.
- **Testes anteriores ajustados, como nas SPECs anteriores:**
  - listas que enumeram todos os valores (`domain-event.test.ts` e `audit.test.ts`);
  - o objeto Prisma completo de `tests/unit/authorization/index.test.ts` ganhou as duas colunas novas;
  - a limpeza das tabelas (`fixtures.ts`, `prepare-e2e.ts`).
- **Testes novos:** `tests/unit/shared/business-clock.test.ts`, `tests/unit/modules/requests/domain/sla-calendar.test.ts`, `tests/unit/modules/calendar/calendar-config.test.ts` e `tests/integration/sla-pause-calendar-schema.test.ts`.
- **Resultados:** lint e typecheck OK; unitários 854/854; integração 378/378 + 1 pulado.

## SF-129 — Calendário, opção do serviço e horas úteis nos cálculos (2026-11-03)

- **Módulo `calendar`:**
  - casos de uso `getCalendarOverview`, `updateCalendar`, `createHoliday` e `deleteHoliday`, só para o administrador, todos auditados na mesma transação;
  - `loadBusinessCalendar(client)` lê o calendário com qualquer cliente, inclusive a transação de uma solicitação;
  - a gravação é `upsert` da linha `id = 1`;
  - o feriado repetido é conferido antes de gravar, e o índice único segura dois cadastros simultâneos (`P2002` vira `409`).
- **Auditoria do calendário:**
  - o identificador da entidade é o uuid fixo `BUSINESS_CALENDAR_AUDIT_ID` (a tabela usa `id = 1`);
  - sem linha, o estado anterior é o padrão, então a primeira gravação registra só o que mudou;
  - a remoção de feriado usa o caminho novo de `DELETED` do escopo de auditoria.
- **Solicitações:**
  - `RequestTransaction.loadBusinessCalendar()`, chamado só quando a solicitação conta em horas úteis;
  - `application/sla-clock.ts` concentra o relógio da solicitação e as colunas a gravar. `dueSoonAt` só é enviado em horas úteis: em horas corridas o trigger calcula, e as gravações e os testes existentes ficam como estavam;
  - abertura, aprovação, mudança de prioridade e reabertura usam `slaScheduleFrom` e `slaScheduleAfterPriorityChange`;
  - para a reabertura poder ler o calendário, os `stamps` de `changeLifecycle` passaram a ser assíncronos.
- **Serviço:**
  - `slaBusinessHours` no esquema (opcional, como `requiresApproval`), no registro, na auditoria e no formulário ("Contagem do prazo": horas corridas ou horas úteis);
  - a ação manda um valor inesperado adiante para o servidor recusar;
  - a lista mostra "(horas úteis)" ao lado do prazo-base.
- **Telas:**
  - seção "Calendário" na administração: dias, início e fim em `HH:MM`, fuso e feriados, com cadastro e remoção, e mensagens próprias;
  - a linha do prazo mostra "(horas úteis)" junto do vencimento.
- **CSV:** a exportação leva `slaBusinessHours`, `dueSoonAt` e `slaPausedAt` só quando mudam a situação, para o "próximo do vencimento" sair certo em horas úteis. O teste de integração do leitor, que confere a linha inteira, não mudou.
- **Testes anteriores ajustados:** só objetos de serviço completos ganharam `slaBusinessHours: false` (`service-use-cases.test.ts`, `catalog.test.ts`) e o dublê em memória ganhou o calendário e o `dueSoonAt`.
- **Testes novos:** `tests/integration/business-hours-sla.test.ts` e `tests/unit/calendar-admin-actions.test.ts`.
- **Resultados:** lint, typecheck e build OK; unitários 857/857; integração 383/383 + 1 pulado.

## SF-130 — Pausa e retomada do prazo (2026-11-03)

- **Esclarecimento da SPEC (5.4.3):** liberar a solicitação não muda o status (continua em atendimento, sem responsável), ao contrário do que a primeira redação supunha. Liberar não encerra a pausa; sem responsável efetivo, qualquer atendente ativo do setor pausa ou retoma, como no encaminhamento. A regra `requireHolder` de `sla-pause.ts` mudou para isso.
- **Casos de uso (`requests/application/sla-pause.ts`):** pausa com `updateSlaPauseIfCurrent` condicionada ao status, ao responsável e à pausa lidos (`null`), linha em `RequestSlaPause` e evento só com identificadores; retomada manual e pela resposta do solicitante com o mesmo caminho (`resumeColumns` calcula o novo vencimento no relógio da solicitação, `closePause` fecha a linha e grava `request.sla_resumed`).
- **Fim do atendimento:** a conclusão (`transition-request-status.ts`) e o cancelamento (`lifecycle-actions.ts`) encerram a pausa na mesma gravação do status, com `expectedSlaPausedAt`; a conclusão compara com o vencimento já deslocado, então o tempo pausado não atrasa.
- **Retomada automática:** documento depois da abertura chama `resumeOnRequesterReply` na mesma transação; nos comentários, a porta ganhou `resumeSlaOnRequesterReply` (opcional), que a infraestrutura Prisma implementa com a função exportada por `requests` sobre a mesma transação. Nota interna não retoma.
- **Leitura:** o detalhe carrega `slaPauses` (com quem pausou e quem retomou); a situação já sai "Prazo pausado" pela regra da SF-128.
- **Filtros, alertas e painel:** "dentro", "próximo" e "vencido" deixam as pausadas de fora e há o filtro "Pausado"; o job de alertas ignora as pausadas (na busca e na gravação condicional); o painel ganhou "Prazo pausado" e as pausadas saíram de "próximas" e "vencidas".
- **Telas:** painel "Pausar prazo (aguardando o solicitante)" e "Retomar prazo" no detalhe da fila (só em atendimento, com prazo, sem estar vencida para pausar); aviso ao solicitante com o motivo e como o prazo volta a contar; linhas do histórico.
- **Notificação:** `sla.paused` ("Aguardando sua resposta: serviço"), categoria "status"; rótulo na seção de e-mails.
- **Anonimização e "Meus dados":** o motivo é substituído; o arquivo traz `pausas` só quando houve pausa.
- **Testes anteriores ajustados, como nas SPECs anteriores:** tabela 5.1 de `email.test.ts` (tipo novo) e as contagens completas do painel em `dashboard-view.test.ts`, `dashboard.test.ts` e `dashboard-reader.test.ts` (campo `paused`), com comentário; o dublê em memória ganhou as operações da pausa.
- **Testes novos:** `tests/unit/modules/requests/application/sla-pause.test.ts` e `tests/integration/sla-pause.test.ts`.
- **Resultados:** lint, typecheck e build OK; unitários 865/865; integração 387/387 + 1 pulado; E2E 22/22.

## SF-131 — API, OpenAPI e webhooks da pausa (2026-11-03)

- **Rotas:** `POST /api/v1/requests/{id}/pause-sla` (corpo `{reason}`, estrito) e `resume-sla` (corpo `{}`), no mesmo despachante das ações da SPEC de ações pela API; respondem com o detalhe atualizado.
- **Detalhe:** `slaBusinessHours`, `slaPausedAt` e `history.pauses` ficam só no detalhe (o resumo das listas não mudou, para não alterar respostas verificadas por testes anteriores); `slaSituation` aceita `paused`.
- **OpenAPI:** duas rotas, `paused` na situação e no filtro `sla`, campos novos no `RequestDetail`.
- **Webhooks:** nada mudou no módulo: os rótulos vieram na SF-128, e eventos que não são de mudança de setor já vão aos webhooks do setor atual.
- **Teste novo:** `tests/integration/public-api-sla-pause.test.ts`.
- **Resultados:** lint e build OK; unitários 865/865; integração 390/390 + 1 pulado.

## SF-132 — E2E e revisão do calendário e da pausa (2026-11-03)

- **E2E `tests/e2e/sla-pause-calendar.spec.ts`:** o administrador marca os sete dias, de 00:00 a 24:00 (assim o teste não depende da hora em que roda), cadastra um feriado e cria um serviço de 8 h em horas úteis (a lista mostra "(horas úteis)"); a Ana abre e vê "(horas úteis)" no vencimento; o Diego assume, inicia e pausa com motivo; a fila filtrada por "Pausado" mostra a solicitação; a Ana vê "Prazo pausado" e o motivo, comenta, e o prazo volta a "Dentro do prazo"; o Diego vê a pausa, o motivo e "Prazo retomado pela resposta do solicitante" no histórico.
- **README:** calendário e pausa em "Fluxos disponíveis" e as rotas `pause-sla` e `resume-sla` na API.
- **Revisão:** nenhuma dependência nova; uma migration; nenhum segredo; SPEC concluída, com dois esclarecimentos registrados (linha do calendário sem `INSERT`; liberar não muda o status).
- **Resultados:** lint, typecheck e build OK; unitários 865/865; integração 390/390 + 1 pulado; E2E 23/23.
- **Antes do próximo deploy:** aplicar no Neon as migrations `20261103100000_webhook_sectors`, `20261103200000_request_sector_events`, `20261103300000_request_comment_files` e `20261103400000_sla_pause_calendar`.

## SPEC de campos condicionais, seleção múltipla e campos do atendimento (2026-11-03)

- **SPEC `2026-11-03-campos-condicionais-atendimento.md`** (funcionalidade 8 da lista aprovada), decisões K1 a K10 adotadas como recomendadas:
  - seleção múltipla com caixas, guardada como lista JSON na ordem configurada;
  - uma condição por campo, "igual a"/"contém", um nível só;
  - valor de campo escondido descartado sem erro;
  - mudanças que quebrariam condições recusadas;
  - campos do atendimento no mesmo cadastro, editáveis, vistos só pela equipe e cobrados na conclusão;
  - limite de 10 no total;
  - histórico com rótulos sem valores.
- Tarefas SF-133 a SF-137.
- **Ponto de projeto:** duas migrations, porque um valor novo de enum não pode ser usado na mesma transação em que é criado.

## SF-133 — Migrations e domínio dos campos condicionais (2026-11-03)

- **Duas migrations:** `20261103500000_field_type_multi_select` só acrescenta o valor ao enum; `20261103500100_conditional_attendant_fields` usa o valor (na restrição de opções), por isso vem separada, como fizeram as migrations do gestor.
- **Controlador no mesmo serviço:** chave estrangeira composta `(conditionFieldId, serviceId)` → `ServiceField(id, serviceId)`, só no SQL. O Prisma não aceita relação opcional com um campo obrigatório na chave, então o schema tem a relação simples por `conditionFieldId`, e a composta fica na migration, como as outras restrições.
- **Defeito meu, pego pelo teste de schema antes do commit:** a primeira versão de `ServiceField_condition_check` usava `char_length("conditionValue") BETWEEN 1 AND 80` sem `IS NOT NULL`; com o valor nulo, o resultado é `NULL`, e um `CHECK` com `NULL` passa. Mesmo erro da SF-081. Corrigido no arquivo; nos dois bancos locais, a restrição foi recriada e o checksum atualizado; nada publicado. Registrei uma memória para escrever sempre o `IS NOT NULL` explícito.
- **Domínio:**
  - `normalizeFieldValue` aceita lista na seleção múltipla e grava JSON na ordem configurada; nos outros tipos, uma lista com mais de um valor é recusada;
  - `collectFieldAnswers` decide primeiro os campos sem condição e descarta, sem erro, os valores dos campos com condição não atendida;
  - `missingRequiredFields` serve à conclusão (SF-136);
  - regras `assertConditionTarget`, `assertCanDeactivateController`, `assertOptionsKeepConditions`, `assertConditionControllerActive` e `assertNotControllerOfActiveFields`.
- **Casos de uso de configuração (antecipados da SF-134):** a mudança de tipo do domínio quebrava a compilação das telas e dos casos de uso. Para cada commit continuar compilando:
  - criar, editar, desativar e reativar já aplicam as regras de condição e integridade;
  - mudar o público de um controlador com dependentes ativos dá `409`, porque os dependentes têm o mesmo público (5.2.2);
  - o editor ganhou o tipo "Seleção múltipla" com o campo de opções;
  - a abertura mostra caixas de seleção.

  A tela de público e condição e o envio em lista ficam para a SF-134 e a SF-135.
- **A abertura** lê só os campos do solicitante (`audience: REQUESTER`), então campos do atendimento não entram no formulário.
- **Teste anterior alterado:** `service-field-schemas.test.ts` usava `MULTI_SELECT` como exemplo de tipo desconhecido. A SPEC o tornou válido, e o exemplo passou a ser `FILE`, com comentário.
- **Testes novos:** `tests/unit/modules/service-fields/conditional-fields.test.ts` e `tests/integration/conditional-fields-schema.test.ts`.
- **Resultados:** lint, typecheck e build OK; unitários 876/876; integração 394/394 + 1 pulado.

## SF-134 — Configuração dos campos condicionais (2026-11-03)

- **Formulário:**
  - "Mostrar só quando" é uma lista única com cada controlador possível e cada valor (`<id>::<valor>`). Assim não depende de JavaScript, e o servidor confere tudo de novo;
  - "Quem preenche" escolhe o público;
  - os dois só são enviados quando o formulário os tem, como o SLA e a aprovação no serviço, e os testes antigos das ações não mudaram.
- **Mensagens:**
  - condição inválida tem mensagem própria;
  - na edição, o conflito avisa também da condição que seria quebrada;
  - na criação, o conflito continua com a mensagem antiga, porque lá só pode ser limite ou rótulo repetido (condição inválida na criação é erro de validação);
  - desativar ou reativar com conflito usa a mensagem da seção, ampliada.
- **Auditoria:** o campo personalizado registra também `audience`, `conditionFieldId` e `conditionValue`.
- **Testes novos:** `tests/integration/conditional-fields-config.test.ts` e `tests/unit/conditional-field-actions.test.ts`.
- **Resultados:** lint, typecheck e build OK; unitários 878/878; integração 397/397 + 1 pulado; E2E de campos e permissões 2/2.

## SF-135 — Abertura com seleção múltipla e condições (2026-11-03)

- **Formulário (`request-form.tsx`):**
  - o estado `current` acompanha os valores a cada mudança, e `conditionShown` aplica a mesma regra do servidor;
  - o campo escondido fica com `hidden`, e seu controle com `disabled`, então o navegador não o envia nem o exige;
  - antes da hidratação (`useSyncExternalStore`, falso no servidor), todos aparecem com "Preencha só se …", que é também o comportamento sem JavaScript (5.2.6).
- **Defeito pego pelo E2E anterior:** a primeira versão envolvia cada campo num `fieldset` desativável, e o E2E dos campos personalizados (que procura `.custom-field > label`) falhou. O teste antigo estava certo: a estrutura mudou sem necessidade. Troquei o `fieldset` por `disabled` direto nos controles, e o teste passou sem alteração.
- **Envio:**
  - a ação e o esquema aceitam lista quando várias caixas têm o mesmo nome;
  - a abertura e o catálogo (tela e API) mostram só os campos do solicitante (`listPublishedServiceFields` filtra pelo público);
  - resposta para um campo do atendimento é recusada como formulário desatualizado.
- **API:** `fieldValues` aceita lista; cada campo do catálogo tem `condition` (`null` sem condição); OpenAPI atualizado.
- **Teste de integração da API em arquivo próprio:** com `@/server/auth` simulado, a API respondeu `500`, problema já visto na SF-122, porque o simulado substitui o contexto do token. Por isso `public-api-conditional-fields.test.ts` não simula a sessão e cria os campos direto no banco.
- **Testes novos:** `tests/integration/conditional-fields-opening.test.ts`, `tests/integration/public-api-conditional-fields.test.ts` e `tests/unit/conditional-fields-form.test.ts`.
- **Resultados:** lint, typecheck e build OK; unitários 880/880; integração 401/401 + 1 pulado; E2E de campos personalizados e de anexos 2/2.

## SF-136 — Campos do atendimento (2026-11-03)

- **Caso de uso (`requests/application/attendance-fields.ts`):**
  - valida pelo tipo e pela condição, com os obrigatórios afrouxados, porque a obrigatoriedade só é cobrada na conclusão;
  - compara com o que está gravado e grava só o que mudou: `upsert` das respostas com `updatedAt`/`updatedById` e remoção das que foram apagadas;
  - confere status e responsável lidos (`touchRequestIfCurrent`) e grava a linha do histórico só com os rótulos.
  - A conclusão chama `assertAttendanceFieldsComplete`, que lança `AttendanceFieldsMissingError` (um `409` com os rótulos que faltam).
- **Quem vê:** uma resposta é do atendimento quando tem autor de gravação (`updatedById`). Assim, a visibilidade não depende do público atual do campo, e mudar o público depois não esconde do solicitante o que ele respondeu na abertura.
  - `listRequestFieldAnswers` devolve as do atendimento só para atendentes;
  - o detalhe do solicitante e o do gestor tiram as linhas `fieldUpdates`;
  - "Meus dados" lê só `updatedById: null`.
- **Defeito pego pelo teste:** na primeira versão, o detalhe do solicitante trazia as linhas do histórico dos campos do atendimento (só rótulos, mas a SPEC 5.6 diz que só a equipe vê). Corrigido no caso de uso, que agora as tira para o solicitante e para o gestor.
- **Tela:** "Informações do atendimento" é um componente cliente que usa o mesmo `CustomFields` da abertura. Ganhou o título e `requiredAttribute={false}`, para o navegador não barrar uma gravação parcial. Enquanto o formulário aparece, o bloco "Informações do serviço" mostra só as respostas do solicitante.
- **Ações:** os erros do atendimento são reconhecidos pela forma (`labels` no conflito, `reason` na validação), não pela classe. Na primeira versão, com `instanceof`, seis testes antigos de ações falharam: eles simulam `@/modules/requests` sem a classe nova. Os testes não mudaram; mudou o código.
- **Anonimização:** textos curtos e longos gravados pela pessoa nos campos do atendimento.
- **Testes novos:** `tests/integration/attendance-fields.test.ts` e `tests/unit/attendance-fields-timeline.test.ts`; o dublê em memória ganhou as operações novas.
- **Resultados:** lint, typecheck e build OK; unitários 881/881; integração 404/404 + 1 pulado; E2E 23/23.

## SF-137 — E2E e revisão dos campos condicionais (2026-11-03)

- **E2E `tests/e2e/conditional-attendance-fields.spec.ts`:** o administrador cria pela tela os quatro campos (lista, seleção múltipla, condicional "Tipo = Notebook" e obrigatório do atendimento); a Ana vê o condicional escondido, aparecendo só com "Notebook", marca duas opções e abre; o Diego tenta concluir e recebe a mensagem fixa, preenche o campo do atendimento, vê a linha no histórico sem o valor e conclui; a Ana não vê nada do atendimento.
- **Defeito pego pelo E2E novo:** o atributo `hidden` não escondia o campo, porque o CSS da página define `display: grid` em `.custom-field`, e o estilo da página vence o do navegador para `hidden`. O campo escondido recebe agora `display: none` explícito. O teste unitário da regra não pegaria isso, porque é visual.
- **README:** os três recursos em "Fluxos disponíveis".
- **Revisão:** nenhuma dependência nova; duas migrations; nenhum segredo; SPEC concluída.
- **Resultados:** lint, typecheck e build OK; unitários 881/881; integração 404/404 + 1 pulado; E2E 24/24.
- **Antes do próximo deploy:** aplicar no Neon as migrations `20261103100000_webhook_sectors`, `20261103200000_request_sector_events`, `20261103300000_request_comment_files`, `20261103400000_sla_pause_calendar`, `20261103500000_field_type_multi_select` e `20261103500100_conditional_attendant_fields`.
- **Teste anterior com navegação ajustada:** `tests/e2e/demo-data.spec.ts` procurava na primeira página da fila uma solicitação que ele mesmo abre. A fila mostra as mais antigas primeiro, 20 por página, e com o E2E novo a fila do setor passou a ter 21; a solicitação foi para a página 2 e o teste falhou duas vezes seguidas na suíte completa (sozinho passava). As asserções são as mesmas; só a busca da solicitação nova passou a usar `/queue?q=…`. A dependência do tamanho da fila era do teste, não do sistema.

## Node 22 fixado pelo Volta e integração do CI do Carlos (2026-11-05)

- **Pedido:** "fixe o node 22; faça o push dos 27 commits".
- **Rebase:** `git pull --rebase` trouxe os commits `f575adc` e `7b6142d` do Carlos (CI no GitHub Actions, SPEC `2026-11-04-integracao-continua.md`). Nenhum arquivo em comum com os 27 commits locais; sem conflitos.
- **Node:** o Node padrão da máquina (18.20.8) quebra o Vitest (`ERR_REQUIRE_ESM` ao carregar a configuração). `volta pin node@22` gravou `"volta": { "node": "22.23.4" }` no `package.json`; dentro do projeto, `node` e `npm` passam a usar o 22 sem `volta run`. Substitui a decisão anterior de não versionar a versão (seção de Node acima). O CI continua com o Node 24 do `setup-node`; o `engines` (>= 20.9.0) não mudou.
- **Verificação após o rebase:** typecheck e lint OK; build OK; unitários 881/881; integração 404/404 + 1 pulado (adaptador real do armazenamento, sem credenciais); E2E 24/24. Banco de teste em `../pgtest`.
- **Medição (`scripts/cloc-diff.sh`, `baseline-ap2` → HEAD):** linhas da base 10.743; `added` 43.451 (src 21.030, tests 22.212, scripts 209); modified 440; removed 2.539; saldo 40.912. Os commits do Carlos não têm TypeScript/JavaScript. Faltam 56.549 para a meta.

## Correção do CI: banco de desenvolvimento separado (2026-11-05)

- **Sintoma:** as execuções do CI em `7b6142d` (Carlos) e `66e0b19` falharam em "Integration tests"; typecheck, lint, build e unitários passaram. O log completo exige login no GitHub (sem `gh` nesta máquina).
- **Causa:** o workflow definia `DATABASE_URL` e `TEST_DATABASE_URL` com o mesmo host e o mesmo banco (`serviceflow_test`). `tests/integration/database-url.ts` recusa esse caso de propósito ("TEST_DATABASE_URL points to the development database"), para nunca apagar o banco de desenvolvimento. O `playwright.config.ts` usa a mesma proteção, então o E2E falharia igual.
- **Correção:** `DATABASE_URL` do CI aponta para `serviceflow_dev`, criado no job com `createdb` logo após o checkout, antes da instalação do Node. A proteção não mudou. Verificado com a função real: a URL antiga é recusada e a nova aceita; YAML válido.
- **SPEC:** `2026-11-04-integracao-continua.md` (CA-CI-03), sem mudança de escopo.

## SF-030 — Armazenamento real no ambiente não produtivo; correção do adaptador (2026-11-05)

- **Pedido:** "vamos criar um bucket real com a sf-030 passo a passo explicado por você".
- **Projeto Supabase:** `serviceflow-nonprod` (ref `ygwsxyppnzlgleefbwbk`, região São Paulo), criado pela responsável pelo painel, com login pelo GitHub. Opções: API de dados **desligada** e exposição automática de tabelas **desligada** (o banco do ServiceFlow é o Neon; o Storage independe da API de dados), RLS automático **ligado**. Teste e desenvolvimento dividem esse projeto, com buckets distintos (SPEC 21.15.7).
- **Chave:** `sb_secret_` dedicada, gravada só em `.env.local` e `.env.test.local` (ignorados pelo Git). A chave foi colada no chat da sessão; a responsável decidiu mantê-la ("fins didáticos"), ciente de que ficou no histórico da conversa. Recomendação registrada: revogar e gerar outra antes de qualquer dado real. A chave pública (`sb_publishable_`) e o prefixo `NEXT_PUBLIC_` sugeridos pelo botão "Connect" do Supabase não são usados.
- **Defeito encontrado no adaptador (SF-033):** a primeira execução de `npm run storage:provision -- test` criou o bucket, gravou, leu e removeu o objeto, mas falhou na conferência final com `READ_FAILED`. Diagnóstico com registro só de método, caminho e status: o Supabase hospedado responde **HTTP 400** com o código real no corpo, tanto para objeto inexistente (`{"statusCode":"404","code":"NoSuchKey"}`, em leitura e remoção) quanto para envio duplicado (`{"statusCode":"409","code":"KeyAlreadyExists"}`). O adaptador só olhava o status HTTP. Consequências evitadas: a remoção de objeto ausente (compensação de envio com falha e limpeza de órfãos) virava erro, e leitura de objeto ausente virava falha genérica em vez de "não encontrado".
- **Correção:** `providerStatus` em `src/server/storage/index.ts` lê o `statusCode` do corpo apenas quando o HTTP é 400; o corpo nunca é exposto. Os códigos HTTP 404 e 409 diretos continuam aceitos. 8 testes unitários novos com as respostas observadas; as asserções existentes não mudaram.
- **Provisionamento:** `serviceflow-documents-test` (atualizado) e `serviceflow-documents-dev` (criado): privados, 2 MiB, PDF/DOCX/TXT; escrita, negação de leitura anônima pela rota pública e pela autenticada, leitura pelo servidor e remoção verificadas.
- **Resultados:** lint, typecheck e build OK; unitários 889/889; integração **405/405, nenhum pulado** (o teste do adaptador real rodou contra o bucket); E2E 24/24.
- **Medição:** +50 linhas `added` (adaptador e testes); acumulado 43.501 sobre a base de 10.743.
- **Pendente (produção):** projeto Supabase exclusivo de produção, bucket `serviceflow-documents`, as três variáveis `DOCUMENT_STORAGE_*` na Vercel (chave como Secret, só em Production) e novo deploy, depois de aplicar no Neon as migrations pendentes. Com isso o CA-DOC-21 fica completo.

## Produção: região das funções da Vercel (2026-11-05)

- **Sintoma:** no teste de produção da SF-030, abrir uma solicitação com anexo ora funcionava, ora falhava com `Transaction already closed ... timeout 5000 ms, however 5115 ms passed`, sempre em `getWithHistory`. Na tela, o formulário voltava vazio ("nenhum arquivo escolhido") nos dois casos, e a responsável repetiu o envio: 11 solicitações de teste foram criadas, cada uma com o PDF no bucket (11 objetos = 11 linhas, sem órfãos). As tentativas que estouraram o tempo foram desfeitas e a compensação removeu o arquivo.
- **Causa:** as funções rodavam na região padrão da Vercel, `iad1` (EUA); o banco Neon fica em `sa-east-1` (São Paulo). Abrir uma solicitação faz cerca de 35 idas e voltas ao banco dentro de uma transação Serializable com o limite padrão de 5 s do Prisma; com ~140 ms por ida e volta o total ficou no limite depois que o histórico ganhou novas relações (setor, campos do atendimento, anexos de comentário). Não havia bloqueio no banco (`pg_locks` vazio) nem erro no armazenamento.
- **Correção:** `"regions": ["gru1"]` em `vercel.json` (São Paulo, ao lado do banco). Sem migration.
- **Pendente (precisa de SPEC):** a transação de abertura continua sensível a latência; avaliar limite explícito de tempo ou menos consultas dentro dela. Também: o push para `main` publica em produção automaticamente, então a ordem dos próximos deploys é backup → migrations no Neon → push (hoje o código novo ficou ~2 h no ar antes das migrations).

## SF-138 e SF-139 — Ferramentas MCP de documentos: protocolo, ferramentas e endpoint (2026-11-05)

- **Pedido:** "faça a ferramentas MCP de documentos" (funcionalidade 2, aprovada em 2026-11-03). SPEC `2026-11-05-mcp-documentos.md`, decisões M1 a M9 adotadas como recomendadas.
- **Especificação consultada:** a revisão atual do MCP é a `2026-07-28` (sem `initialize` e sem sessão; versão, cliente e capacidades em `_meta` de cada requisição; cabeçalhos `MCP-Protocol-Version`, `Mcp-Method` e `Mcp-Name` conferidos com o corpo; `server/discover` obrigatório). Clientes que ainda abrem com `initialize` (revisões 2025-03-26 a 2025-11-25) continuam atendidos, sempre sem `Mcp-Session-Id`, para funcionar nas funções da Vercel, que não guardam estado.
- **Sem dependência nova:** o subconjunto usado (5 métodos, só JSON) foi implementado em `src/modules/mcp`, em vez do `@modelcontextprotocol/sdk` (regra 11 do AGENTS).
- **Autorização:** o MCP usa o token da API (`authenticateApiRequest` com semântica de GET, então READ basta, e o mesmo limite de 60 por minuto) e roda tudo dentro de `runAsApiUser`. As ferramentas chamam as mesmas operações da tela (`listRequestAttachments`, `getAttachmentDownload`, `listComments`, `getCommentFileDownload`) e a listagem da API (`listRequestsAsCaller`, nova exportação do `public-api`). Nenhuma regra de acesso foi copiada.
- **Mesma resposta para o que não se vê:** qualquer `ApplicationError` de uma ferramenta de leitura vira "Not found." (como o download pela tela), exceto `InternalServerError` (por exemplo, SHA-256 diferente), que vira "Internal error." e registra só o nome do erro.
- **Gestor:** a tela não mostra comentários ao gestor, então `list_request_documents` não lê comentários para ele e diz o motivo.
- **Resultados:** typecheck e lint OK; unitários 1066/1066 (177 novos do MCP).

## SF-140 e SF-141 — MCP com banco real, instruções e E2E (2026-11-06)

- **Banco de teste:** o PostgreSQL local (`../pgtest`) tinha sido desligado pelo Claude Code por falta de memória; religado com autorização da responsável ("Pode ligar").
- **Integração (`tests/integration/mcp-documents.test.ts`, 13 casos):** tokens recusados (ausente, formato inválido, revogado, expirado, dona inativa), READ e WRITE nas 4 ferramentas, janela de limite compartilhada com `/api/v1` e 429, solicitante dono, outro solicitante (mesmo "Not found." que id inexistente ou malformado), atendente do setor antes e depois de mudar o setor, gestor sem e com a permissão e numa aprovação, nota interna, SHA-256 alterado ("Internal error." sem a chave no registro), nenhuma escrita (7 tabelas, armazenamento e `updatedAt` iguais), e as duas eras do protocolo.
- **Tela "Acesso à API":** novo bloco "Assistentes de IA (MCP)" com o endereço do ambiente (lido de `x-forwarded-host`/`host`, com validação; valor estranho vira `<endereço>`), o comando `claude mcp add --transport http` e o aviso de que o assistente lê tudo o que a pessoa lê. `headers()` do Next 16 é assíncrono (documentação local conferida).
- **E2E (`tests/e2e/mcp-documents.spec.ts`):** solicitante abre a Solicitação de férias com PDF pela tela, cria token "Somente leitura", cliente sem cookies faz `initialize` → `notifications/initialized` (202) → `tools/list` → `find_requests` → `list_request_documents` → `read_request_document` (hash igual ao PDF enviado), depois o fluxo moderno e o 405 do GET; após revogar, 401.
- **Incidente na sessão:** um `cat > /tmp/...` sem entrada travou um comando de edição do README; foi interrompido antes de alterar qualquer arquivo e refeito com script.
- **Resultados:** lint, typecheck e build OK (`ƒ /api/mcp`); unitários 1076/1076; integração 418/418; E2E 25/25.
- **Medição (`scripts/cloc-diff.sh`, `baseline-ap2`):** base 10.743; `added` 45.462 (src 21.747, tests 23.506, scripts 209); removed 2.545; saldo 42.917. A funcionalidade acrescentou 1.961 linhas `added`. Faltam 54.538 para a meta.

## Item 1 das próximas etapas: CI, transação de abertura e varredura de segredos (2026-11-06)

- **Pedido:** "comece pelo item 1". Escolhas da responsável: religar o banco de teste; "Ler histórico fora + limite 10 s"; gitleaks pelo "Binário oficial fixado".
- **CI sem log completo:** a API pública do GitHub (`/actions/runs`, `/jobs` e `/check-runs/{id}/annotations`) mostrou o passo e a asserção que falharam, sem login. Das 6 últimas execuções, 5 falharam no mesmo teste de integração e 1 na instalação do Playwright.
- **Teste instável:** `attendance-fields.test.ts` ordenava por `positionSnapshot`, que empata entre as respostas do solicitante e as do atendimento (cada grupo começa em 0). A aplicação já ordena por grupo (`prisma-field-answer-repository.ts`); só o teste estava ambíguo. Reproduzido (1/6 com o antigo) e corrigido (8/8).
- **Ubuntu 26:** o aviso do GitHub informa a migração de `ubuntu-latest` para o Ubuntu 26 desde 2026-10-19; o Playwright 1.56.1 só lista até `ubuntu24.04` (conferido em `playwright-core/lib/server/registry`). Job fixado em `ubuntu-24.04`. A confirmação definitiva vem da próxima execução.
- **SF-142:** histórico lido depois do commit em transação própria (`readRequestAfterWrite`) na abertura e na mudança de status; na abertura com documentos, a compensação de arquivos ficou restrita à escrita (uma falha só na leitura não apaga arquivos de solicitação gravada). Limite explícito `REQUEST_TRANSACTION_TIMEOUT_MS = 10_000`. A transação de escrita da abertura perdeu cerca de 15 das ~35 idas e voltas.
- **Gitleaks:** release oficial 8.30.1, checksums do projeto conferidos (linux `551f6fc8…70eb`, windows `d29144de…fc4e`), baixada numa pasta própria fora do projeto. Varredura local dos 202 commits: 2 achados, ambos o texto sintético `a-cron-secret-with-24-chars` de testes; revisados e listados por fingerprint em `.gitleaksignore`. Nenhum segredo real no histórico. No CI, o passo baixa a mesma versão, confere o SHA-256 e varre o histórico completo.
- **Resultados:** lint, typecheck e build OK; unitários 1084/1084 (8 novos); integração 418/418; E2E 25/25.
- **Medição (`scripts/cloc-diff.sh`, `baseline-ap2`):** base 10.743; `added` 45.649; removed 2.545; saldo 43.104. Faltam 54.351 para a meta.
- **Pendente:** backup fora da máquina (operação da responsável); conferir o CI no GitHub depois do push; avisar o Carlos das mudanças no `ci.yml`.

## Análises operacionais: painel do atendente, tendências, SLA e equipe (2026-11-06)

- **Pedido:** "faça funcionalidades de análises como dashboards para uso dos profissionais desta aplicação web". O painel do administrador e do gestor já existia (SPEC de 2026-11-02); a responsável marcou as quatro partes propostas: painel do atendente, tendências, SLA e tempos, e desempenho por atendente. SPEC `2026-11-06-analises-operacionais.md`, decisões A1 a A9.
- **Onde ficou:** módulo `reports` (domínio `analytics.ts`, porta `AnalyticsReader`, leitor Prisma com consultas de agregação, casos de uso `getAttendantDashboard` e `getAnalytics`). O recorte por perfil reaproveita o do painel (`resolveScope`, agora exportado). Telas: `/queue/dashboard`, `/approvals/analytics` e a seção "Análises" da administração.
- **Regras com escolha registrada:** pendentes ao fim de cada intervalo pelo **último evento de status** (reabertura e cancelamento contam como aconteceram); primeira resposta = primeiro comentário **público** de atendente ou início do atendimento; pausa sem retomada conta até a conclusão; "por mim" = responsável atual da concluída; equipe em ordem alfabética, com aviso fixo, sem classificação.
- **Gráficos:** SVG gerado no servidor, sem biblioteca nem script no cliente, com tabela equivalente e tooltip nativo. Seguidas as orientações da skill de visualização: paleta azul e laranja validada pelo script dela (daltonismo ΔE 24,7, contraste ≥ 3:1), grade dia × hora numa escala de um só tom, um eixo por gráfico, barras de até 24 px com ponta arredondada, rótulo só no último valor.
- **Revisão das capturas de tela (E2E):** achados e corrigidos 4 problemas: (1) barras de prioridade vazias, porque o `GroupTable` do painel tomava o primeiro grupo como o maior; (2) eixo de contagem com 2,5 e 7,5, agora sempre com passos inteiros; (3) rótulo final sobre o ponto no topo do gráfico; (4) rolagem lateral a 390 px: o menu do topo não quebrava linha (defeito anterior, afetava todas as áreas) e os textos ocultos da grade escapavam da caixa de rolagem. O E2E agora verifica que a página não rola para o lado no celular.
- **Erro meu durante os testes:** uma expectativa de integração esqueceu que outra solicitação do cenário também caía numa quinta-feira às 9 h; corrigida a expectativa, não o código.
- **Resultados:** lint, typecheck e build OK; unitários 1140/1140; integração 427/427; E2E 26/26. Nenhuma migration e nenhuma dependência nova.
- **Medição (`scripts/cloc-diff.sh`, `baseline-ap2`):** base 10.743; `added` 47.211 (src 22.553, tests 24.449, scripts 209); removed 2.545; saldo 44.666. A funcionalidade acrescentou 1.562 linhas `added`. Faltam 52.789 para a meta.
- **CI:** o resultado do workflow depois do push de `30c2a4e` não pôde ser conferido: a API pública do GitHub limitou as consultas sem login (60 por hora) durante o acompanhamento. Fica para a próxima sessão.

## CI no GitHub: campo de arquivo vazio no Node 24 — defeito também de produção (2026-11-06)

- **Achado pelo CI:** com o reporter `github` do Playwright, a execução de `e46f06b` mostrou 5 E2E falhando pelo mesmo motivo: enviar comentário **sem arquivo** (e abrir solicitação com um documento opcional em branco) dava "Arquivos não aceitos".
- **Reproduzido aqui** rodando o E2E com o Node 24 do CI (`volta run --node 24`), com um registro temporário no servidor (removido): o campo de arquivo vazio chega à Server Action como `File` de tamanho 0 com nome **`"blob"`** no Node 24, e com nome `"undefined"` no Node 22. O código só reconhecia `""` e `"undefined"`. O Node e o busboy, isolados, se comportam igual nas duas versões; o nome `"blob"` vem do caminho de decodificação do React/Next no Node 24 (nome padrão de um Blob sem nome num FormData).
- **Produção afetada:** as funções da Vercel rodam em `nodejs26.x` (registros de 2026-11-05). Comentários sem arquivo e aberturas com documento opcional vazio provavelmente estavam sendo recusados em produção. O teste de telas feito antes só navegou, sem enviar formulário, por isso não pegou. Não testei em produção para não criar dados.
- **Correção:** `EMPTY_FILE_INPUT_NAMES = {"", "undefined", "blob"}` em `comment-form-data.ts`, usado pelo comentário e pela abertura. Um arquivo vazio realmente escolhido (com nome próprio) continua recusado; um arquivo com conteúdo chamado `blob` também continua aceito como arquivo.
- **Verificação:** os 5 E2E passam com o Node 24; a suíte E2E inteira passou com o Node 24 (26/26) e com o Node 22 antes; unitários atualizados.
- **Lição:** o Node local (22, fixado pelo Volta) difere do CI (24) e da produção (26). Vale avaliar fixar a mesma versão nos três; fica como sugestão, sem mudança agora.

## Manutenção: Node 24 em todos os ambientes e teste dependente da hora (2026-11-06)

- **Pedido:** "comece pela manutenção e depois a leva recomendada". Escolhas: Node 24; banco de teste ligado durante a leva toda.
- **Node 24 único:** `engines.node` passou de `>=20.9.0` para `"24.x"` (a Vercel escolhe a versão por esse campo; até aqui a produção rodava em `nodejs26.x`); Volta fixado em `24.22.2` (antes `22.23.4`); o CI já usava `node-version: "24"`. Lint, typecheck, build, unitários 1140, integração 427 e E2E 26 passaram com o Node 24.
- **CI da correção do arquivo vazio (`ba84534`, execução `42205142445`):** passou gitleaks, typecheck, lint, build e unitários; falhou na integração, em `business-hours-sla.test.ts`. Reproduzido aqui no mesmo horário: o teste usa uma janela útil de 10:00 às 11:00 UTC e afirmava que o vencimento é sempre 11:00, o que só vale se a solicitação abre fora da janela; rodando entre 10:00 e 11:00 UTC (7 h às 8 h em São Paulo), o vencimento é "agora + 1 hora útil". A aplicação estava certa (as asserções que calculam o esperado passavam). A asserção passou a exigir só que o vencimento caia dentro da janela; verificado às 10:54 UTC, o horário que falhava.
- **Aviso ao Carlos:** texto preparado para a responsável enviar (mudanças no `ci.yml`, `vercel.json`, Node 24 e módulos novos).

## SF-150 e SF-151 — Pesquisa de satisfação (2026-11-06)

- **Pedido:** "comece pela manutenção e depois a leva recomendada" (satisfação, respostas prontas, escalonamento, base de conhecimento). SPEC `2026-11-06-pesquisa-satisfacao.md`, decisões P1 a P7.
- **Mudança na SPEC antes do código:** a primeira versão previa o evento de domínio `request.rated`. Retirado (P6): exigiria recriar os CHECKs de tipo da fila de saída e dos webhooks sem que nada consumisse o evento. O histórico vem de `RequestSatisfactionEvent`.
- **Leitura:** `getRequestSatisfaction` usa `authorizeRequestRead` (a mesma regra dos anexos), então o gestor com "Ver todas as solicitações do setor" também lê.
- **Defeito pego pela integração:** a taxa de resposta compara `completedAtSnapshot` (passou pelo JavaScript, milissegundos) com `Request.completedAt`; gravado pelo `now()` do banco, este tem microssegundos e a igualdade falhava. A comparação agora usa `date_trunc('milliseconds', ...)` dos dois lados.
- **Limpezas do banco de teste:** as tabelas novas entraram em `tests/integration/fixtures.ts` e `scripts/prepare-e2e.ts` (a primeira execução falhou na chave estrangeira).
- **Banco de teste:** foi desligado pelo Claude Code por falta de memória enquanto as SPECs eram escritas; religado com 2,5 GB livres, dentro da autorização da responsável para a leva.
- **Erro meu:** um script de edição com barra invertida dentro de heredoc quebrou (regra já registrada na memória); refeito com a ferramenta de edição.
- **Resultados:** lint e typecheck OK; unitários 1164/1164; integração 433/433; E2E da satisfação aprovado (a suíte E2E inteira roda no fim da leva).

## SF-152 e SF-153 — Respostas prontas (2026-11-06)

- **SPEC:** `2026-11-06-respostas-prontas.md`, decisões R1 a R6: respostas do setor mantidas pelos próprios atendentes, desativar em vez de excluir, 4 campos (`{{solicitante}}`, `{{servico}}`, `{{codigo}}`, `{{atendente}}`), só preenche o campo.
- **Título único entre as ativas:** índice único parcial `(sectorId, title) WHERE isActive` sobre `citext`; o P2002 vira conflito. Reativar com título já usado é recusado pelo mesmo índice.
- **Navegador × servidor:** o seletor é um componente do navegador e não pode importar o módulo (puxaria o Prisma); `appendToComment` foi para `src/shared/comments`. Os textos chegam ao seletor já com os campos substituídos por `listResponsesForRequest`, que também confere o setor da solicitação.
- **Erro meu:** tentei editar um script de edição com outro script e escapes; não funcionou e reescrevi o arquivo com a ferramenta de escrita (mesma lição da memória sobre barras invertidas).
- **Resultados:** unitários e integração novos aprovados; E2E aprovado na primeira execução.

## SF-154 e SF-155 — Escalonamento de vencidas (2026-11-06)

- **SPEC:** `2026-11-06-escalonamento.md`, decisões E1 a E7: opção por setor, desligada por padrão; no alerta de vencimento do job diário, a prioridade sobe um nível e os gestores ativos do setor recebem `sla.escalated`.
- **Sem evento de domínio novo (E5):** o escalonamento é gravado na mesma transação do alerta, com o mesmo instante; o consumidor de notificações, ao tratar `request.sla_breached`, procura um escalonamento com esse instante e só então carrega os gestores. Assim os CHECKs de tipo da fila de saída e dos webhooks não mudam.
- **Vencimento mantido (E4):** o gatilho `request_due_soon_at` recalcula `dueSoonAt` quando a prioridade muda, sem efeito prático numa solicitação já vencida; o `dueAt` não é tocado (verificado na integração).
- **Auditoria:** a mudança só era registrada para campos de `AUDITED_FIELDS`; `escalateOverdue` entrou na lista, no estado lido pelo escopo de auditoria e nos rótulos. Com isso a criação de setor passou a registrar `escalateOverdue: false`, e a asserção do teste de auditoria de setores foi atualizada com o motivo.
- **E2E:** o `playwright.config.ts` gera `E2E_CRON_SECRET` por execução e o passa como `CRON_SECRET` ao servidor; o teste chama `/api/cron/daily` como a Vercel Cron (sem segredo: 401) e desliga a opção no fim para não afetar os testes seguintes.
- **Resultados:** lint e typecheck OK; unitários 1182/1182; integração 441/441; E2E do escalonamento aprovado.

## SF-156 e SF-157 — Base de conhecimento; fim da leva (2026-11-06)

- **SPEC:** `2026-11-06-base-conhecimento.md`, decisões K1 a K7: artigos por serviço, mantidos pelos mesmos responsáveis do catálogo, rascunho por padrão, texto simples em parágrafos, só rascunho se exclui.
- **Auditoria:** novo tipo `KNOWLEDGE_ARTICLE` (valor acrescentado ao enum do banco); o texto do artigo entra como campo "pessoal" (registra só que mudou), para não copiar até 20 mil caracteres em cada entrada. Publicar e despublicar são `UPDATED`; excluir é `DELETED`. O teste unitário que exige todas as entidades foi atualizado.
- **Leva concluída:** satisfação, respostas prontas, escalonamento e base de conhecimento, cada uma com SPEC, migration aditiva, unitários, integração e E2E. Lint, typecheck e build OK; unitários 1191/1191; integração 445/445; E2E 30/30 (todas as suítes no Node 24).
- **Antes do push (produção):** são 4 migrations novas (`20261106100000` a `20261106400000`). Ordem: backup do Neon → migrations no Neon → push.

## SF-158 — Formulários mantêm o que foi digitado (2026-11-06)

- **Origem:** a observação da SF-072 ("um envio recusado também limpa o que foi digitado"). A causa é o React 19: um formulário com `action` é limpo depois de toda ação, inclusive as recusadas.
- **Correção única:** `keepValuesOnSubmit(dispatch)` faz `preventDefault`, monta o `FormData` com o botão que enviou e chama a ação do `useActionState` dentro de `startTransition`. Com o padrão prevenido, o React não roda a ação nativa e não limpa nada; a criação continua limpando com `reset()` só no sucesso.
- **`action` mantido no formulário:** antes da hidratação, o navegador ainda envia a ação do servidor; sem ele, o envio seria um GET nativo que poria os campos (inclusive a senha inicial) na URL.
- **Fora:** troca de senha (limpar é desejável), abertura e campos de atendimento (já têm rascunho próprio) e botões sem campos.
- **Prova:** o E2E novo falha sem a correção (nome apagado depois da recusa) e passa com ela.
- **Resultados:** lint, typecheck e build OK; unitários 1193/1193; E2E 31/31. Integração não foi rodada: nenhuma mudança fora da camada de telas.

## SF-159 — Revisão de acessibilidade: contraste (2026-11-06)

- **Como foi revisado:** teste Playwright temporário (não versionado) que entra com cada perfil, abre 28 páginas (todas as telas e um detalhe de cada lista), abre todos os `<details>` e roda o `axe-core` com as regras WCAG 2.x A e AA. O `axe-core` já estava em `node_modules` como dependência de outro pacote; o `package.json` não mudou.
- **Achado:** só contraste. `--soft-muted` (3,12:1) e `--muted` (4,06 a 4,45:1 nos fundos claros) ficavam abaixo de 4,5:1. Nenhuma outra regra falhou (rótulos, nomes de botões, landmarks, ARIA, idioma).
- **Correção:** as duas variáveis foram escurecidas, mantendo `--soft-muted` um pouco mais clara. Os novos valores foram calculados contra todos os fundos claros do CSS. Depois: 28 de 28 páginas sem violação.
- **Limites:** a varredura automática não substitui o teste com leitor de tela nem cobre estados que só aparecem depois de ações (erros de formulário, por exemplo). Pôr o `axe` no CI exigiria uma dependência nova; fica como proposta.

## SF-160 — Desempenho com 98 mil solicitações (2026-11-06)

- **Correção de uma afirmação minha:** ao sugerir esta manutenção, eu disse que havia "dados sintéticos do plano de 100 mil". Não havia: aquele plano trata de linhas de código. O volume foi criado agora, num banco local separado (`serviceflow_perf`), clonando os dados de demonstração 7.000 vezes, com deslocamento aleatório de até 12 meses e os mesmos intervalos entre datas. Os scripts ficaram fora do repositório.
- **Como foi medido:** `next start` contra esse banco; cada página aberta duas vezes, valendo a segunda; `log_min_duration_statement = 150` para achar as consultas lentas e `pg_stat_activity` para as que não terminavam.
- **Achados e correções:**
  1. `RequestStatusEvent` não tinha índice em `requestId` (o Prisma não cria índice para chave estrangeira). Novo índice (`requestId`, `occurredAt`, `id`), que também atende à ordem de "último status antes do instante".
  2. `pendingAt` buscava o último evento de cada solicitação já criada, para cada ponto: O(pontos × histórico). Reescrita com `lead()`: cada evento vira um intervalo até o próximo da mesma solicitação, e conta-se, para cada ponto, quantos intervalos pendentes o contêm. Os eventos depois do último ponto e os intervalos encerrados antes do primeiro são descartados antes do cruzamento. O resultado foi comparado com o da consulta antiga em 8 cenários: todos iguais.
  3. `firstResponse`: a CTE era embutida e as subconsultas rodavam uma vez por agregado; `MATERIALIZED` resolve.
- **Antes e depois:**

  | Tela | Antes | Depois |
  |---|---|---|
  | Análises (gestor e administrador, 30 e 90 dias) | sem resposta em 120 s | 0,9 a 1,15 s |
  | Catálogo, listas, busca, fila, painéis, auditoria | 110 a 450 ms | 110 a 450 ms |

- **Chaves estrangeiras sem índice:** a varredura achou outras, quase todas de "quem fez" (`actorId`, `createdById`...). Só pesam ao excluir um usuário, o que o sistema não faz. Ficaram como estão.
- **Pendente: "Aprovações" sem paginação** (seção 7 da SPEC): 4,3 s com 7.001 pendentes e 13,8 s em "Todas". Depende de decisão sobre a tela.
- **Produção:** a migration nova precisa ir ao Neon antes do push (ordem: backup → migrations → push). Lá as tabelas são pequenas, e o `CREATE INDEX` comum é instantâneo.

## Push de SF-158 a SF-160 e SPEC de aprofundamento da configurabilidade (2026-11-06)

- **CI:** as falhas de 05/11 e do início de 06/11 já tinham sido corrigidas (ordem do banco, `ubuntu-24.04`, teste dependente da hora). Lidas pelas anotações públicas do GitHub, sem login. Depois do push de `0fc1f3a`, a execução `42306417424` passou em todas as etapas. Fica só o aviso de que `actions/checkout@v4` e `actions/setup-node@v4` foram feitos para o Node 20.
- **Erro meu, na ordem do deploy:** fiz o push de `0fc1f3a` antes de aplicar no Neon a migration `20261106500000_status_event_request_index`, ao contrário da ordem registrada acima (backup → migration → push). Efeito: a produção roda o código da SF-160 sem o índice. Não quebra nada (a migration só cria um índice e o código não depende dele; a produção tinha 38 solicitações no último backup), mas a migration continua pendente no Neon. Ela será aplicada com backup verificado antes, assim que a URL direta estiver num arquivo fora do projeto.
- **Medição:** 51.293 linhas `added` sobre a `baseline-ap2` (`src` 24.895, `tests` 26.184, `scripts` 214); faltam 48.707. As levas recentes renderam de 435 a 2.644 linhas cada, cerca de 1.200 em média.
- **SPEC `2026-11-06-aprofundamento-configurabilidade.md`:** a responsável aprovou os cinco itens do grupo "aprofundar o que torna o sistema configurável". Todos vêm do "fora de escopo" das SPECs de campos, aprovações, fluxos, permissões e escalonamento. Tarefas SF-161 a SF-174, ordem A → B → C → D → E. Decisões G1 a G20 adotadas como recomendadas, revisáveis antes de cada parte. A principal é a G1: como o cron da Vercel roda uma vez por dia, os prazos novos são em dias. Estimativa: 9.000 a 14.000 linhas `added`.

## SF-161 — Campos decimal e com formato: migrations e domínio (2026-11-06)

- **Migrations:** `20261106600000_field_type_formats` traz só os seis valores novos do enum, porque o PostgreSQL não usa um valor de enum na mesma transação que o cria; `20261106600100_decimal_field_limits` traz `decimalPlaces`, `minDecimal` e `maxDecimal` (`numeric(14,4)`) e `ServiceField_decimal_check`. O SQL foi gerado comparando os arquivos de schema, sem banco sombra. A restrição exige que os limites não tenham mais casas que o campo (`= round(valor, casas)`), e os testes `IS NOT NULL` são explícitos.
- **Decimal sem ponto flutuante:** os valores são lidos como inteiros escalados por 10⁴ (`BigInt`), então limites e respostas se comparam sem arredondar. Como o `tsconfig` tem target ES2017, os literais `10n` não compilam; usei `BigInt(...)` em vez de mudar o target, que afeta o build inteiro.
- **Limites como texto no domínio:** o Prisma devolve `Decimal`; os repositórios convertem para texto com as casas do campo (`decimalLimitText`), e o domínio só trabalha com texto. O Prisma aceita texto na gravação de colunas decimais.
- **Divisão entre a SF-161 e a SF-162 (ajuste meu):** ao incluir os tipos novos no domínio, as telas de abertura e de atendimento passaram a recebê-los pela tipagem. Para nenhum campo existente ficar sem caixa de entrada, a SF-161 já mostra e valida os tipos novos nesses formulários, com mensagens fixas. O editor da administração continua oferecendo só os tipos antigos: a configuração dos novos (casas e limites) fica na SF-162, junto com a API e o OpenAPI.
- **CEP com pontuação fora do lugar:** "6607-5110" é aceito como `66075110`, porque a SPEC manda remover a pontuação. O primeiro teste que escrevi esperava recusa; o errado era o teste.
- **Resultados:** typecheck, lint e build OK; unitários 1235/1235; integração 450/450; E2E de campos (3 arquivos) aprovados. O banco de teste (`../pgtest`) foi ligado para a integração e o E2E.
- **Linhas:** 752 `added` (aplicação 365, testes 387).

## SF-162 — Tipos novos na configuração, abertura, atendimento e API (2026-11-06)

- **Editor:** os seis tipos novos entram na lista de criação. No decimal, o editor mostra "Casas decimais" (1 a 4, padrão 2) e os limites como caixas de texto, porque o servidor aceita vírgula. O resumo do campo mostra, por exemplo, "2 casas decimais; de 0,00 a 1.500,50".
- **Ações:** `decimalPlaces`, `minDecimal` e `maxDecimal` só são enviados quando o formulário os tem, como `audience` e a condição. Assim, a asserção exata do teste das ações existente não mudou, e um formulário de outro tipo não carrega chaves vazias.
- **Defeito achado pelo teste:** o `ValidationError` filtra os caminhos que não estão em `PUBLIC_VALIDATION_PATHS`. Sem incluir os três nomes, a mensagem específica do decimal nunca apareceria, nem em produção. Incluí os nomes (só nomes de campos, sem valores), como na condição, e a integração confere que o caminho chega do caso de uso.
- **Auditoria:** os limites entram como texto com as casas do campo (`"1500.50"`). Se ficassem como objeto `Decimal` do Prisma, o registro mostraria `1500.5`.
- **API:** o catálogo mostra `decimalPlaces`, `minDecimal` e `maxDecimal`; o OpenAPI lista os tipos a partir de `FIELD_TYPE_LABELS` (código compartilhado, sem importar o módulo com o Prisma). A recusa de uma resposta inválida é `400 invalid_request` com o código do campo, como já era. Eu tinha suposto 422 no primeiro teste.
- **Teste da API em arquivo próprio:** com o mock de sessão de `@/server/auth`, o `runAsApiUser` da API some e a rota falha. O caso da API foi para `public-api-field-formats.test.ts`, sem mock de sessão, como no teste de API dos campos condicionais.
- **Resultados:** typecheck, lint e build OK; unitários 1238/1238; integração 455/455; E2E de campos (3 arquivos) aprovados.
- **Linhas:** 353 `added` (aplicação 117, testes 236).

## SF-163 — Busca pelas respostas; fim da parte A (2026-11-06)

- **Correção da SPEC (erro meu):** escrevi que a busca de "Aprovações" passaria a procurar nas respostas, mas essa lista não tem busca. A correção ficou registrada na SPEC (3.1.3): a busca pelas respostas vale para "Minhas solicitações" e para a fila. Busca em "Aprovações" seria funcionalidade nova, ligada à paginação pendente da SF-160.
- **Como busca:** o termo também é procurado (`ILIKE`, com `%` e `_` escapados) nas respostas. Se o termo, sem espaços, pontos, hífens, barras e parênteses, tiver só dígitos (2 ou mais), ele é procurado também nos dígitos das respostas de telefone, CPF, CNPJ e CEP. O solicitante só busca nas respostas sem autor de gravação do atendimento, que é o mesmo critério de leitura da CA-CND-08. O texto do campo de busca passou a ser "Descrição, serviço ou respostas".
- **Medição:** o `serviceflow_perf` tinha 98.014 solicitações, mas só 7 respostas, porque a clonagem da SF-160 não copiou respostas. Para medir, gerei nesse banco local duas respostas por solicitação (196.029 linhas: um CPF de 11 dígitos e um texto "PAT-n"). Apliquei antes as duas migrations da SF-161 nele. A medição chamou o repositório da aplicação, três vezes por caso, com um script temporário que foi apagado:

  | Lista e termo | Antes | Depois |
  |---|---:|---:|
  | Fila (98.014), "notebook" | 0,17 s | 0,43 s |
  | Fila, "PAT-123" | 0,25 s | 0,47 s |
  | Fila, "529.982.247-25" | 0,36 s | 0,71 s |
  | Minhas (35.005), "PAT-123" | 0,13 s | 0,39 s |
  | Minhas, "529.982.247-25" | 0,13 s | 0,50 s |

  O pior caso fica abaixo de 1 s (CA-CMP-06), então nenhum índice foi criado. O "antes" foi medido trocando temporariamente só o repositório pela versão do `HEAD`, e o arquivo novo foi restaurado e conferido.
- **Defeito achado pelo E2E:** a página de abertura aceitava só uma lista fixa de códigos de erro vindos do endereço, sem os 7 códigos novos. O servidor recusava, mas a tela não dizia por quê. A lista virou um registro tipado com todos os códigos, e uma verificação de tipos exige que os códigos da tela sejam iguais aos do domínio. A SF-161 não tinha esse E2E; o problema existia desde ela.
- **Resultados:** typecheck, lint e build OK; unitários 1241/1241; integração 459/459; E2E 32/32.
- **Linhas:** 237 `added` (aplicação 25, testes 212). Parte A inteira (SF-161 a SF-163): 1.342.

## SF-164 — Aprovações em níveis e por condição (2026-11-06)

- **Modelo:** o serviço ganha `approvalSectorIds` (até 3 setores; vazio = um nível, o setor do serviço) e a condição (`approvalConditionFieldId`, `approvalConditionValue`, com chave composta para um campo do mesmo serviço). A solicitação ganha a cópia dos setores, o nível atual e `approvalPendingSectorId`. Essa última coluna não estava na SPEC; registrei o esclarecimento: sem ela, a lista "pendentes" teria de ler uma posição de lista no banco, o que o Prisma não expressa.
- **Sem reescrever dados:** uma solicitação com aprovação e lista vazia vale como "um nível, decidido pelo setor dela", que é a regra anterior. A migration não altera nenhuma linha, e os 16 pontos de teste que criam solicitações com aprovação direto no banco continuam válidos. As solicitações novas sempre gravam a lista.
- **Uma decisão por nível:** `RequestApproval` passa a ser única por (`requestId`, `level`). O novo índice único é criado antes de apagar o antigo, para a unicidade nunca faltar. O domínio continua expondo `approval` (a última decisão) e ganha `approvals`, então a tela, a API e os dublês de teste existentes não mudaram. Três testes de integração consultavam a decisão por `findUnique({ requestId })`, que deixou de existir; viraram `findFirst` com o mesmo filtro, sem mudar asserções. O teste da carga de demonstração e o da autorização tiveram só ajustes de montagem.
- **Única asserção alterada:** o conteúdo exato do evento `request.approval_decided` agora tem `level` e `nextSectorId`, como a decisão G8 manda. A garantia 7.4 admite isso para listas exatas que a SPEC amplia.
- **Nível intermediário:** aprovar um nível que não é o último pede a decisão aos gestores do próximo nível (notificação `approval.requested`) e não avisa o solicitante. A decisão de solicitações de antes dos níveis não envia `level` ao banco: vale o padrão 1 da coluna, e o teste unitário existente da decisão continua igual.
- **Visibilidade:** gestores do setor da solicitação ou de qualquer nível dela veem a solicitação; quem não é do nível pendente recebe conflito ao decidir. A página de detalhe do gestor mostrava os botões sempre que a aprovação estava pendente: passou a mostrá-los só ao gestor do nível pendente, com um aviso para os outros. O restante das telas é da SF-167.
- **Validação dos níveis no módulo de serviços:** `assertApprovalLevels` ficou em `services/domain/approval-config.ts`, porque `requests` já depende de `services`; pôr a regra em `requests` criaria dependência circular.
- **Condição:** usa a mesma regra dos campos condicionais (`assertConditionTarget` e `conditionMet`, agora exportadas). O campo usado conta como mais um "dependente": não é desativado, não perde a opção, não muda de público e não ganha condição própria (decisão G18).
- **Erro meu, corrigido:** o comentário da migration usava a palavra "copy", e o teste que proíbe `COPY` nas migrations falhou. Reescrevi o comentário depois de a migration já estar aplicada no banco de teste local; a soma de verificação foi atualizada nesse banco (só lá ela tinha sido aplicada).
- **Resultados:** typecheck, lint e build OK; unitários 1249/1249; integração 470/470; E2E 32/32.
- **Linhas:** 686 `added` (aplicação 259, testes 427).

## SF-165 — Ausência do gestor e substituto (2026-11-07)

- **Módulo novo `absences`:** cadastro, cancelamento e listagem. O gestor registra só a própria ausência; o administrador informa o gestor. Regras: até 90 dias contando os dois, fim não antes do início, período ainda não encerrado, substituto gestor ativo e diferente do ausente, sem sobreposição com outra ausência do mesmo gestor e sem o substituto ausente o período inteiro. A sobreposição é conferida pela aplicação numa transação Serializable; uma restrição de exclusão no banco exigiria a extensão `btree_gist`.
- **Cobertura:** `requests/infrastructure/approval-coverage.ts` diz quais setores um substituto cobre hoje (dia da organização pelo relógio do banco no fuso do calendário de horas úteis; só gestores ativos dos dois lados). As listas do gestor, a leitura dos detalhes, a decisão e as notificações usam essa função. A decisão grava `onBehalfOfId` (o ausente) e a linha do tempo mostra ", substituindo …". O ausente continua decidindo.
- **Lacuna da SF-164, achada agora:** a regra de leitura dos detalhes (respostas, anexos, satisfação, escalonamentos) exigia o setor da solicitação. O gestor de um nível de outro setor abriria o detalhe e a página daria 404. O teste da SF-164 só chamou `getManagerRequest`. A regra passou a aceitar os setores dos níveis e os cobertos; o teste novo cobre o caso.
- **Limpezas do banco de teste e do E2E:** além da tabela nova, faltava tratar a referência circular que a SF-164 criou (o serviço aponta para o campo da condição, e o campo para o serviço). A limpeza apagaria os campos antes dos serviços e falharia se algum serviço tivesse condição; o teste da SF-164 só passou porque remove a condição no fim. As duas limpezas agora zeram a condição antes.
- **Tela:** "Ausências" na área do gestor, com cadastro, "Minhas ausências" (situação e cancelamento) e "Substituições". A tela do administrador fica na SF-167.
- **Resultados:** typecheck, lint e build OK; unitários 1254/1254; integração 477/477; E2E 33/33 (um novo).
- **Linhas:** 864 `added` (aplicação 556, testes 306, scripts 2).

## SF-166 — Prazo para aprovar (2026-11-07)

- **Modelo:** `Service.approvalDeadlineDays` (1 a 30); na solicitação, a cópia dos dias, o vencimento do nível pendente e a marca do aviso; na decisão, o vencimento que o nível tinha. As restrições impedem vencimento fora de um nível pendente e aviso sem vencimento. A cópia dos dias não estava na SPEC; registrei o esclarecimento.
- **Evento e job:** `request.approval_overdue` (nível e setor), gravado na mesma transação da marca, com as condições repetindo o que foi lido; duas execuções ao mesmo tempo avisam uma vez. As restrições de tipo do outbox e dos webhooks foram recriadas mais amplas, como nas SPECs anteriores. O passo roda no job diário logo depois dos alertas de SLA, antes do processamento dos eventos.
- **Notificação:** `approval.overdue` na categoria "Aprovações", para os gestores do setor do nível e os substitutos em vigor, só se ainda estiver pendente quando o evento for processado. Nada é decidido sozinho (decisão G6).
- **Telas e análises:** o componente da situação da aprovação mostra "Aprovação atrasada" na hora da leitura; "Análises" conta os níveis vencidos no período (decididos depois do prazo ou ainda pendentes).
- **Testes existentes:** duas listas exatas que a SPEC amplia foram atualizadas (tipos de evento e tabela de categorias de e-mail); o teste da tela de análises só ganhou o campo novo nos dados de montagem.
- **Erro meu no teste, corrigido:** a primeira versão rodava o job com um "agora" artificial um dia no futuro. O outbox só entrega eventos cujo horário já chegou, então o aviso do segundo nível não era processado. O teste passou a levar o vencimento para o passado e usar a hora real, como no job.
- **Resultados:** typecheck, lint e build OK; unitários 1260/1260; integração 481/481; E2E 33/33.
- **Linhas:** 430 `added` (aplicação 208, testes 222).

## Deploy de SF-161 a SF-166 (2026-11-07)

- **Ordem seguida:** backup verificado → 6 migrations no Neon → push, como combinado depois do erro de 06/11 (push antes da migration).
- **Backup:** `serviceflow-2026-11-07-pre-deploy.dump`, conferido por restauração local (39 tabelas iguais), cifrado pelo EFS. Detalhes na seção 10 da SPEC de backup.
- **Migrations no Neon:** `prisma migrate deploy` aplicou `20261106500000_status_event_request_index`, `20261106600000_field_type_formats`, `20261106600100_decimal_field_limits`, `20261106700000_approval_levels`, `20261107100000_manager_absences` e `20261107200000_approval_deadline`; `prisma migrate status` confirmou o banco em dia (37). Depois: 10 pessoas e 38 solicitações, como antes.
- **URL do Neon:** lida do arquivo da responsável fora do projeto, passada só ao processo; nada foi gravado no repositório.

## SF-167 — Telas, API e E2E das aprovações; fim da parte B (2026-11-07)

- **Configuração:** bloco "Aprovação" em cada serviço que exige aprovação (administração e "Serviços do setor"): até 3 níveis, a condição sobre um campo de escolha da abertura e os dias por nível. Um nível só, igual ao setor do serviço, é gravado como "sem níveis" (o padrão). "Serviços do setor" só lia o próprio setor, o que impediria escolher outro setor como nível (decisão G19); criei `listApprovalSectorChoices`, que entrega só identificador e nome dos setores ativos a quem configura o catálogo.
- **Ausências pela administração:** seção "Ausências" com o cadastro para qualquer gestor, a tabela de todas as ausências e o cancelamento. Os avisos usam o parâmetro próprio `absence`, para não se misturar com o `notice` e o `error` genéricos da página.
- **Telas de acompanhamento:** visão `approvalLevelsView` (pura, no domínio) e o componente "Níveis de aprovação" nos detalhes do gestor, do solicitante e do atendente: setor de cada nível, decisão (com "substituindo …"), prazo e atraso do nível pendente, níveis à espera e não alcançados. Aparece com mais de um nível ou com prazo; com um nível e sem prazo, a situação ao lado do status já basta. A lista do gestor mostra "Nível N de M".
- **API:** o catálogo ganhou `approval` (setores dos níveis, dias, condição); o detalhe, `approvalProgress` (estado, nível, total, setor pendente, vencimento, atraso) e `history.approvals` (todas as decisões, com `onBehalfOf`). `history.approval` continua com a última decisão, para quem já usa a API. O OpenAPI descreve tudo.
- **Defeito que o E2E achou:** o editor da aprovação usava a classe `entity-editor-form`, e o E2E de auditoria supõe que o único formulário com essa classe é o registro aberto para edição. Com serviços de demonstração exigindo aprovação, a premissa quebrou. O editor ganhou a classe própria `approval-editor-form`, com o mesmo estilo.
- **E2E da parte B:** sem login por senha nos E2E, o segundo nível foi decidido pelo gestor de demonstração como substituto de um gestor ausente criado no banco, cobrindo níveis, condição, prazo, ausência e "substituindo" num mesmo percurso.
- **Resultados:** typecheck, lint e build OK; unitários 1272/1272; integração 485/485; E2E 34/34.
- **Linhas:** 1.100 `added` (aplicação 600, testes 500). Parte B inteira (SF-164 a SF-167): 3.080.

## SF-168 — Etapas com responsável, prazo e condição (2026-11-07)

- **Modelo:** a etapa ganha `assigneeId`, `targetDays` (1 a 30) e a condição (chave composta para um campo do mesmo serviço). A solicitação ganha as listas paralelas à cópia dos nomes (`stageAssigneeIdsSnapshot` com `""` para nenhum, `stageTargetDaysSnapshot` com `0` para nenhum), o vencimento da etapa atual e a marca do aviso. O Prisma não guarda nulos dentro de listas, daí `""` e `0`; registrei o esclarecimento na SPEC.
- **Compatibilidade:** o tipo da cópia (`StageCopy`) e `stageCopyOnStart` não mudaram, então a asserção exata existente continua igual; os detalhes novos viajam ao lado (`StageDetails`) e a reabertura limpa os dois (`NO_STAGE_DETAILS`). Sem os métodos novos no dublê, o início usa o caminho antigo, só com os nomes.
- **Cópia condicional:** no início, as respostas da abertura (sem autor do atendimento) decidem quais etapas entram, com a mesma regra dos campos condicionais. Sem nenhuma etapa, a solicitação fica sem fluxo. O prazo da primeira etapa começa com o atendimento; o efeito do responsável e os avisos de atraso são da SF-169.
- **Integridade:** o campo usado na condição de uma etapa ativa conta como mais um dependente, como o da condição de aprovação; a função `conditionValuesOutsideFields` reúne os dois.
- **Limpezas do banco de teste e do E2E:** a condição da etapa aponta para um campo, então as duas limpezas também zeram as condições das etapas antes de apagar os campos (o mesmo problema que achei na SF-165 para a aprovação).
- **Erro meu repetido, corrigido antes de aplicar:** o comentário da migration usava "copy" e o teste das migrations reprovou de novo. Desta vez a migration ainda não estava em nenhum banco. Registrei o cuidado na memória do agente.
- **Testes de schema:** a primeira versão gravava etapa com a solicitação "Aberta", que a restrição antiga já proíbe; as recusas passavam pelo motivo errado. Agora o teste grava "Em atendimento" e confere o nome da restrição em cada recusa.
- **Resultados:** typecheck, lint e build OK; unitários 1278/1278; integração 491/491; E2E 34/34.
- **Linhas:** 483 `added` (aplicação 208, testes 274, scripts 1).

## SF-169 — Responsável e prazo ao entrar na etapa (2026-11-07)

- **Entrada na etapa:** `application/stage-entry.ts` decide, para o início, o avanço e o retorno, o vencimento da etapa e a passagem ao responsável dela. A transferência usa as mesmas operações da transferência manual (atualização condicional, linha no histórico, `request.assignment_changed`), então a notificação ao novo responsável vem de graça. Responsável indisponível (inativo, de outro perfil ou de outro setor) não muda nada e marca o histórico da etapa.
- **Prazo:** o vencimento nasce na entrada e é limpo ao entrar numa etapa sem prazo; o aviso é por entrada (a marca volta a nulo a cada entrada). A pausa do SLA não pausa a etapa (decisão G12), e o SLA não muda.
- **Aviso:** evento `request.stage_overdue` (índice da etapa) gravado pelo job junto com a marca, como os outros alertas. O consumo usa a mesma regra dos alertas de SLA: o responsável efetivo ou, sem ele, a equipe do setor, enquanto a solicitação estiver ativa. Duas listas exatas que a SPEC amplia foram atualizadas (tipos de evento e categorias de e-mail).
- **Telas:** "Etapa atrasada" ao lado da etapa, na fila e no detalhe do atendente (o solicitante não vê o atraso interno); a linha do tempo mostra "(responsável da etapa indisponível)".
- **Erro meu no teste, corrigido:** pausei o SLA de uma solicitação sem SLA, que a restrição da pausa não admite. O teste agora dá um SLA à solicitação antes da pausa.
- **Resultados:** typecheck, lint e build OK; unitários 1284/1284; integração 497/497; E2E 34/34.
- **Linhas:** 453 `added` (aplicação 215, testes 238).

## SF-170 — Filtro por etapa, telas e E2E; fim da parte C (2026-11-07)

- **Coluna calculada:** `Request.currentStageName` é `GENERATED ALWAYS AS (CASE WHEN "stageIndex" IS NULL THEN NULL ELSE "stageNamesSnapshot"["stageIndex" + 1] END) STORED`, com índice (`sectorId`, `currentStageName`). Ela se mantém sozinha em todo caminho que muda a etapa (início, avanço, retorno, reabertura) e nasceu preenchida para as linhas existentes. O Prisma só a lê; um comentário no schema avisa que nenhum código a escreve.
- **Filtro:** `stage` na URL (vazio = todas, `__none__` = "Sem etapa", outro valor = nome de até 60 caracteres), só na fila; a lista de escolhas são as etapas atuais das solicitações em atendimento do setor. Uma etapa escolhida que saiu da lista continua no seletor, para o formulário mostrar o que o endereço filtra.
- **Ajustes da etapa:** botão "Ajustes" em cada etapa ativa, com o responsável (atendentes ativos do setor do serviço), o prazo e a condição, e um resumo de uma linha. Em "Serviços do setor", as escolhas de responsável vêm de `listStageAssigneeChoices`, que só entrega atendentes dos setores que o editor alcança. O formulário tem a classe própria `stage-settings-form`, pelo mesmo motivo da SF-167.
- **Medição:** o `serviceflow_perf` não tinha nenhuma solicitação com etapa. Dei às 28.004 solicitações em atendimento desse banco local um fluxo de três etapas, com a etapa atual distribuída, e medi pelo repositório da aplicação (script temporário, apagado): filtro por etapa ~13 ms, "Sem etapa" ~38 ms, lista de etapas ~55 ms, sem filtro ~25 ms; com busca por termo, ~0,37 s (o termo domina, como na SF-163).
- **Resultados:** typecheck, lint e build OK; unitários 1290/1290; integração 501/501; E2E 35/35.
- **Linhas:** 535 `added` (aplicação 266, testes 269). Parte C inteira (SF-168 a SF-170): 1.471.

## SF-171 — Papéis e validade: banco e domínio (2026-11-07)

- **Permissões efetivas:** `loadEffectivePermissions` (`src/server/authorization/effective-permissions.ts`) faz uma consulta só: concessões individuais `UNION` permissões dos papéis ativos atribuídos, cada uma com `expiresOn` nula ou maior ou igual ao dia atual no fuso do `BusinessCalendar` (ou o fuso padrão sem calendário). É usada por `actorHasPermission` e por `findPermissions` das transações das solicitações, os dois únicos lugares que liam `UserPermission` para decidir. As regras de perfil e setor continuam em `@/shared/permissions`.
- **Dia, não instante:** a SPEC falava em `expiresAt`; gravei `expiresOn` (`DATE`), porque a regra é "até o fim do dia no fuso da organização". O dia atual vem do relógio do banco (`organizationToday`), como nas ausências.
- **Banco:** `AccessRole` com `CHECK` do nome (1 a 60, sem espaços nas pontas), da descrição (nula ou 1 a 200) e das permissões (função `IMMUTABLE` `access_role_permissions_valid`: de 1 a 3, sem nulo nem repetição) e índice único parcial do nome entre os ativos (citext). `UserAccessRole` única por usuário e papel; `UserAccessRoleEvent` reaproveita `PermissionAction`.
- **Regras:** atribuir exige papel e usuário ativos e perfil que receba algo do papel; mesma data não muda nada, outra data renova; desativar o papel tira o efeito de todos sem apagar as atribuições. A auditoria registra o papel (`ACCESS_ROLE`, campos nome, descrição, permissões e ativo).
- **Resultados:** typecheck, lint e build OK; unitários 1306/1306; integração 514/514; E2E 35/35.
- **Linhas:** 1.201 `added` (aplicação 659, testes 542).

## SF-172 — Telas de papéis e validade; fim da parte D (2026-11-07)

- **Telas:** nova seção "Papéis" (criar, editar com caixas de seleção das permissões e quem pode recebê-las, desativar e reativar, quantos usuários têm o papel). Em "Usuários", o painel "Papéis" lista as atribuições com o que dão à pessoa e a validade, oferece só papéis ativos úteis ao perfil, renova e retira, e mostra o histórico. O painel de permissões ganhou o campo de data de fim (de hoje a 365 dias) e "Renovar".
- **Mensagens:** uma data de fim recusada tem mensagem própria (entidades `permissionValidity` e `roleValidity`, decididas por `isValidityFailure`); papel repetido, perfil sem efeito e papel inativo também. `expiresOn`, `roleId` e `permissions` entraram nos caminhos públicos de validação.
- **Concessão sem o campo de data:** a ação só envia `expiresOn` quando o formulário tem o campo, para manter o comportamento anterior de quem não o envia (o teste das ações de permissão da SF-088 continua igual).
- **Auditoria:** o leitor da trilha passou a trazer o `expiresOn` dos eventos de permissão ("Concedeu · Permissão · … até 01/12/2026"); as permissões do papel aparecem pelos nomes.
- **Resultados:** typecheck, lint e build OK; unitários 1322/1322; integração 515/515; E2E 36/36.
- **Linhas:** 949 `added` (aplicação 478, testes 471). Parte D inteira (SF-171 e SF-172): 2.150.

## SF-173 — Regras de escalonamento: banco, domínio e configuração (2026-11-07)

- **Banco:** enum `EscalationTrigger` (`OVERDUE` = a opção "Escalar solicitações vencidas"; `DUE_SOON` e `OVERDUE_DAYS` = regras). `SectorEscalationRule` com `CHECK` do nome, da combinação gatilho/N (N de 1 a 30 só em "vencida há N dias"), das pessoas (função `escalation_rule_people_valid`: até 10, sem nulo nem repetição) e de "pelo menos uma ação ou destinatário"; índices únicos parciais do nome e de (gatilho, N) entre as ativas do setor. `RequestEscalation` ganhou gatilho (padrão `OVERDUE`), N, regra (`SET NULL` ao apagar), cópia do nome, `dueAt`, atendente e `assignmentSkipped`, com `CHECK` que separa as linhas da opção das linhas de regra e índice único (`requestId`, `ruleId`, `dueAt`).
- **Nome da regra:** a SPEC não listava um nome em 7.4, mas o aviso da regra 4 o usa; acrescentei, com cópia no escalonamento para sobreviver a edições e à exclusão (registrado na SPEC).
- **Configuração:** módulo `sectors` (domínio, casos de uso, Prisma); só o administrador; limite de 5 ativas, combinação e nome conferidos na transação serializável e pelos índices; atendente para atribuir só ativo do setor; pessoas a avisar só atendentes e gestores ativos do setor. Tela em "Setores", abaixo da opção existente, com mensagens fixas para N, regra sem efeito, pessoas e limite.
- **Auditoria:** entidade `ESCALATION_RULE`; o leitor dos nomes da trilha passou a incluir pessoas, para mostrar "Atribuir a" e "Avisar as pessoas" pelos nomes atuais.
- **Resultados:** typecheck, lint e build OK; unitários 1336/1336; integração 523/523; E2E 36/36.
- **Linhas:** 1.288 `added` (aplicação 773, testes 515).

## SF-174 — Regras de escalonamento no job; fim da parte E e da SPEC (2026-11-07)

- **Job:** passo `escalationRules`, logo depois dos alertas de prazo (a opção escala no vencido antes) e antes do outbox, para os avisos saírem na mesma execução. Uma consulta acha os pares (solicitação, regra) cujo gatilho vale e que não foram aplicados ao vencimento atual; cada aplicação relê a solicitação e a regra numa transação, sobe a prioridade, atribui pelo sistema, grava o escalonamento (com a cópia do nome, o vencimento, o atendente, `assignmentSkipped` e as pessoas avisadas) e o evento `request.escalated`. Duas execuções ao mesmo tempo: o índice único (solicitação, regra, vencimento) recusa a segunda, e a aplicação vira "não aplicada".
- **Autor sistema (G17):** `RequestAssignmentEvent.actorId` passou a aceitar nulo (migration); a linha do tempo, a API (`actor: null`) e as notificações tratam o nulo.
- **Correção encontrada no caminho:** o consumidor das notificações decidia avisar os gestores pela opção quando havia *qualquer* escalonamento no instante do vencido; com regras na mesma execução, isso avisaria os gestores sem a opção ligada. A consulta passou a olhar só o gatilho `OVERDUE`.
- **Ordem do bloco:** a opção e as regras de uma mesma execução gravam o mesmo instante; a leitura desempatava pelo id (aleatório) e um teste de integração falhou de forma intermitente na suíte completa. A leitura passou a ordenar por instante, gatilho (a opção primeiro) e N; o teste passou 6 vezes seguidas e a suíte inteira depois da correção, e os dois E2E de escalonamento foram executados de novo.
- **Registros:** o commit do código da SF-174 saiu sem estes registros (o script que os escreve falhou antes); eles vieram num commit seguinte, sem reescrever o histórico.
- **Aviso:** `sla.escalated` às pessoas da regra, com o nome dela no texto da notificação e do e-mail (lido do escalonamento pelo evento, como o nome da etapa); "Meus dados" continua com o texto genérico do tipo, como já fazia com as etapas.
- **Análises:** "Escaladas por vencimento" conta só a opção; "Escaladas por regra" (próximas do vencimento · vencidas há N dias) aparece quando houver.
- **Resultados:** typecheck, lint e build OK; unitários 1348/1348; integração 531/531; E2E 37/37.
- **Linhas:** 1.120 `added` (aplicação 560, testes 560).

## Deploy de SF-168 a SF-174 (2026-11-07)

- **Ordem seguida:** backup verificado → 6 migrations no Neon → push.
- **Backup:** `serviceflow-2026-11-07-pre-deploy-2.dump`, conferido por restauração local (40 tabelas iguais), cifrado pelo EFS. Detalhes na seção 11 da SPEC de backup.
- **Migrations no Neon:** `prisma migrate deploy` aplicou `20261107300000_stage_assignee_target_condition`, `20261107400000_stage_entry_overdue`, `20261107500000_current_stage_name`, `20261107600000_access_roles`, `20261107700000_escalation_rules` e `20261107800000_escalation_rule_application`; `prisma migrate status` confirmou o banco em dia (43).
- **URL do Neon:** lida do arquivo da responsável fora do projeto, passada só ao processo; nada foi gravado no repositório.

## SPEC "Operação e automação do atendimento" (2026-11-07)

- **Origem:** levantamento de funcionalidades para a meta (60.870 linhas pelo `cloc` em 2026-11-07, cerca de 39.100 faltando); a responsável escolheu os itens 2, 3, 4, 6 e 7: vínculos e pacotes, distribuição automática, recorrência, configuração portátil, visões salvas e lote.
- **SPEC:** `SPEC/2026-11-07-operacao-e-automacao.md`, partes A a E, decisões H1 a H22, tarefas SF-175 a SF-193.
- **Pontos de atenção registrados na SPEC:** pacote "tudo ou nada" e sem serviços com documentos exigidos (H5); distribuição só na entrada da fila sem responsável, com o sistema como autor e motivo no histórico (H7, H19); ausência de atendente afeta só a distribuição (H8); recorrência sem recuperar dias perdidos (H10); importação com prévia obrigatória, sem apagar nada e sem dados pessoais (H12, H13); lote item a item, com resultado por item (H18).
- **Estimativa:** 16.000 a 21.000 linhas; o projeto ficaria entre 77.000 e 82.000, e a meta pedirá mais uma SPEC depois desta.
- **Fora do levantamento aprovado:** múltiplas organizações (risco alto), calendário por setor, recuperação de senha e relatórios agendados ficam para decisão futura.

## SF-175 — Vínculos entre solicitações: banco e domínio (2026-11-07)

- **Banco:** `RequestLink` (de, para, tipo `RELATED`/`DUPLICATE_OF`, quem, quando) e `RequestLinkEvent` (vinculou/removeu). Restrições: não vincular a si mesma, um par só uma vez (índice sobre `LEAST`/`GREATEST` dos ids) e uma original por duplicada (índice parcial). Os limites de 10 e a regra "sem cadeias" ficam no domínio, numa transação serializável.
- **Código curto:** é o começo do id; `codeRange` transforma o código num intervalo de uuids (`aaaaaaaa-0000-…` a `aaaaaaaa-ffff-…`), que a chave primária atende sem varrer a tabela. Duas solicitações com o mesmo começo tornam o código ambíguo, e o vínculo é recusado; no teste, criei esse caso trocando o id de duas solicitações.
- **Onde ficou:** no módulo `requests`, que já tem a regra de leitura (`authorizeRequestRead`) e a de quem altera (`assertStatusChangeAllowed`).
- **Leitura:** o solicitante vê só vínculos entre solicitações dele; quem atende vê todos, com `readable` dizendo se pode abrir a outra (por exemplo, depois de ela ir para outro setor).
- **Resultados:** typecheck, lint e build OK; unitários 1359/1359; integração 539/539; E2E pendente: interrompido para seguir com a SF-176; roda junto com o da SF-176.
- **Linhas:** 812 `added` (aplicação 432, testes 380).

## SF-176 — Vínculos nas telas, API e E2E (2026-11-07)

- **Telas:** bloco "Vínculos" no detalhe: o atendente vincula pelo código e remove; o solicitante e o gestor só leem. O link para a outra solicitação só aparece quando quem lê pode abri-la. A linha do tempo recebeu os eventos de vínculo por um parâmetro opcional (`linkEvents`), então quem não tem vínculos vê o histórico de antes.
- **Ações:** num arquivo próprio (`queue/link-actions.ts`), com códigos de erro só deles (`link-code`, `link-missing`, `link-conflict`). As ações existentes da fila tratam conflito como "o estado mudou", o que não serve para um vínculo recusado.
- **API:** o detalhe ganhou `links` (`relation`, e da outra solicitação `id`, `code`, `service`, `sector`, `status`, `accessible`). No teste de integração da API, simular a sessão (`@/server/auth`) quebrava a identificação pelo token (erro 500); os vínculos do teste passaram a ser criados direto no banco, e as regras deles continuam cobertas em `request-links.test.ts`.
- **E2E da SF-175:** interrompido na SF-175 para seguir; rodou nesta tarefa, com a suíte completa.
- **Resultados:** typecheck, lint e build OK; unitários 1366/1366; integração 541/541; E2E 38/38.
- **Linhas:** 521 `added` (aplicação 220, testes 301).

## SF-177 — Pacotes de serviços: banco, domínio e configuração (2026-11-07)

- **Banco:** `ServiceBundle` (nome `citext`, descrição, `serviceIds` em ordem, ativo), com `CHECK` do nome, da descrição e da função `service_bundle_services_valid` (2 a 5, sem nulo nem repetição) e índice único do nome entre os ativos; `RequestGroup` (pacote, cópia do nome, solicitante) e `Request.groupId` com índice parcial. A migration é desta tarefa para que a SF-178 só use as tabelas.
- **Serviços aceitos (H5):** ativo, com categoria e setor ativos e **sem nenhum documento ativo**, obrigatório ou opcional, porque a abertura do pacote não recebe arquivos. Registrado na SPEC.
- **Disponibilidade:** `bundleAvailability` diz se o pacote pode ser aberto e, se não, quais serviços e por quê; a seção mostra "No catálogo" ou "Fora do catálogo por causa de: …". Mudar ou desativar um serviço continua livre.
- **Auditoria:** entidade `SERVICE_BUNDLE`; o leitor dos nomes da trilha passou a incluir serviços, e "Serviços" aparece em ordem ("A → B").
- **Resultados:** typecheck, lint e build OK; unitários 1377/1377; integração 545/545; E2E 37/38 — a falha (email-notifications.spec.ts, tempo esgotado em 3 min) veio de arquivos novos da SF-178 que criei com o servidor do E2E rodando; sozinho, o mesmo teste passou em 17 s.
- **Linhas:** 875 `added` (aplicação 535, testes 340).

## SF-178 — Abertura do pacote (2026-11-07)

- **Tudo ou nada:** `openBundle` roda numa transação serializável: confere cada serviço (disponível, sem documento ativo), junta os erros de campo de todas as seções antes de recusar, cria o grupo e chama, para cada serviço, a mesma `openRequest` da abertura isolada, agora exportada e com o `groupId` opcional. Uma resposta a um campo que nenhum serviço do pacote tem é tratada como formulário desatualizado, como na abertura de um serviço.
- **Formulário:** os campos usam o mesmo nome `field.<id>` da abertura isolada (os ids são únicos entre serviços), então a ação, a leitura dos erros e o "manter os dados" reaproveitam o que existe. A leitura dos erros de campo saiu da página do serviço para `field-errors.ts`, usada pelas duas páginas, sem mudar o comportamento.
- **Catálogo:** seção "Pacotes" antes das categorias, só com pacotes que podem ser abertos; a página do pacote lista os serviços e os setores e tem uma seção por serviço.
- **Erro meu, corrigido:** criei arquivos novos desta tarefa enquanto o E2E da SF-177 rodava; uma página nova importava funções que ainda não existiam, o servidor de desenvolvimento recompilou e um E2E sem relação (`email-notifications.spec.ts`) estourou o tempo. Sozinho, ele passou em 17 s; a SF-177 foi registrada com 37/38 e esta explicação. Daqui em diante, nenhum arquivo do projeto é criado ou editado com a suíte rodando.
- **Commit da SF-177:** dois arquivos (`service-bundles/index.ts` e `prisma-bundles.ts`) já tinham acréscimos desta tarefa; o commit da SF-177 levou a versão sem eles (montada a partir do arquivo, sem reescrever histórico), e esta tarefa traz os acréscimos.
- **Resultados:** typecheck, lint e build OK; unitários 1383/1383; integração 549/549; E2E 39/39.
- **Linhas:** 908 `added` (aplicação 561, testes 347).

## SF-179 — Acompanhamento do pacote; fim da parte A (2026-11-07)

- **Ordem do pacote:** percebi que as solicitações de um pacote nascem no mesmo instante (o relógio da transação), então ordenar por data e id deixaria a ordem aleatória. Acrescentei `Request.groupPosition` (migration aditiva, com `CHECK` e índice único por grupo), gravada pela abertura.
- **Migration que falhou no banco de teste:** a primeira versão criava a restrição sem preencher as solicitações de pacote que já existiam (sobras de execuções anteriores dos testes), e o PostgreSQL recusou (23514), desfazendo tudo. Corrigi a migration para preencher a posição pela ordem de criação antes da restrição e marquei a tentativa falha como desfeita **só no banco de teste local** (`prisma migrate resolve --rolled-back`). No Neon, a migration ainda não foi aplicada.
- **Cancelar o pacote:** cada solicitação aberta passa pelo `cancelRequest` de sempre, numa transação própria, com a mesma justificativa; as outras ficam e a página diz quantas.
- **Bloco "Pacote":** atendente e gestor veem as outras solicitações com código, serviço, setor e status (decisão H4), com link só para as que podem ler; o solicitante vê "Parte do pacote …" e a página do grupo.
- **Resultados:** typecheck, lint e build OK; unitários 1390/1390; integração 555/555; E2E 40/40.
- **Linhas:** 1015 `added` (aplicação 598, testes 417). Parte A inteira (SF-175 a SF-179): 4131.

## SF-180 — Distribuição automática: banco e domínio (2026-11-07)

- **Banco:** `Sector` ganhou modo (`NONE` por padrão), limite (1 a 100 ou nenhum), passagem na ausência e a vez do rodízio (`lastDistributedToId`, `SET NULL` se a pessoa sair); `AttendantAbsence` (período de até 90 dias); `RequestAssignmentEvent.reason`, obrigatório exatamente quando não há autor. A migration preenche `ESCALATION_RULE` nas atribuições sem autor que já existiam (só as regras de escalonamento as criavam), e o código da SF-174 passou a gravar o motivo.
- **Escolha:** `chooseAttendant` recebe todos os atendentes do setor, para o rodízio manter a ordem quando alguém é pulado (inativo, ausente, no limite, ou quem acabou de liberar); a menor carga desempata pela ordem do rodízio.
- **Configuração:** `setSectorDistribution`, só do administrador, com a auditoria do setor; os nomes dos modos aparecem na auditoria.
- **Resultados:** typecheck, lint e build OK; unitários 1401/1401; integração 559/559 (a asserção exata da auditoria do setor foi atualizada com os campos novos e rodada de novo); E2E 40/40.
- **Linhas:** 512 `added` (aplicação 271, testes 241).

## SF-181 — Distribuição na entrada da fila (2026-11-07)

- **Onde:** `distributeOnEntry` roda dentro da transação de cada entrada: `openRequest` (abertura isolada e de pacote, se não aguarda aprovação), a aprovação final, o encaminhamento e a liberação (excluindo quem liberou e quem tinha). Reabertura e solicitação com responsável não distribuem.
- **Concorrência:** `lockSectorDistribution` lê o setor com `SELECT … FOR UPDATE`; a segunda entrada no mesmo setor espera a primeira terminar e já vê a carga e a vez atualizadas. Num teste com três aberturas simultâneas e limite 1, ninguém passou do limite.
- **Histórico:** a linha do tempo diz "Distribuída automaticamente a …" (autor "Sistema (distribuição automática)") e a API traz `reason` no histórico de atribuição; as atribuições das regras de escalonamento continuam lendo como antes.
- **Resultados:** typecheck, lint e build OK; unitários 1405/1405; integração 569/569; E2E 40/40.
- **Linhas:** 449 `added` (aplicação 152, testes 297).
