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
