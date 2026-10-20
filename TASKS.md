# TASKS — Primeira entrega do ServiceFlow

**Entrega:** Catálogo configurável e ciclo básico de solicitações  
**SPEC principal:** `SPEC/2026-09-30-catalogo-e-solicitacoes.md`  
**SPEC de contexto:** `SPEC/2026-09-30-visao-geral.md`  
**Estado:** SF-001 a SF-025 concluídas; SF-026 incompleta (8.903/100.000 linhas em medição oficial de 2026-10-06); SF-027 concluída após validação dos procedimentos documentados; SF-028 revisada, mas não concluída por dependência incompleta; SF-029 implementada e testada manualmente, com suite automatizada de integração pendente. SF-030 a SF-036 (documentos exigidos por serviço, alteração de SPEC de 2026-10-16) registradas; SF-030 com decisão técnica concluída e provisionamento pendente; SF-031 concluída em 2026-10-20 (migration aplicada e integração aprovada em banco de teste PostgreSQL 17.11 local); SF-033 implementada e validada em testes unitários (2026-10-19), não concluída: adaptador real sem teste contra bucket e critérios do fluxo dependentes da SF-034/SF-035; SF-032 concluída em 2026-10-20 (integração aprovada no mesmo banco de teste); SF-034 a SF-036 não iniciadas.

## Regras de execução

- Executar na ordem de dependência indicada. Uma tarefa só começa após suas dependências estarem concluídas e verificadas.
- A SPEC principal é a fonte de verdade. Se uma tarefa parecer exigir regra ou comportamento não descrito nela, parar e pedir atualização/aprovação de SPEC antes de implementar.
- Cada tarefa deve ser implementada, testada e revisada separadamente. Não declarar testes executados sem executá-los.
- Não adicionar funcionalidade fora do escopo, dependências sem necessidade, segredos ou credenciais versionadas.
- Registrar decisões relevantes em `NOTES.md`, prompt/sessão em `prompts/sessoes/` e andamento em `diario/`, conforme `AGENTS.md`.
- Não criar dados de setores ou serviços específicos como configuração obrigatória de produção. Fixtures genéricas são permitidas somente em testes.
- A meta de linhas descrita na tarefa `SF-026` é requisito da AP1, não autorização para duplicação, boilerplate artificial, código gerado ou ampliação de escopo.

## Tarefas

### SF-001 — Inicializar scaffold Next.js e TypeScript

- **Objetivo:** Criar a aplicação web inicial com App Router, TypeScript, `src/`, scripts de desenvolvimento/build/lint e aliases consistentes.
- **Arquivos/módulos esperados:** `package.json`, lockfile, `tsconfig.json`, configuração Next.js/lint, `src/app/layout.tsx`, `src/app/page.tsx`, `src/shared/`.
- **Dependências:** Nenhuma.
- **Critérios de conclusão:** Aplicação inicia em desenvolvimento e compila; TypeScript e lint passam; versões de runtime e comandos básicos ficam registradas no README; nenhum segredo é versionado.
- **Testes relacionados:** Verificações iniciais de build, typecheck e lint.
- **SPEC:** `SPEC/2026-09-30-catalogo-e-solicitacoes.md` seções 4 e 17; `SPEC/2026-09-30-visao-geral.md` seção 16.

### SF-002 — Configurar variáveis de ambiente e PostgreSQL

- **Objetivo:** Preparar configuração segura e reproduzível para conexão PostgreSQL local, de teste e de execução.
- **Arquivos/módulos esperados:** `.env.example` sem credenciais, validação de ambiente em `src/server/config/`, instruções de banco no README e configuração de conexão.
- **Dependências:** SF-001.
- **Critérios de conclusão:** Aplicação valida variáveis obrigatórias; URL não fica hardcoded; `.env` real fica ignorado pelo Git; conexão funciona com PostgreSQL configurado; instruções não pressupõem instalação de Docker.
- **Testes relacionados:** Teste de validação de configuração presente/ausente e smoke check da conexão.
- **SPEC:** Seção 18; referência técnica da seção 17 da SPEC principal.

### SF-003 — Configurar Prisma e convenções do banco

- **Objetivo:** Integrar Prisma ao PostgreSQL e estabelecer convenções iniciais de nomes, UUID e timestamps UTC.
- **Arquivos/módulos esperados:** `prisma/schema.prisma`, `src/server/db/`, scripts de Prisma no `package.json`.
- **Dependências:** SF-002.
- **Critérios de conclusão:** Prisma gera client tipado e conecta ao banco; scripts de desenvolvimento e deploy de migrations são distintos e documentados; client não é usado diretamente por componentes client-side.
- **Testes relacionados:** Geração do Prisma Client e smoke check de conexão.
- **SPEC:** Seções 6, 17 e 18 da SPEC principal.

### SF-004 — Modelar entidades e restrições relacionais

- **Objetivo:** Definir `User`, `Sector`, `Category`, `Service`, `Request` e `RequestStatusEvent`, com enums e relações da SPEC.
- **Arquivos/módulos esperados:** `prisma/schema.prisma`; eventual SQL de suporte em `prisma/migrations/` para restrições não expressáveis diretamente no schema.
- **Dependências:** SF-003.
- **Critérios de conclusão:** Campos mínimos, nulabilidade, relações, restrições únicas e índices refletem a seção 6; atendentes exigem setor e outros perfis não têm setor; solicitações e eventos não podem ser apagados em cascata; snapshots são campos próprios.
- **Testes relacionados:** Validação/generação do schema e testes de integração de chaves estrangeiras, unicidade e restrições.
- **SPEC:** Seções 6, 7, 12, 13 e 14 da SPEC principal.

### SF-005 — Criar e validar migrations

- **Estado:** Concluída em 2026-10-05; migration inicial aplicada e schema verificado no banco de projeto.

- **Objetivo:** Versionar a criação do schema e validar instalação e reconstrução a partir de banco vazio.
- **Arquivos/módulos esperados:** `prisma/migrations/`, scripts de migration, configuração de CI ou instruções locais.
- **Dependências:** SF-004.
- **Critérios de conclusão:** Migration inicial aplica em PostgreSQL vazio; schema pode ser recriado do início; regras que dependem de SQL manual estão verificadas; migrations aplicadas não são editadas retroativamente.
- **Testes relacionados:** Aplicação de migration em banco limpo e verificação de integridade após aplicação.
- **SPEC:** Seções 6, 12, 16 e 18 da SPEC principal.

### SF-006 — Preparar infraestrutura de testes

- **Estado:** Concluída em 2026-10-05; suites separadas, banco PostgreSQL de teste isolado e smoke checks aprovados.

- **Objetivo:** Configurar Vitest, ambiente PostgreSQL isolado para integração e Playwright, sem misturar dados de teste com desenvolvimento/produção.
- **Arquivos/módulos esperados:** configuração Vitest/Playwright, `tests/unit/`, `tests/integration/`, `tests/e2e/`, fixtures e scripts de teste.
- **Dependências:** SF-001, SF-005.
- **Critérios de conclusão:** Suites podem ser executadas separadamente; fixtures são recriáveis e isoladas; falha em setup encerra os testes com erro claro; nenhum teste depende de dados manuais.
- **Testes relacionados:** Testes de smoke do runner unitário, conexão de integração e inicialização do Playwright.
- **SPEC:** Seção 16 da SPEC principal.

### SF-007 — Implementar validação compartilhada e erros de aplicação

- **Estado:** Concluída em 2026-10-05; schemas server-side, erros sanitizados e testes unitários aprovados.

- **Objetivo:** Definir schemas de entrada e tipos de erro usados pelos módulos, com validação efetiva no servidor.
- **Arquivos/módulos esperados:** `src/shared/validation/`, `src/server/errors/`, testes unitários correspondentes.
- **Dependências:** SF-001, SF-006.
- **Critérios de conclusão:** Erros distinguem validação, autenticação, autorização, inexistência, conflito e falha inesperada; respostas não incluem stack ou dados sensíveis; validação de interface não substitui a do servidor.
- **Testes relacionados:** `tests/unit/shared/validation/` e `tests/unit/server/errors/`.
- **SPEC:** Seções 10, 13, 16 e 17 da SPEC principal.

### SF-008 — Implementar autenticação e sessões

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Integrar autenticação local aprovada, armazenamento seguro de credenciais e leitura atual do usuário autenticado no servidor.
- **Arquivos/módulos esperados:** `src/modules/auth/`, endpoint Auth.js em `src/app/api/auth/`, `src/server/auth/`, configuração de cookies e testes.
- **Dependências:** SF-004, SF-005, SF-006, SF-007.
- **Critérios de conclusão:** Login/logout funcionam; somente usuário ativo autentica; senha é validada contra hash Argon2id; cliente não escolhe perfil/setor; perfil e estado usados em autorização vêm do banco atual; política e decisões pendentes de sessão ficam documentadas.
- **Testes relacionados:** Unitários de credenciais; integração para usuário ativo/inativo; testes de cookie/sessão e tentativas inválidas.
- **SPEC:** Seções 3, 7, 10, 17 e 18 da SPEC principal.

### SF-009 — Criar bootstrap seguro do primeiro administrador

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Permitir criar o primeiro administrador em instalação vazia sem credencial padrão ou segredo versionado.
- **Arquivos/módulos esperados:** `scripts/bootstrap-admin.ts` ou módulo equivalente em `src/modules/auth/`, scripts documentados e testes.
- **Dependências:** SF-008.
- **Critérios de conclusão:** Bootstrap solicita ou recebe credencial por canal seguro; armazena somente hash; falha se já existir administrador; não imprime senha; não pode ser executado acidentalmente como seed de produção recorrente.
- **Testes relacionados:** Integração para banco vazio, repetição após bootstrap e validação do hash; inspeção de logs sem segredo.
- **SPEC:** Seções 3.1, 7, 17 e 18 da SPEC principal.

### SF-010 — Implementar autorização central no servidor

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Fornecer verificações server-side para perfil, propriedade de solicitante, setor de atendente e estado ativo.
- **Arquivos/módulos esperados:** `src/server/authorization/`, helpers por domínio e `tests/unit/authorization/`.
- **Dependências:** SF-008, SF-009.
- **Critérios de conclusão:** Cada helper aplica a matriz da seção 10; administrador não tem acesso operacional implícito; IDs de ator/proprietário/setor são derivados de sessão e dados confiáveis; negações não vazam a existência de recursos alheios.
- **Testes relacionados:** Unitários para matriz de perfil/escopo e testes de integração com usuários e setores reais.
- **SPEC:** Seções 3, 7 e 10 da SPEC principal.

### SF-011 — Implementar domínio de setores

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Criar operações administrativas de consulta, criação, edição e desativação lógica de setores.
- **Arquivos/módulos esperados:** `src/modules/sectors/` (repositório, validação, casos de uso); testes unitários e de integração.
- **Dependências:** SF-005, SF-007, SF-010.
- **Critérios de conclusão:** Nome não vazio e único entre ativos; sem exclusão física; desativação rejeitada com atendente ativo, serviço ativo ou solicitação pendente; setor inativo não recebe atendente nem serviço ativo; verificações são transacionais.
- **Testes relacionados:** Unitários de regras; integração para unicidade, restrições, solicitações pendentes e desativação válida.
- **SPEC:** Seções 6.2, 7, 11 e 16 da SPEC principal.

### SF-012 — Implementar domínio de categorias

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Criar operações administrativas de consulta, criação, edição e desativação lógica de categorias.
- **Arquivos/módulos esperados:** `src/modules/categories/`; testes unitários e de integração.
- **Dependências:** SF-005, SF-007, SF-010.
- **Critérios de conclusão:** Nome não vazio e único entre ativas; sem exclusão física; desativação rejeitada enquanto existir serviço ativo associado; categoria inativa não participa de serviço ativo/catalogável.
- **Testes relacionados:** Unitários de validação; integração para unicidade, dependências e ativação/desativação.
- **SPEC:** Seções 6.3, 7, 11 e 16 da SPEC principal.

### SF-013 — Implementar administração de usuários

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Criar operações de administração de usuários, papéis, estado ativo e associação de atendentes a setor.
- **Arquivos/módulos esperados:** `src/modules/users/`; validações e testes.
- **Dependências:** SF-009, SF-010, SF-011, SF-012.
- **Critérios de conclusão:** Perfil é exclusivo; apenas atendente tem setor e requer setor ativo; e-mail é normalizado/único; senha sempre passa pela camada de hash; não se desativa/rebaixa o último administrador; não se muda/desativa o último atendente de setor com solicitações pendentes; usuário inativo mantém referências históricas.
- **Testes relacionados:** Unitários para perfil/e-mail; integração para associação, hash, último administrador e último atendente.
- **SPEC:** Seções 3, 6.1, 7, 10, 11 e 16 da SPEC principal.

### SF-014 — Implementar domínio de serviços

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Criar operações administrativas de serviços com associação obrigatória a categoria e setor.
- **Arquivos/módulos esperados:** `src/modules/services/`; validações e testes.
- **Dependências:** SF-011, SF-012, SF-010.
- **Critérios de conclusão:** Nome/descrição não vazios; categoria e setor existem; ativação requer ambos ativos; desativação impede novas solicitações mas não afeta as existentes; sem exclusão física; edições não alteram snapshots existentes.
- **Testes relacionados:** Unitários de disponibilidade; integração para associações, ativação, desativação e referências existentes.
- **SPEC:** Seções 6.4, 7, 11, 12 e 16 da SPEC principal.

### SF-015 — Implementar interface administrativa

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Disponibilizar telas de administração de usuários, setores, categorias e serviços.
- **Arquivos/módulos esperados:** `src/app/(admin)/admin/`, componentes em `src/shared/components/` e testes dos fluxos de formulário.
- **Dependências:** SF-011, SF-012, SF-013, SF-014.
- **Critérios de conclusão:** Administrador autenticado executa operações permitidas; estados ativo/inativo e erros de dependência são claros; perfis sem permissão não acessam ações; formulários não substituem validações server-side.
- **Testes relacionados:** Testes de integração das Server Actions e casos E2E administrativos em SF-025.
- **SPEC:** Seções 3.1, 4, 10, 11 e 15 da SPEC principal.

### SF-016 — Implementar consulta do catálogo

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Disponibilizar ao solicitante catálogo agrupado/organizado por categoria com detalhe do serviço.
- **Arquivos/módulos esperados:** `src/modules/services/` consultas de catálogo; `src/app/(requester)/catalog/`; testes.
- **Dependências:** SF-012, SF-014, SF-010.
- **Critérios de conclusão:** Catálogo inclui somente serviço, categoria e setor ativos; mostra nome e descrição atuais; consulta requer perfil permitido; dados não são hardcoded.
- **Testes relacionados:** Unitários de filtro de disponibilidade; integração com combinações ativas/inativas; verificação E2E de catálogo.
- **SPEC:** Seções 4, 5, 10, 11 e 15 da SPEC principal; seção 5 da visão geral.

### SF-017 — Implementar criação transacional de solicitações

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Implementar abertura pelo solicitante com validação, snapshots e evento inicial atômicos.
- **Arquivos/módulos esperados:** `src/modules/requests/` comandos/criação, validação e persistência; testes unitários e de integração.
- **Dependências:** SF-004, SF-005, SF-007, SF-010, SF-014.
- **Critérios de conclusão:** Somente solicitante ativo abre para si; serviço/categoria/setor são verificados na transação; descrição não vazia e até 10.000 caracteres; cliente não escolhe IDs protegidos, status, snapshots ou datas; status inicia `OPEN`; snapshots incluem nome/descrição do serviço, ID/nome da categoria e ID/nome do setor; evento inicial usa ator solicitante; solicitação e evento são confirmados/revertidos juntos.
- **Testes relacionados:** Unitários de validação/snapshot; integração para persistência, dados forjados, configuração indisponível e rollback.
- **SPEC:** Seções 6.5, 6.6, 7, 8, 12, 13, 14 e 16 da SPEC principal.

### SF-018 — Implementar consultas de solicitações do solicitante

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Permitir lista e detalhe/histórico somente das solicitações abertas pelo usuário atual.
- **Arquivos/módulos esperados:** `src/modules/requests/` consultas; testes de autorização/integração.
- **Dependências:** SF-010, SF-017.
- **Critérios de conclusão:** Consultas sempre limitam por `requester_id` da sessão; exibem snapshots e histórico; identificador de outra pessoa não revela dados nem existência do recurso.
- **Testes relacionados:** Integração de propriedade; autorização direta por identificador alheio; ordenação dos eventos.
- **SPEC:** Seções 3.2, 6.5, 10, 12 e 14 da SPEC principal.

### SF-019 — Implementar transições e eventos de histórico

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Implementar `OPEN → IN_PROGRESS → COMPLETED`, com histórico append-only e consistência concorrente.
- **Arquivos/módulos esperados:** `src/modules/requests/` máquina de estados/comandos e `RequestStatusEvent`; testes.
- **Dependências:** SF-010, SF-017.
- **Critérios de conclusão:** Atendente ativo do setor é o único autorizado; todas as demais transições são negadas; evento, status e `updated_at` são transacionais; conclusão define `completed_at`; eventos inválidos/repetidos/negados não são criados; concorrência permite no máximo uma transição do mesmo estado.
- **Testes relacionados:** Unitários de matriz de transição; integração de transações, append-only, `completed_at` e corrida concorrente.
- **SPEC:** Seções 7, 8, 9, 10, 12, 14 e 16 da SPEC principal.

### SF-020 — Implementar fila e consultas do atendente

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Listar e detalhar solicitações do setor atual do atendente e expor ações válidas de transição.
- **Arquivos/módulos esperados:** `src/modules/requests/` consultas por setor; testes de autorização.
- **Dependências:** SF-010, SF-017, SF-019.
- **Critérios de conclusão:** Fila deriva setor do usuário atual; inclui solicitações do setor registrado na abertura, inclusive após mudança de configuração do serviço; não oferece atribuição individual; acesso a outro setor é negado.
- **Testes relacionados:** Integração para setor correto/incorreto e serviço migrado de setor; testes de consulta e transição autorizada.
- **SPEC:** Seções 3.3, 6.5, 8, 10, 12 e 15 da SPEC principal.

### SF-021 — Implementar interface do solicitante

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Entregar catálogo, detalhe de serviço, abertura, lista e acompanhamento de solicitações.
- **Arquivos/módulos esperados:** `src/app/(requester)/catalog/`, `src/app/(requester)/requests/`, componentes e testes de interface.
- **Dependências:** SF-016, SF-017, SF-018.
- **Critérios de conclusão:** Solicitante percorre catálogo até abertura e acompanha status/histórico próprio; descrição tem validação e limite; erros e estados vazios são compreensíveis; não há edição de status, comentário ou anexo.
- **Testes relacionados:** Testes de Server Actions e fluxo E2E do solicitante em SF-025.
- **SPEC:** Seções 3.2, 4, 5, 8, 10, 13 e 15 da SPEC principal.

### SF-022 — Implementar interface do atendente

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Entregar fila por setor, detalhes e ações de início/conclusão.
- **Arquivos/módulos esperados:** `src/app/(attendant)/queue/`, páginas de detalhe e componentes.
- **Dependências:** SF-019, SF-020.
- **Critérios de conclusão:** Atendente vê apenas seu setor; ações disponíveis correspondem ao estado; confirma o resultado ou apresenta erro sem habilitar reabertura, cancelamento ou atribuição individual.
- **Testes relacionados:** Testes de Server Actions e fluxo E2E de atendimento em SF-025.
- **SPEC:** Seções 3.3, 8, 9, 10 e 15 da SPEC principal.

### SF-023 — Endurecer autorização e validação de ponta a ponta no servidor

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Verificar sistematicamente que todos os handlers/actions protegidos aplicam autenticação, autorização e validação no servidor.
- **Arquivos/módulos esperados:** `src/server/authorization/`, actions/handlers nos módulos, `tests/integration/authorization/`.
- **Dependências:** SF-010, SF-013 a SF-022.
- **Critérios de conclusão:** Matriz completa da seção 10 passa para leitura e escrita; usuário inativo é bloqueado; ataques de mass assignment/IDs forjados são rejeitados; falhas não vazam dados de terceiros.
- **Testes relacionados:** Suite de autorização para cada perfil, setor, propriedade, estado ativo e campo protegido.
- **SPEC:** Seções 7, 10, 13, 15 e 16 da SPEC principal.

### SF-024 — Completar testes automatizados de unidade e integração

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Cobrir critérios de aceitação ainda não exercitados pelas suites específicas dos módulos.
- **Arquivos/módulos esperados:** `tests/unit/`, `tests/integration/`, fixtures e scripts de execução.
- **Dependências:** SF-006, SF-011 a SF-023.
- **Critérios de conclusão:** Regras de domínio, relações, desativações, snapshots, eventos, transações, concorrência, acesso por propriedade/setor e proteção contra remoção têm testes automatizados; nenhum erro é ignorado.
- **Testes relacionados:** Suites completas Vitest unitária e PostgreSQL de integração.
- **SPEC:** Seções 7 a 16 da SPEC principal.

### SF-025 — Implementar e executar testes E2E com Playwright

- **Estado:** Concluída e validada em 2026-10-05.
- **Objetivo:** Validar os fluxos web completos dos três perfis e negações críticas.
- **Arquivos/módulos esperados:** `tests/e2e/`, configuração Playwright, fixtures/bootstrap de teste e scripts.
- **Dependências:** SF-015, SF-016, SF-018 a SF-024.
- **Critérios de conclusão:** Fluxo automatizado cobre bootstrap/login, configuração administrativa, catálogo, abertura, consulta própria, atendimento e conclusão; testa solicitante alheio e atendente de outro setor; executa contra ambiente de teste isolado.
- **Testes relacionados:** Playwright em navegador para fluxos autorizados e proibidos.
- **SPEC:** Seções 8 a 16 da SPEC principal.

### SF-026 — Verificar meta de código da AP1 com cloc

- **Andamento (2026-10-06):** Implementadas as quatro correções pontuais identificadas na auditoria da SPEC: índices por solicitante/setor, `CHECK` PostgreSQL para consistência perfil/setor e cobertura dos dois fluxos de atendimento. A medição oficial com o comando cloc definido é **8.903** linhas contabilizáveis de 100.000 (diferença: **91.097**). SF-026 permanece incompleta; não houve inflação artificial de código e não se deve ampliar escopo para perseguir a meta.
- **Objetivo:** Medir e cumprir o requisito do projeto de pelo menos 100.000 linhas de código contabilizadas com `cloc`.
- **Arquivos/módulos esperados:** Código funcional em `src/`, testes reais em `tests/` e configuração de exclusões/comando de medição; registrar resultado no relatório de revisão, não contar a documentação.
- **Dependências:** SF-024, SF-025.
- **Critérios de conclusão:** Contagem final é de no mínimo 100.000 linhas, incluindo somente código funcional e testes automatizados reais pertencentes ao projeto. Excluir dependências (`node_modules` e equivalentes), build/cache/cobertura, dados/fixtures não executáveis e documentação. Revisar idiomas e caminhos contados. É proibido atingir a meta por linhas artificiais, duplicação, código sem função, geração em massa ou funcionalidades fora da SPEC. Se a contagem ficar abaixo do limite, não inflar o código: identificar lacunas reais dentro da SPEC e encaminhar qualquer necessidade de escopo adicional para aprovação explícita.
- **Testes relacionados:** Comando `cloc` reproduzível e revisado; todas as suites funcionais permanecem aprovadas, sem testes artificiais criados apenas para aumentar contagem.
- **SPEC:** Restrição acadêmica da AP1 registrada neste TASKS; escopo funcional permanece fundamentado nas seções 4, 5, 15 e 19 da SPEC principal.

### SF-027 — Documentar operação e manter registros do projeto

- **Estado:** Concluída em 2026-10-05 — procedimentos verificados após `npm ci`, com Prisma Client gerado; testes, typecheck, lint, build e estado de migrations do banco de teste passaram.
- **Objetivo:** Documentar setup, variáveis necessárias sem valores secretos, migrations, bootstrap, execução de testes e decisões técnicas.
- **Arquivos/módulos esperados:** `README.md`, `NOTES.md`, entrada em `prompts/sessoes/` e diário em `diario/`.
- **Dependências:** SF-001 a SF-026.
- **Critérios de conclusão:** Uma pessoa consegue configurar ambiente e executar aplicação/testes seguindo o README; decisões relevantes e limitações estão em NOTES; prompt/sessão e diário refletem o trabalho; nenhum segredo foi documentado.
- **Testes relacionados:** `npm ci` (via `npm.cmd` no PowerShell), `npx prisma generate`, `npx prisma validate`, estado de migrations de `serviceflow_test`, `npm run test:unit` (73), `npm run test:integration` (61), `npm run test:e2e` (1), `npm run typecheck`, `npm run lint` e `npm run build`; todos passaram. O README foi ajustado para documentar a geração inicial do Prisma Client e os launchers `.cmd` no PowerShell quando necessário.
- **SPEC:** Regras 12 a 14 e Qualidade em `AGENTS.md`; seções 17 e 18 da SPEC principal.

### SF-028 — Fazer revisão final da entrega

- **Estado:** Revisão executada em 2026-10-05, mas não concluída: SF-026 permanece incompleta (dependência desta tarefa). A medição oficial foi reproduzida em 2026-10-06 e totalizou 8.903 linhas; continua pendente a política operacional de backup/recuperação e seu teste de restauração.
- **Objetivo:** Confirmar escopo, qualidade, segurança básica, documentação, testes e estado do repositório antes da conclusão.
- **Arquivos/módulos esperados:** Nenhum arquivo de funcionalidade por padrão; relatório de revisão/diário se exigido pelo processo.
- **Dependências:** SF-024 a SF-027.
- **Critérios de conclusão:** Todos os critérios de aceitação aplicáveis da SPEC foram verificados; lint, typecheck, build, unitários, integração e E2E passam; diff revisado; contagem cloc revisada; ausência de segredos confirmada; alterações correspondem às SPECs; `git status` e arquivos alterados foram revisados; falhas ou itens não verificados estão explicitamente registrados. Não criar commit sem solicitação explícita.
- **Testes relacionados:** Na revisão de 2026-10-05 passaram `npm run test:unit` (73), `npm run test:integration` (61), `npm run test:e2e` (1), typecheck, lint, build, Prisma validate e migrations da base isolada (`serviceflow_test`, quatro aplicadas, nenhuma pendente). Em 2026-10-06, cloc foi executado com o comando oficial: 8.903 linhas contabilizáveis. A limitação de disponibilidade do executável, registrada durante a revisão anterior, foi superada.
- **SPEC:** `AGENTS.md`; todas as seções aplicáveis da SPEC principal e a visão geral como contexto.

### SF-029 — Implementar autogerenciamento da própria senha

- **Estado:** Implementada e testada manualmente com sucesso em 2026-10-06; validação automatizada de integração bloqueada pelo ambiente (falha de `prisma generate` com `EPERM` e indisponibilidade de conexão ao `TEST_DATABASE_URL`). Não marcar concluída até executar com sucesso a suite PostgreSQL de teste.
- **Objetivo:** Permitir que qualquer usuário ativo e autenticado altere somente a própria senha, conforme a alteração aprovada em 2026-10-06 na seção 20 da SPEC principal.
- **Arquivos/módulos esperados:** `src/modules/auth/`, `src/shared/validation/`, `src/app/account/password/`, navegação autenticada, `tests/unit/` e `tests/integration/`.
- **Dependências:** SF-008 e SF-010.
- **Critérios de conclusão:** Os três perfis podem alterar a própria senha após validar a atual; nova senha tem pelo menos 12 caracteres e confirmação idêntica; servidor obtém a conta exclusivamente da sessão e recusa `userId`/campos extras; somente hash Argon2id é persistido; erros não expõem credenciais; sessão continua autenticada; falhas de validação não alteram hash; a nova senha autentica em login posterior.
- **Testes relacionados:** Testes unitários de schema/Server Action; integração PostgreSQL real para ADMIN/REQUESTER/ATTENDANT, senha atual incorreta, regra de 12 caracteres, confirmação, ID forjado, hash persistido, sessão ativa e autenticação subsequente. Unitários (79), typecheck, lint e build passaram; integração ainda não validada devido a bloqueios registrados em NOTES.md. Os testes E2E têm 1 cenário, aprovado na execução anterior à SF-029 e não reexecutado nesta etapa.
- **SPEC:** `SPEC/2026-09-30-catalogo-e-solicitacoes.md`, seções 3, 4, 7, 15, 16 e 20.

## Documentos exigidos por serviço — alteração de SPEC de 2026-10-16

Tarefas derivadas da seção 21 da SPEC principal. Anexos estavam fora do escopo inicial; a alteração de 2026-10-16 passa a autorizá-los somente no recorte da seção 21. Nenhuma destas tarefas foi iniciada. Os critérios `CA-DOC-xx` citados estão na seção 21.12.

### SF-030 — Confirmar e preparar armazenamento privado de documentos

- **Estado:** Parcialmente concluída em 2026-10-16. **Concluído:** verificação na documentação oficial da Vercel, do Supabase e do Next.js; confirmação do bucket privado do Supabase Storage; limites mantidos com cálculo de margem; `bodySizeLimit` definido; fluxos de upload, compensação e download; nomes de buckets e variáveis definidos (SPEC 21.15). **Pendente (ação do responsável pelas contas Supabase/Vercel):** criar os buckets privados por ambiente, com produção em projeto Supabase exclusivo; gerar chaves secretas `sb_secret_` dedicadas; cadastrar as variáveis na Vercel e nos ambientes locais; testar que a leitura anônima do bucket é negada. Nesta etapa não foram criados credenciais, buckets ou variáveis, nem alterados os arquivos `.env*.example`, por restrição explícita da sessão.
- **Observação de dependência:** a SF-031 (schema) depende apenas da decisão técnica, já concluída. O provisionamento pendente bloqueia somente os testes do adaptador real (SF-033) e o uso em ambientes reais (SF-034 em diante).
- **Objetivo:** Confirmar o provedor recomendado (bucket privado do Supabase Storage) ou registrar a alternativa escolhida; criar buckets privados separados para desenvolvimento, teste e produção; definir nomes de variáveis de ambiente server-side; reconfirmar na documentação vigente do Vercel os limites de corpo de requisição/resposta usados na seção 21.6.
- **Arquivos/módulos esperados:** `.env.example`/`.env.test.example` apenas com nomes de variáveis e valores vazios, README (configuração), `NOTES.md`.
- **Dependências:** Aprovação da seção 21 da SPEC.
- **Critérios de conclusão:** Buckets não públicos; credencial somente em variáveis de ambiente fora do repositório e sem prefixo `NEXT_PUBLIC_`; ambiente de teste isolado da produção; decisão e limites confirmados registrados em `NOTES.md`; nenhuma dependência adicionada sem justificativa registrada. Atende CA-DOC-21.
- **Testes relacionados:** Verificação manual documentada de que leitura anônima do bucket é negada (pendente); scan de segredos antes do commit. Na etapa de 2026-10-16 nenhum teste automatizado foi executado, por ser etapa sem código.
- **SPEC:** Seções 21.6, 21.8, 21.14 e 21.15.

### SF-031 — Modelar requisitos documentais e anexos

- **Estado:** **Concluída em 2026-10-20.** Implementada em 2026-10-16. Em 2026-10-20 a migration `20261016120000_document_requirements_and_attachments` foi aplicada pelo `migrate deploy` do setup de integração no banco de teste local `serviceflow_test` (PostgreSQL 17.11, mesma versão da produção, locale ICU `en-US`), e `tests/integration/document-schema.test.ts` passou (10/10). Nenhum banco de desenvolvimento ou produção foi usado; a migration **ainda não foi aplicada no banco principal** (passo separado, aguardando autorização).
- **Objetivo:** Criar `ServiceDocumentRequirement` e `RequestAttachment` com relações, unicidade `(request_id, requirement_id)`, unicidade case-insensitive de nome entre requisitos ativos do mesmo serviço e restrições que impeçam exclusão física de registros referenciados.
- **Arquivos/módulos esperados:** `prisma/schema.prisma`, nova migration aditiva em `prisma/migrations/`.
- **Dependências:** SF-030.
- **Critérios de conclusão:** Migration aditiva aplicada no banco de teste sem alterar dados existentes; nenhuma linha de setor, serviço ou requisito criada pela migration (CA-DOC-04); campos de metadados completos conforme seção 21.9.
- **Testes relacionados:** `prisma validate`; integração de restrições relacionais e unicidade. Criados `tests/integration/document-schema.test.ts` (10 casos: metadados, unicidade parcial case-insensitive, CHECKs, FKs inexistentes, exclusão física bloqueada e preservação após editar/desativar requisito e serviço — 10 aprovados em 2026-10-20; o registro anterior citava 11 casos, mas o arquivo tem 10) e `tests/unit/prisma/migrations.test.ts` (2 casos: nenhuma migration insere dados; migration nova é aditiva — aprovados). `tests/integration/fixtures.ts` passou a limpar anexos e requisitos antes das tabelas referenciadas.
- **SPEC:** Seção 21.9.

### SF-032 — Implementar configuração de requisitos documentais por serviço

- **Estado:** **Concluída em 2026-10-20.** Implementada em 2026-10-19: módulo `src/modules/document-requirements/` (criar, editar, Subir/Descer e desativar, somente ADMIN, em transação serializável), esquema de entrada em `src/shared/validation/`, Server Actions e bloco "Documentos exigidos" em cada serviço do painel administrativo. Em 2026-10-20, `tests/integration/document-requirements.test.ts` passou (16/16) no banco de teste local PostgreSQL 17.11 com ICU `en-US`, comprovando CA-DOC-01 a 03; CA-DOC-04 tem cobertura unitária em `tests/unit/prisma/migrations.test.ts`. Decisões aprovadas: sem reativação (não prevista na SPEC); inativos exibidos como histórico, sem editar ou mover; configuração permitida em serviço inativo; Subir no primeiro e Descer no último sem efeito e sem erro, com os botões ocultos.
- **Objetivo:** Operações administrativas server-side e interface no painel de serviços para criar, editar, reordenar e desativar requisitos (nome, obrigatoriedade, formatos aceitos), com limite de 5 ativos por serviço.
- **Arquivos/módulos esperados:** `src/modules/services/` (ou módulo dedicado), `src/shared/validation/`, `src/app/(admin)/admin/`, `tests/unit/`, `tests/integration/`.
- **Dependências:** SF-031, SF-010, SF-014.
- **Critérios de conclusão:** CA-DOC-01, CA-DOC-02, CA-DOC-03 e CA-DOC-04.
- **Testes relacionados:** Unitários de validação; integração de CRUD, unicidade, limite e autorização por perfil. Criados em 2026-10-19: `tests/unit/modules/document-requirements/policy.test.ts` (20 casos) e 5 casos novos em `tests/unit/admin-actions.test.ts`, aprovados; `tests/integration/document-requirements.test.ts` (16 casos), aprovados em 2026-10-20. Resultado em 2026-10-20: integração 26/26 (SF-031 + SF-032) e `referential-integrity.test.ts` 3/3; `npm run test:unit` 174 aprovados (26 arquivos); lint, typecheck, build e `prisma validate` aprovados.
- **SPEC:** Seções 21.2 e 21.3.

### SF-033 — Implementar validação de arquivos e adaptador de armazenamento

- **Estado:** Implementada em 2026-10-19 e validada em testes unitários; **não concluída**. **Concluído:** detecção do tipo real, limites, sanitização (nome acima de 255 caracteres é rejeitado, não truncado), SHA-256, chave opaca, adaptador em memória e adaptador HTTP do Supabase Storage com `fetch` simulado, configuração por variáveis com recusa de bucket de teste sem sufixo `-test`, erros fixos sem nome, conteúdo, chave ou credencial. **Pendente:** (a) testar o adaptador real contra um bucket `-test` provisionado (depende do provisionamento da SF-030); (b) CA-DOC-09, CA-DOC-11 e CA-DOC-20 só ficam comprovados "no servidor" quando as funções forem usadas pela Server Action de abertura (SF-034) e pela rota de download (SF-035).
- **Objetivo:** Detecção do tipo real (PDF, DOCX sem macros, TXT UTF-8), limites de tamanho/quantidade, sanitização de nome, cálculo de SHA-256, geração de chave opaca e adaptador de armazenamento (real e de teste) com mensagens de erro fixas e sem registro de conteúdo, nome original ou chave em logs.
- **Arquivos/módulos esperados:** módulo server-side de anexos em `src/modules/` e `src/server/`, `tests/unit/` com fixtures sintéticas geradas nos testes.
- **Dependências:** SF-030.
- **Critérios de conclusão:** CA-DOC-09, CA-DOC-10, CA-DOC-11, CA-DOC-20 e CA-DOC-22.
- **Testes relacionados:** Unitários de assinaturas, DOCX com macros, ZIP não DOCX, TXT inválido, extensão divergente, limites, sanitização e mensagens sem dados sensíveis. Criados em 2026-10-19: `tests/unit/modules/attachments/file-type.test.ts`, `tests/unit/modules/attachments/policy.test.ts` e `tests/unit/server/storage/storage.test.ts` (68 casos novos), com fixtures sintéticas geradas em memória por `tests/unit/modules/attachments/synthetic-files.ts`. Resultado: `npm run test:unit` 149 aprovados (25 arquivos); lint, typecheck e build aprovados.
- **SPEC:** Seções 21.6, 21.7, 21.8 e 21.10.

### SF-034 — Implementar abertura de solicitação com documentos

- **Estado:** Não iniciada.
- **Objetivo:** Exibir os documentos solicitados no detalhe do serviço; aceitar um arquivo por requisito; validar no servidor com a configuração vigente; gravar objetos, criar solicitação, evento inicial e anexos atomicamente, com compensação em falha. Manter inalterado o fluxo de serviços sem requisitos. Ajustar o limite de corpo das Server Actions de forma compatível com a seção 21.6.
- **Arquivos/módulos esperados:** `src/modules/requests/`, `src/app/(requester)/catalog/[serviceId]/`, `src/app/(requester)/requests/actions.ts`, `next.config.ts`, `tests/unit/`, `tests/integration/`.
- **Dependências:** SF-032, SF-033, SF-017.
- **Critérios de conclusão:** CA-DOC-05, CA-DOC-06, CA-DOC-07, CA-DOC-08, CA-DOC-12 e CA-DOC-13.
- **Testes relacionados:** Integração de abertura com e sem requisitos, obrigatórios ausentes, requisito de outro serviço/inativo, duplicidade, rejeição sem persistência, compensação e campos forjados pelo cliente.
- **SPEC:** Seção 21.4.

### SF-035 — Implementar consulta e download autorizados de anexos

- **Estado:** Não iniciada.
- **Objetivo:** Listar metadados dos anexos no detalhe da solicitação (solicitante e atendente) e servir o download por rota autorizada server-side, sem URL pública ou permanente e com os cabeçalhos definidos.
- **Arquivos/módulos esperados:** `src/server/authorization/`, rota de download em `src/app/`, páginas de detalhe do solicitante e do atendente, `tests/unit/`, `tests/integration/`.
- **Dependências:** SF-034, SF-018, SF-020.
- **Critérios de conclusão:** CA-DOC-14, CA-DOC-15, CA-DOC-16, CA-DOC-17, CA-DOC-18 e CA-DOC-19.
- **Testes relacionados:** Autorização por perfil, setor (inclusive após mudança de setor), propriedade, inativo e não autenticado; anexo de outra solicitação; integridade por SHA-256; cabeçalhos; preservação após editar/desativar requisito, serviço, categoria e setor.
- **SPEC:** Seções 21.5 e 21.11.

### SF-036 — Testes E2E e revisão da funcionalidade de documentos

- **Estado:** Não iniciada.
- **Objetivo:** Cobrir no navegador o percurso da seção 21.13 e revisar escopo, segurança, segredos, logs, fixtures e documentação (README, NOTES, diário, sessões).
- **Arquivos/módulos esperados:** `tests/e2e/`, README, `NOTES.md`, `diario/`, `prompts/sessoes/`.
- **Dependências:** SF-035.
- **Critérios de conclusão:** Todos os CA-DOC-01 a CA-DOC-22 verificados e registrados; suites unitária, integração e E2E, typecheck, lint e build executadas com resultados reais registrados.
- **Testes relacionados:** E2E do administrador, solicitante e atendente; negação de acesso direto por usuário não autorizado.
- **SPEC:** Seções 21.12 e 21.13.
