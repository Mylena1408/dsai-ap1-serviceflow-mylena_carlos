# SPEC — Aprovações com o perfil Gestor

**Data:** 2026-11-01
**Status:** Aprovada em 2026-11-01, com as decisões A1 a A4 da seção 11 conforme propostas.
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-visao-geral.md` (§3.3 Gestor; §4 "necessidade ou não de aprovação"; §8 Aprovação), `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seções 3, 5, 9, 10 e 19), `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md`, `SPEC/2026-10-31-eventos-outbox-jobs.md`, `SPEC/2026-11-01-sla-prioridades.md`, `SPEC/2026-11-01-fluxos-configuraveis.md`, `SPEC/2026-10-29-plano-escala-100k.md` (item 8 e garantia 7.4)

## 1. Objetivo

Permitir que um serviço **exija aprovação** antes do atendimento. Um novo perfil, o **Gestor**, ligado a um setor, aprova ou rejeita as solicitações desses serviços. A decisão registra quem decidiu, quando, a decisão e a observação (visão geral, §8), e muda o andamento da solicitação.

## 2. Registro da mudança de escopo

A SPEC principal tem só três perfis (Administrador, Solicitante e Atendente, seção 3) e deixou aprovações e o perfil Gestor para SPECs futuras (seções 5 e 19). O item 8 do plano de escala foi aceito em 2026-10-29, condicionado a esta SPEC. Pela garantia 7.4 do plano, **um serviço sem aprovação se comporta exatamente como hoje**.

A SPEC de fluxos (seção 9) deixou para esta SPEC decidir como a aprovação se relaciona com as etapas. Aqui, a aprovação acontece **antes** do início do atendimento **(decisão A1)**; as etapas continuam existindo só dentro de "Em atendimento".

## 3. Escopo

1. Novo perfil **Gestor** (`MANAGER`), sempre ligado a um setor, cadastrado pelo administrador; conta de demonstração.
2. Configuração "exige aprovação" por serviço, pelo administrador.
3. Abertura de solicitação com aprovação pendente e bloqueio do início do atendimento até a aprovação **(decisão A1)**.
4. Decisão do gestor: aprovar (observação opcional) ou rejeitar (observação obrigatória), em um nível **(decisão A2)**.
5. Prazo do SLA a partir da aprovação **(decisão A3)**.
6. Telas do gestor: lista de aprovações do setor e detalhe com a decisão **(decisão A4)**; indicação da aprovação para solicitante e atendente.
7. Eventos e notificações da aprovação.

## 4. Fora de escopo

- Vários níveis ou mais de um aprovador por solicitação (decisão A2).
- Delegação, substituição de gestor ausente ou prazo para aprovar.
- Aprovação por valor, por campo personalizado ou por outra condição.
- Gestor de mais de um setor; gestor que também atende ou solicita (como na SPEC principal, cada conta tem um único perfil).
- Gestor alterando a solicitação (prioridade, etapas, atribuição) ou comentando.
- Relatórios de aprovação (item 11).

## 5. Regras

### 5.1 Perfil Gestor

1. Novo perfil `MANAGER`, exibido como "Gestor". Como o atendente, o gestor **pertence a exatamente um setor**; os outros perfis continuam sem setor.
2. Só o administrador cria, edita e desativa gestores, na mesma tela de usuários.
3. O gestor entra pela mesma tela de login (senha ou demonstração) e vai para a sua área: "Aprovações".
4. O gestor **não** abre solicitações, não atende, não acessa a área administrativa e não comenta.
5. O modo de demonstração ganha a conta "Gestor (demonstração)", no setor de demonstração.

### 5.2 Configuração no serviço

1. O serviço ganha a opção "Exige aprovação do gestor" (padrão: não), configurada só pelo administrador.
2. Na abertura, a solicitação **guarda se exige aprovação** (snapshot). Mudar o serviço depois não altera solicitações existentes.

### 5.3 Aprovação antes do atendimento **(decisão A1)**

1. Uma solicitação que exige aprovação nasce "Aberta" com a **aprovação pendente**. O status continua o mesmo de hoje; a aprovação é uma situação à parte, com os valores *pendente*, *aprovada* e *rejeitada*.
2. Enquanto a aprovação estiver pendente, **ninguém inicia o atendimento**: a ação é recusada no servidor e o botão não aparece. Assumir, transferir, mudar a prioridade e comentar continuam permitidos.
3. **Aprovar:** a aprovação passa a *aprovada* e a solicitação segue como qualquer outra (pode ser iniciada).
4. **Rejeitar:** a aprovação passa a *rejeitada* e, na mesma transação, a solicitação é **cancelada**, com a observação do gestor como justificativa no histórico. Sem caminho de volta: a solicitação cancelada não é reaberta (regra atual).
5. O solicitante ainda pode cancelar a própria solicitação "Aberta" com aprovação pendente (regra atual).
6. A reabertura de uma solicitação concluída **não** pede nova aprovação.

### 5.4 Quem decide **(decisão A2)**

1. Um nível: qualquer **gestor ativo do setor da solicitação** decide, uma única vez. A primeira decisão vale; uma segunda tentativa é recusada como conflito.
2. A observação tem até 1.000 caracteres: opcional ao aprovar e **obrigatória ao rejeitar**.
3. Cada decisão é uma transação `Serializable` que só grava se a aprovação ainda estiver pendente e a solicitação ainda estiver aberta; os horários vêm do relógio do banco.
4. Administrador, solicitante, atendente e gestor de outro setor não decidem; para quem está fora do setor, a solicitação "não existe" (regra atual).

### 5.5 Prazo **(decisão A3)**

Para solicitações que exigem aprovação, o vencimento do SLA é calculado **a partir da aprovação** (com a prioridade atual), e não da abertura. Enquanto pendente, a solicitação aparece "sem prazo". Solicitações sem aprovação seguem a SPEC de SLA sem mudança.

### 5.6 Registro, eventos e notificações

1. A decisão fica numa nova tabela `RequestApproval` (`requestId`, `deciderId`, `decision`, `note`, `decidedAt`), uma por solicitação, e aparece na linha do tempo ("Aprovada por …", "Rejeitada por …", com a observação).
2. Eventos na mesma transação: `request.approval_decided` (identificadores e o código da decisão). A rejeição também grava o `request.status_changed` do cancelamento.
3. Notificações na aplicação:
   - na abertura de uma solicitação que exige aprovação: **os gestores ativos do setor** ("Aprovação pendente: …");
   - na decisão: **o solicitante** ("Solicitação aprovada: …" ou "Solicitação rejeitada: …").

### 5.7 Telas **(decisão A4)**

- **Gestor — "Aprovações":** lista das solicitações do seu setor que exigem aprovação, com filtro "pendentes" (padrão) ou "todas", e o detalhe só de leitura (descrição, respostas dos campos, documentos e histórico) com os formulários "Aprovar" e "Rejeitar".
- **Solicitante e atendente:** a situação da aprovação aparece ao lado do status ("Aguardando aprovação", "Aprovada", "Rejeitada"), nas listas e nos detalhes; o atendente vê o aviso de que o atendimento só começa depois da aprovação.
- **Administração:** opção no formulário do serviço e o perfil "Gestor" no cadastro de usuários.

### 5.8 Autorização

| Operação | Administrador | Solicitante | Atendente | Gestor |
| --- | --- | --- | --- | --- |
| Configurar "exige aprovação" e cadastrar gestores | Permitido | Negado | Negado | Negado |
| Ver solicitações que exigem aprovação | Negado | As próprias | As do setor | As do setor (só leitura) |
| Aprovar ou rejeitar | Negado | Negado | Negado | Só no seu setor, regra 5.4 |
| Iniciar com aprovação pendente | — | — | Negado | — |

## 6. Dados (migration aditiva)

- Enum `Role` ganha `MANAGER` (`ALTER TYPE … ADD VALUE`).
- `User_role_sectorId_check`: hoje exige setor só para `ATTENDANT`; passa a exigir setor para `ATTENDANT` **e** `MANAGER`. A restrição é apagada e recriada; nenhum dado existente muda (não há gestores).
- Novo enum `ApprovalState` (`PENDING`, `APPROVED`, `REJECTED`) e novo enum `ApprovalDecision` (`APPROVED`, `REJECTED`).
- `Service.requiresApproval` (booleano, padrão falso).
- `Request.approvalState` (opcional): nulo quando a solicitação não exige aprovação; `CHECK` de coerência com o status (pendente só em `OPEN` ou `CANCELLED`; rejeitada só em `CANCELLED`).
- Nova tabela `RequestApproval` com único em `requestId`, `CHECK` da observação (obrigatória na rejeição, até 1.000 caracteres).
- `OutboxEvent`: o `CHECK` de tipos passa a aceitar `request.approval_decided` (recriado mais amplo, como nas SPECs de SLA e de fluxos).
- Dados existentes: serviços sem aprovação, solicitações com `approvalState` nulo.
- *Atualização registrada em 2026-11-01 (SF-081):* a restrição `Request_dueAt_check` da SPEC de SLA exige vencimento exatamente quando há snapshot do prazo. Com a aprovação pendente (5.5), o snapshot é guardado na abertura e o vencimento só nasce na aprovação; uma solicitação rejeitada nunca recebe vencimento. A restrição é recriada mais ampla: continua igual para quem não exige aprovação e aceita snapshot sem vencimento só com a aprovação pendente ou rejeitada. Também é preciso separar a migration em duas, porque o PostgreSQL não deixa usar um valor novo de enum (`MANAGER`) na mesma transação que o cria.

## 7. Critérios de aceitação

- [x] **CA-APR-01** — Serviço sem aprovação: abertura, início, conclusão, SLA e notificações funcionam como hoje, e todas as suítes anteriores passam sem alteração de asserções (exceto as listas exatas exigidas pela SPEC). *Verificado em 2026-11-01 (SF-083): serviço sem aprovação abre com `approvalState` nulo e vencimento a partir da abertura, e inicia normalmente (unitário e integração); todas as suítes anteriores passam, com as únicas asserções alteradas sendo as listas exatas exigidas pela SPEC.*
- [x] **CA-APR-02** — O administrador cadastra gestores (sempre com setor) e marca serviços como "exige aprovação"; outros perfis são negados. *Parcial em 2026-11-01 (SF-082): o administrador cadastra gestores só com setor ativo existente (sem setor, setor inativo e setor inexistente recusados), troca perfis mantendo a regra do setor e não reativa gestor de setor inativo (integração). Falta a opção "exige aprovação" no serviço (SF-083).* *Verificado em 2026-11-01 (SF-082 e SF-083): gestores só com setor ativo (SF-082); o administrador marca e desmarca "Exige aprovação do gestor" no serviço, um serviço novo nasce sem aprovação e um formulário sem a opção mantém o valor atual (unitário das ações e integração); outros perfis seguem negados pela regra já existente da configuração.*
- [x] **CA-APR-03** — O gestor entra (senha e demonstração), vai para "Aprovações" e não acessa as áreas de solicitante, atendente ou administração. *Verificado em 2026-11-01 (SF-082): "Entrar como Gestor" leva à área "Aprovações"; catálogo, minhas solicitações, fila e administração devolvem o gestor para `/approvals`; "Alterar senha" volta para a área do gestor (E2E); a conta de demonstração é criada uma vez, no setor de demonstração (integração).*
- [x] **CA-APR-04** — A solicitação de um serviço com aprovação nasce com aprovação pendente; mudar o serviço depois não altera solicitações existentes. *Verificado em 2026-11-01 (SF-083): a solicitação de um serviço com aprovação nasce com aprovação pendente; desmarcar a opção no serviço depois não altera a solicitação já aberta (unitário e integração).*
- [x] **CA-APR-05** — Com aprovação pendente, iniciar o atendimento é recusado; após a aprovação, funciona normalmente. *Parcial em 2026-11-01 (SF-083): com aprovação pendente, iniciar é recusado no servidor sem gravar nada, e a tela do atendente troca o botão por um aviso; aprovada, inicia normalmente (unitário com o estado aprovado e integração). Falta o percurso real de aprovação pelo gestor (SF-084).* *Verificado em 2026-11-01 (SF-083 e SF-084): pendente, iniciar é recusado (SF-083); depois da aprovação do gestor, o atendente inicia normalmente (integração).*
- [x] **CA-APR-06** — Só um gestor ativo do setor decide, uma vez; rejeitar exige observação e cancela a solicitação na mesma transação; decisões simultâneas não gravam duas vezes. *Verificado em 2026-11-01 (SF-084): só gestor ativo do setor decide (gestor de outro setor, atendente, solicitante e administrador recebem "não encontrado"; usuário inativo não passa da sessão); decide uma vez; rejeitar sem observação é recusado sem gravar nada; a rejeição cancela a solicitação na mesma transação; de duas decisões simultâneas só uma vale (integração repetida 4 vezes) e a decisão lida antes de outra gravar é recusada (unitário).*
- [x] **CA-APR-07** — Com aprovação, o vencimento do SLA conta a partir da aprovação; pendente, a solicitação fica sem prazo. *Parcial em 2026-11-01 (SF-083): pendente, a solicitação guarda as horas de SLA sem vencimento (e sem início de "próximo do vencimento"). Falta o vencimento a partir da aprovação (SF-084).* *Verificado em 2026-11-01 (SF-083 e SF-084): pendente, fica sem vencimento, mesmo mudando a prioridade; aprovada, o vencimento conta do horário da aprovação e o início de "próximo do vencimento" é preenchido (unitário e integração).*
- [x] **CA-APR-08** — A decisão aparece na linha do tempo com a observação, grava o evento e notifica o solicitante; a abertura notifica os gestores ativos do setor. *Verificado em 2026-11-01 (SF-084): a decisão aparece no detalhe (registro e linha do tempo) com a observação; grava `request.approval_decided` sem a observação; a abertura notifica os gestores ativos do setor (inativo e de outro setor não); a decisão notifica o solicitante uma única vez ("aprovada" ou "rejeitada", sem o aviso extra de cancelamento) (unitário e integração).*
- [x] **CA-APR-09** — O gestor vê só as solicitações do seu setor que exigem aprovação, só para leitura; solicitante e atendente veem a situação da aprovação. *Verificado em 2026-11-01 (SF-085): o gestor lista só as solicitações do seu setor que exigem aprovação (pendentes por padrão; "todas" inclui as decididas, pendentes primeiro) e abre só essas, com respostas e documentos; solicitação sem aprovação e de outro setor ficam "não encontradas"; solicitante e atendente não usam a área (unitário da regra e das ações, integração); solicitante e atendente veem "Aguardando aprovação", "Aprovada" ou "Rejeitada" nas listas e nos detalhes (navegador).*
- [x] **CA-APR-10** — Migration aditiva (com as restrições recriadas mais amplas); dados existentes não mudam. *Verificado em 2026-11-01 (SF-081): migrations aplicadas sobre dados existentes; serviços ficam sem aprovação e solicitações com `approvalState` nulo; as três restrições recriadas mantêm as regras anteriores para quem não usa aprovação (inclusive a do SLA, conferida pelo teste de schema do SLA) (`approval-schema.test.ts`, `sla-schema.test.ts`); suítes anteriores sem alteração de asserções.*

## 8. Estratégia de testes

- **Unitários:** regras de quem decide, observação, transições da aprovação, bloqueio do início, vencimento a partir da aprovação, destinatários das notificações.
- **Integração:** perfil e restrição de setor; snapshot na abertura; decisão concorrente; rejeição cancelando; SLA; acesso por perfil; notificações.
- **E2E:** o administrador marca um serviço como "exige aprovação"; o solicitante abre; o atendente não consegue iniciar; o gestor rejeita uma solicitação e aprova outra; o atendente inicia a aprovada; o solicitante vê a decisão e as notificações.

## 9. Riscos

- **Novo perfil em todo o sistema:** o tipo de perfil aparece em autorização, navegação, login de demonstração e cadastro de usuários. Mitigação: cada ponto é coberto por teste, e os perfis existentes não mudam de comportamento.
- **Restrições do banco recriadas:** a do setor do usuário e a dos tipos de evento. Mitigação: as novas são mais amplas e os testes de schema conferem os dados existentes.
- **Gestor ausente:** sem gestor ativo no setor, ninguém aprova. Mitigação: a tela do administrador mostra quantos gestores ativos o setor do serviço tem ao marcar "exige aprovação"; delegação fica fora de escopo.

## 10. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-081 | Migration e domínio: perfil Gestor, aprovação no serviço e na solicitação, regras de decisão e de bloqueio |
| SF-082 | Perfil Gestor no sistema: cadastro de usuários, login e conta de demonstração, área e navegação |
| SF-083 | Aprovação na abertura e no início: opção no serviço, snapshot, bloqueio do início, SLA sem prazo enquanto pendente |
| SF-084 | Decisão: aprovar e rejeitar com histórico, eventos, cancelamento na rejeição, SLA a partir da aprovação e notificações |
| SF-085 | Telas: área "Aprovações" do gestor e situação da aprovação para solicitante e atendente |
| SF-086 | E2E e revisão |

**Ordem:** SF-081 → SF-082 → SF-083 → SF-084 → SF-085 → SF-086.

## 11. Decisões tomadas (2026-11-01)

Decisões da responsável pelo projeto: **todas as propostas aceitas**.

| # | Questão | Decisão | Alternativas descartadas |
|---|---|---|---|
| A1 | Onde a aprovação entra | Antes do início do atendimento; o status continua "Aberta" com a aprovação pendente; rejeitar cancela a solicitação | Novos status "Aguardando aprovação" e "Rejeitada" (refaz filtros, SLA e transições); ou aprovação como uma etapa do fluxo |
| A2 | Níveis de aprovação | Um nível: qualquer gestor ativo do setor decide | Até 3 níveis em sequência, configurados no serviço |
| A3 | Prazo do SLA | Conta a partir da aprovação | Conta desde a abertura, como hoje |
| A4 | O que o gestor vê | Só as solicitações do setor que exigem aprovação, só para leitura | Todas as solicitações do setor, só para leitura |
