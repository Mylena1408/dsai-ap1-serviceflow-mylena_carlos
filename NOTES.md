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
