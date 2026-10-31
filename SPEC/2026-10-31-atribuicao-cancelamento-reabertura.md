# SPEC — Atribuição, transferência, cancelamento e reabertura de solicitações

**Data:** 2026-10-31
**Status:** Aprovada em 2026-10-31, com as decisões D1 a D5 da seção 12 conforme propostas
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-visao-geral.md` (§3, §7 e §10), `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seções 9, 10, 19 e 23), `SPEC/2026-10-29-plano-escala-100k.md` (item 3 e garantias da seção 7), `SPEC/2026-10-30-camadas-para-100k.md` (passo 3)

## 1. Objetivo

Permitir que um atendente **assuma** uma solicitação do seu setor e a **transfira** a um colega do mesmo setor; que o solicitante **cancele** uma solicitação ainda não iniciada e **reabra** uma concluída; e que o atendente cancele uma solicitação com justificativa. Todas as ações ficam no histórico.

## 2. Registro da mudança de escopo

A SPEC principal deixou fora da primeira entrega "atribuição individual de atendentes e transferências" e "reabertura e cancelamento de solicitações" (seções 5 e 19) e proibiu, na seção 9, reabertura, cancelamento e retorno de estado. Esta SPEC **autoriza** esses itens no recorte abaixo e altera as seções 9 e 10 somente onde indicado. O item 3 do plano de escala foi aceito em 2026-10-29 (decisão 3), condicionado a esta SPEC.

## 3. Escopo

1. Responsável individual (opcional) por solicitação.
2. Assumir, liberar e transferir dentro do mesmo setor.
3. Novo estado terminal `CANCELLED` (Cancelada).
4. Cancelamento pelo solicitante (solicitação aberta) e pelo atendente (com justificativa).
5. Reabertura de solicitação concluída pelo solicitante, com justificativa e prazo.
6. Histórico de atribuições e das justificativas.
7. Telas do atendente (fila e detalhe) e do solicitante (detalhe) para essas ações.

## 4. Fora de escopo

- Transferência para **outro setor** (mudaria o setor e os snapshots da solicitação; exige SPEC própria).
- Atribuição automática, rodízio, carga de trabalho ou limites por atendente.
- Notificações das ações (item 10 do plano).
- Filtros e busca na fila (item 13); aqui só se mostra o responsável.
- Acesso do administrador a solicitações (continua negado, seção 10).
- Reabertura de solicitação cancelada; edição da descrição; anexos após a abertura.

## 5. Regras

### 5.1 Responsável

1. A solicitação passa a ter `assigneeId` opcional. Solicitações existentes e novas começam **sem responsável**.
2. O responsável é sempre um usuário `ATTENDANT` **ativo** e **do setor atual da solicitação** (`Request.sectorId`) no momento da atribuição.
3. Um responsável **efetivo** é o responsável que ainda é atendente ativo daquele setor. Se ele for desativado ou mudar de setor, a atribuição continua registrada, mas deixa de ser efetiva (regra 5.2.4).
4. O solicitante vê o nome do responsável no detalhe da solicitação.

### 5.2 Assumir, liberar e transferir (atendente do setor)

| Ação | Quem | Quando | Efeito |
| --- | --- | --- | --- |
| Assumir | Atendente ativo do setor | Estado `OPEN` ou `IN_PROGRESS` e sem responsável efetivo | Torna-se o responsável |
| Liberar | O responsável | Estado `OPEN` ou `IN_PROGRESS` | A solicitação fica sem responsável |
| Transferir | O responsável **(decisão D1)** | Estado `OPEN` ou `IN_PROGRESS` | Outro atendente ativo do mesmo setor passa a ser o responsável |

1. Transferir para si mesmo, para usuário inativo, de outro setor ou de outro perfil é rejeitado.
2. Assumir uma solicitação que já tem responsável efetivo é rejeitado (conflito); o atendente deve pedir a transferência.
3. O identificador do novo responsável vem do formulário, mas é validado no servidor contra o banco (perfil, estado ativo e setor).
4. Se o responsável deixou de ser efetivo, qualquer atendente ativo do setor pode assumir.

### 5.3 Mudança de status com responsável **(decisão D2)**

1. Sem responsável efetivo: qualquer atendente ativo do setor inicia e conclui, **exatamente como hoje**.
2. Com responsável efetivo: só ele inicia e conclui.
3. Iniciar o atendimento **não** atribui automaticamente. Assim, quem não usa a atribuição mantém o fluxo atual sem nenhuma mudança (garantia 7.4 do plano: comportamento novo desligado por padrão).

### 5.4 Cancelamento

| Quem | Estados de origem | Justificativa |
| --- | --- | --- |
| Solicitante dono | `OPEN` **(decisão D3)** | Opcional, até 1.000 caracteres |
| Atendente ativo do setor (responsável efetivo, se houver) | `OPEN` ou `IN_PROGRESS` | **Obrigatória**, 1 a 1.000 caracteres |

1. `CANCELLED` é terminal: não volta a nenhum estado e não aceita atribuição.
2. O cancelamento preenche `cancelledAt` com o horário do banco e não altera `completedAt`.
3. A solicitação cancelada continua consultável pelos mesmos perfis.

### 5.5 Reabertura **(decisão D4)**

1. Só o **solicitante dono** reabre, só a partir de `COMPLETED`, em até **7 dias** contados de `completedAt` (relógio do banco).
2. Justificativa obrigatória, 1 a 1.000 caracteres.
3. A solicitação volta para `OPEN`, `completedAt` passa a nulo e o **responsável é mantido** **(decisão D5)**, para o mesmo atendente retomar.
4. Não há limite de reaberturas dentro do prazo de cada conclusão.
5. O serviço, a categoria e o setor estarem inativos **não** impedem a reabertura: ela continua o atendimento de uma solicitação existente, não cria uma nova.

### 5.6 Nova tabela de transições (substitui a da seção 9 da SPEC principal)

| Estado atual | Estado seguinte | Ator | Observação |
| --- | --- | --- | --- |
| inexistente | `OPEN` | Solicitante | Inalterado |
| `OPEN` | `IN_PROGRESS` | Atendente do setor (regra 5.3) | Inalterado sem responsável |
| `IN_PROGRESS` | `COMPLETED` | Atendente do setor (regra 5.3) | Inalterado sem responsável |
| `OPEN` | `CANCELLED` | Solicitante dono ou atendente do setor | Justificativa obrigatória para o atendente |
| `IN_PROGRESS` | `CANCELLED` | Atendente do setor | Justificativa obrigatória |
| `COMPLETED` | `OPEN` | Solicitante dono, até 7 dias | Justificativa obrigatória |

Continuam proibidas: `OPEN` → `COMPLETED`, `IN_PROGRESS` → `OPEN`, `COMPLETED` → `IN_PROGRESS`, qualquer saída de `CANCELLED`.

### 5.7 Autorização (complementa a seção 10)

| Operação | Administrador | Solicitante | Atendente |
| --- | --- | --- | --- |
| Assumir, liberar, transferir | Negado | Negado | Somente no setor atual, regras 5.2 |
| Cancelar | Negado | Somente as próprias, em `OPEN` | Somente no setor atual, com justificativa |
| Reabrir | Negado | Somente as próprias, regra 5.5 | Negado |

Toda verificação acontece no servidor, a cada operação, com a sessão recarregada do banco. Negações seguem a seção 10: resposta de "não encontrado" ou mensagem fixa, sem revelar dados alheios.

### 5.8 Concorrência e horários

1. Cada ação é uma transação `Serializable` que só altera a linha se o estado **e** o responsável ainda forem os lidos (mesmo padrão de `updateStatusIfCurrent`); caso contrário, conflito com mensagem fixa e nada é gravado.
2. Todos os horários vêm do relógio do banco (seção 23 da SPEC principal).

### 5.9 Histórico

1. Atribuições ficam em uma nova tabela `RequestAssignmentEvent`: `id`, `requestId`, `actorId`, `fromAssigneeId` (nulo ao assumir), `toAssigneeId` (nulo ao liberar), `occurredAt`.
2. `RequestStatusEvent` ganha `note` opcional (até 1.000 caracteres) para as justificativas de cancelamento e reabertura.
3. O detalhe mostra uma linha do tempo única, em ordem cronológica, com eventos de status e de atribuição.

## 6. Dados (migration somente aditiva)

- `RequestStatus` ganha o valor `CANCELLED`.
- `Request`: `assigneeId` (UUID, opcional, FK para `User`, `RESTRICT`), `cancelledAt` (timestamptz, opcional), índice em `(sectorId, assigneeId)`.
- `RequestStatusEvent`: `note` (texto opcional, `CHECK` de 1 a 1.000 caracteres quando presente).
- Nova tabela `RequestAssignmentEvent` com FKs `RESTRICT` e índice em `requestId`.
- `CHECK`: `cancelledAt` preenchido se e somente se `status = 'CANCELLED'`.
- Nenhuma coluna existente é renomeada ou removida; nenhum dado é alterado.

## 7. Arquitetura

Tudo no módulo `requests`, nas camadas existentes:

- `domain/`: regras puras de transição (tabela 5.6), responsável efetivo, quem pode assumir, transferir, cancelar e reabrir, prazo de reabertura.
- `application/`: casos de uso `assignRequest`, `releaseRequest`, `transferRequest`, `cancelRequest`, `reopenRequest` e schemas de entrada; extensão de `transitionRequestStatus` para a regra 5.3.
- `infrastructure/`: repositório Prisma com atualização condicional (estado + responsável) e eventos.
- Telas: fila e detalhe do atendente (responsável, Assumir, Liberar, Transferir, Cancelar) e detalhe do solicitante (responsável, Cancelar, Reabrir).

## 8. Critérios de aceitação

- [x] **CA-ATR-01** — Um atendente ativo do setor assume uma solicitação `OPEN` ou `IN_PROGRESS` sem responsável efetivo; o evento de atribuição registra ator, origem nula, destino e horário do banco. *Verificado em 2026-10-31 (SF-048): testes unitários de `assignment.ts` e `tests/integration/request-assignment.test.ts`.*
- [x] **CA-ATR-02** — Assumir solicitação com responsável efetivo é rejeitado sem gravar nada; se o responsável foi desativado ou mudou de setor, outro atendente do setor consegue assumir. *Verificado em 2026-10-31 (SF-048): conflito sem gravação; após o responsável mudar de setor, outro atendente assume (unitário e integração).*
- [x] **CA-ATR-03** — O responsável transfere para outro atendente ativo do mesmo setor; transferência para si, inativo, outro setor, outro perfil ou identificador inexistente é rejeitada no servidor. *Verificado em 2026-10-31 (SF-048): transferência com evento; alvo validado no banco (si mesmo, inativo, outro setor, administrador, solicitante e inexistente rejeitados).*
- [x] **CA-ATR-04** — O responsável libera a solicitação; ela fica sem responsável e o evento registra destino nulo. *Verificado em 2026-10-31 (SF-048): unitário e integração.*
- [x] **CA-ATR-05** — Sem responsável, qualquer atendente do setor inicia e conclui como antes (testes existentes de transição passam sem alteração de asserções); com responsável efetivo, só ele inicia e conclui. *Verificado em 2026-10-31 (SF-049): `transition-with-assignee.test.ts` e `request-transition-assignee.test.ts`; `requests-transitions.test.ts` e `transition-request-status.test.ts` inalterados e aprovados.*
- [x] **CA-ATR-06** — O solicitante cancela a própria solicitação `OPEN`; não consegue cancelar `IN_PROGRESS`, `COMPLETED`, `CANCELLED` nem solicitação alheia. *Verificado em 2026-10-31 (SF-050): `cancellation.test.ts` e `request-cancellation.test.ts`.*
- [x] **CA-ATR-07** — O atendente do setor cancela `OPEN` ou `IN_PROGRESS` somente com justificativa de 1 a 1.000 caracteres; a justificativa fica no evento. *Verificado em 2026-10-31 (SF-050): justificativa vazia ou acima de 1.000 caracteres rejeitada sem gravação; justificativa gravada no evento.*
- [x] **CA-ATR-08** — `CANCELLED` é terminal: nenhuma transição, atribuição ou reabertura é aceita. *Verificado em 2026-10-31 (SF-050): após o cancelamento, assumir, iniciar e cancelar de novo dão conflito (integração); a reabertura de cancelada é negada pelo domínio (`lifecycle.test.ts`).*
- [ ] **CA-ATR-09** — O solicitante reabre a própria solicitação `COMPLETED` em até 7 dias com justificativa; ela volta a `OPEN`, `completedAt` fica nulo e o responsável é mantido. Após 7 dias, a reabertura é rejeitada.
- [ ] **CA-ATR-10** — Administrador, atendente de outro setor, outro solicitante, usuário inativo e não autenticado são negados em todas as novas operações, sem revelar a solicitação. *Parte de atribuição verificada em 2026-10-31 (SF-048); cancelamento e reabertura nas SF-050 e SF-051.* *Parte de cancelamento verificada em 2026-10-31 (SF-050).*
- [x] **CA-ATR-11** — Duas ações concorrentes sobre a mesma solicitação (por exemplo, dois atendentes assumindo) resultam em uma aceita e outra rejeitada, sem estado intermediário. *Verificado em 2026-10-31 (SF-048): duas transações reais concorrentes no PostgreSQL de teste (4 execuções), uma aceita e outra `ConflictError`, com um único evento.*
- [ ] **CA-ATR-12** — O detalhe mostra o responsável e a linha do tempo com status, atribuições e justificativas em ordem cronológica, para solicitante e atendente.
- [x] **CA-ATR-13** — A migration é aditiva: dados existentes ficam inalterados e todas as suítes anteriores passam sem alteração de asserções. *Verificado em 2026-10-31 (SF-047): duas migrations aditivas aplicadas sobre o banco de teste com dados existentes; `request-assignment-schema.test.ts`; todas as suítes anteriores passam sem alteração de asserções.*
- [ ] **CA-ATR-14** — Identificadores de ator, solicitante e setor vêm da sessão e do banco; campos forjados no formulário (estado, horários, setor, ator) são rejeitados. *Parte de atribuição verificada em 2026-10-31 (SF-048): schemas estritos rejeitam ator, setor e responsável forjados; o novo responsável é validado no banco.* *Parte de cancelamento verificada em 2026-10-31 (SF-050): schema estrito rejeita estado, `cancelledAt` e ator forjados.*

## 9. Estratégia de testes

- **Unitários:** tabela de transições, responsável efetivo, permissões por perfil e estado, prazo de 7 dias nas bordas, justificativas, casos de uso com repositório em memória.
- **Integração (PostgreSQL de teste):** cada operação com persistência e eventos; rejeições sem gravação; concorrência (duas transações); `CHECK` de `cancelledAt` e `note`; migration sobre dados existentes; matriz de autorização.
- **E2E:** atendente assume e transfere; colega conclui só depois da transferência; solicitante cancela uma solicitação aberta; solicitante reabre uma concluída e o atendente a vê de volta na fila.

## 10. Riscos

- Mudança na regra de status para solicitações com responsável (D2): mitigada por só valer quando alguém assume.
- Novo valor de enum no PostgreSQL: `ALTER TYPE ... ADD VALUE` não pode ser usado na mesma transação em que é criado; a migration deve separar os passos.
- Telas existentes que listam por status precisam exibir `CANCELLED` (rótulo "Cancelada").

## 11. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
| --- | --- |
| SF-047 | Migration aditiva e regras de domínio (transições, responsável efetivo, prazos) |
| SF-048 | Assumir, liberar e transferir (casos de uso, repositório, telas do atendente) |
| SF-049 | Regra 5.3 nas transições existentes |
| SF-050 | Cancelamento (solicitante e atendente) |
| SF-051 | Reabertura |
| SF-052 | Linha do tempo unificada, E2E e revisão final |

Estimativa do plano: 5.000 a 7.000 linhas `added` (aplicação e testes).

## 12. Decisões tomadas (2026-10-31)

Decisões da responsável pelo projeto em 2026-10-31: **todas as propostas aceitas**.

| # | Questão | Decisão | Alternativa descartada |
| --- | --- | --- | --- |
| D1 | Quem transfere | Só o responsável | Qualquer atendente do setor |
| D2 | Responsável restringe status | Sim, só ele inicia e conclui | Não, qualquer atendente do setor continua podendo |
| D3 | Cancelamento pelo solicitante | Só em `OPEN` | Também em `IN_PROGRESS` |
| D4 | Reabertura | Solicitante, até 7 dias, justificativa obrigatória | Outro prazo, ou sem reabertura |
| D5 | Responsável na reabertura | Mantido | Removido (volta para a fila sem responsável) |
