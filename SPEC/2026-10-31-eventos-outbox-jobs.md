# SPEC — Eventos de domínio, outbox e jobs agendados (passo 1 do plano)

**Data:** 2026-10-31
**Status:** Aprovada em 2026-10-31, com as decisões E1 a E4 da seção 15 conforme propostas (nenhum código implementado)
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-10-30-camadas-para-100k.md` (seção 3: "Eventos de domínio + outbox", "Jobs agendados"; passo 1), `SPEC/2026-10-29-plano-escala-100k.md` (itens 5, 10 e 12), `SPEC/2026-09-30-visao-geral.md` (§11 Notificações), `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seção 21.15.5, limpeza de órfãos)

## 1. Objetivo

Criar a base que SLA, notificações e auditoria vão usar:
1. **Eventos de domínio** gravados na **mesma transação** da mudança que os gera (padrão *outbox*), para que nenhum evento se perca nem seja publicado sem a mudança ter acontecido.
2. **Processamento** desses eventos fora da transação, com nova tentativa em caso de falha.
3. **Jobs agendados** para tarefas periódicas.

Para não entregar infraestrutura sem uso (`AGENTS.md`, regra 6), esta SPEC inclui o **primeiro consumidor** dos eventos **(decisão E1)**: notificações na aplicação.

## 2. Fatos da plataforma (conferidos em 2026-10-31)

| Fato | Fonte | Consequência |
|---|---|---|
| No plano Hobby da Vercel, cron roda **no máximo uma vez por dia**, com precisão de ±59 min; expressões mais frequentes falham no deploy | Vercel, *Usage & Pricing for Cron Jobs* (atualizada em 2026-07-15) | O cron não serve para entregar eventos na hora; só para recuperação e limpeza |
| `after()` do Next 16 executa trabalho depois da resposta; na Vercel usa `waitUntil` | `node_modules/next/dist/docs/.../after.md` | Os eventos podem ser processados logo após a ação, sem atrasar o usuário |

## 3. Registro da mudança de escopo

O passo 1 do plano de camadas foi aceito com o plano (2026-10-29) e exige SPEC própria. "Notificações" (visão geral §11, item 10 do plano) estavam fora da primeira entrega. Esta SPEC autoriza **somente notificações dentro da aplicação**. E-mail e outros canais continuam fora.

## 4. Escopo

1. Tabela de eventos (outbox) e gravação dos eventos na mesma transação das ações existentes.
2. Processador de eventos com lote, bloqueio por linha, tentativas e registro de falha.
3. Disparo do processador logo após cada ação (`after()`) **(decisão E2)**.
4. Um job diário (Vercel Cron) protegido por segredo: processa eventos que ficaram pendentes e faz as limpezas da seção 7.
5. Notificações na aplicação: aviso com contador no topo, página de notificações e "marcar como lidas".

## 5. Fora de escopo

- E-mail, push e qualquer provedor externo de mensagens (exigem conta e credenciais; ficam para a SPEC completa de notificações).
- Preferências de notificação por usuário.
- SLA, auditoria geral e relatórios (consumidores futuros dos mesmos eventos).
- Filas externas (Vercel Queues, Redis etc.).

## 6. Eventos

### 6.1 Tipos

| Evento | Gerado por | Dados (`payload`) |
|---|---|---|
| `request.opened` | Abertura (SF-034) | `requestId`, `requesterId`, `sectorId` |
| `request.status_changed` | Iniciar, concluir, cancelar, reabrir | `requestId`, `fromStatus`, `toStatus`, `actorId` |
| `request.assignment_changed` | Assumir, liberar, transferir | `requestId`, `fromAssigneeId`, `toAssigneeId`, `actorId` |
| `request.comment_added` | Comentário (SF-054) | `requestId`, `commentId`, `authorId`, `isInternal` |

O `payload` guarda **só identificadores e códigos**: nunca texto de comentário, justificativa, nome de arquivo ou dado pessoal. Quem consome relê o banco.

### 6.2 Outbox (garantias)

1. O evento é gravado **na mesma transação** da mudança. Se a transação falhar, não há evento; se tiver sucesso, o evento existe.
2. Entrega **pelo menos uma vez**: um evento pode ser processado mais de uma vez em caso de falha no meio. Por isso os consumidores precisam ser **idempotentes**: a notificação tem chave única `(eventId, recipientId)`.
3. Processamento em lote de até 50 eventos, em ordem de criação, com `FOR UPDATE SKIP LOCKED`, para que dois processadores simultâneos (o `after()` de duas ações, ou `after()` e cron) nunca peguem o mesmo evento.
4. Falha de um consumidor: o evento volta a ficar disponível com espera crescente (1, 5, 30 minutos, depois diária) e o erro é registrado **só por código**. Após 10 tentativas, o evento fica marcado como falho e deixa de ser tentado.
5. Horários pelo relógio do banco.

## 7. Jobs agendados

- **Uma rota de cron** (`/api/cron/daily`), agendada uma vez por dia no `vercel.json`, aceita apenas requisições com `Authorization: Bearer <CRON_SECRET>` (mecanismo documentado da Vercel). Sem o segredo, responde 401 e não faz nada.
- Tarefas, em ordem:
  1. Processar eventos pendentes (recuperação do que o `after()` não processou).
  2. Apagar eventos processados há mais de 30 dias e notificações lidas há mais de 90 dias.
  3. **(decisão E3)** Limpar objetos órfãos do armazenamento de documentos (SPEC principal, 21.15.5): objetos sob `requests/` sem registro de anexo e com mais de 24 horas. Sem armazenamento configurado, a tarefa é pulada.
- `CRON_SECRET` é cadastrado na Vercel como Secret pela responsável; nunca vai para o repositório.

## 8. Notificações na aplicação (primeiro consumidor)

### 8.1 Quem recebe **(decisão E4)**

| Evento | Destinatário |
|---|---|
| Status mudou por ação de atendente (iniciar, concluir, cancelar) | Solicitante dono |
| Solicitante cancelou ou reabriu | Responsável efetivo, se houver |
| Atribuição: alguém transferiu para você | O novo responsável |
| Comentário público do atendente | Solicitante dono |
| Comentário do solicitante | Responsável efetivo, se houver |
| Nota interna | Responsável efetivo, se houver e não for o autor |

- O autor da ação nunca é notificado pela própria ação.
- Sem responsável efetivo, ninguém da equipe é notificado; a fila já mostra a solicitação e a contagem de comentários.
- O destinatário é recalculado no processamento, com os dados atuais do banco. Usuário inativo não recebe.

### 8.2 Conteúdo e exibição

- A notificação guarda tipo, solicitação, evento de origem, destinatário, `createdAt` e `readAt`. **Não copia texto** (comentário, nota ou justificativa): a tela monta a frase a partir do tipo e do snapshot do serviço, por exemplo "Novo comentário em Reparo de mobiliário".
- Notificação de nota interna nunca é criada para o solicitante (regra 8.1).
- No topo da área logada: link "Notificações" com a quantidade não lida.
- Página `/notifications`: lista das 50 mais recentes, com link para a solicitação, e "Marcar todas como lidas". Abrir a solicitação pelo link marca aquela notificação como lida.
- Autorização: cada usuário só vê as próprias notificações. O link leva à página da solicitação, que aplica as regras de acesso de sempre (por exemplo, se o atendente mudou de setor, a solicitação não abre).

## 9. Dados (migration somente aditiva)

- `OutboxEvent`: `id`, `type`, `requestId`, `payload` (JSON), `occurredAt`, `availableAt`, `attempts`, `processedAt`, `failedAt`, `lastErrorCode`. Índice em `(processedAt, failedAt, availableAt)`.
- `RequestNotification`: `id`, `recipientId`, `requestId`, `eventId` (opcional, `ON DELETE SET NULL`), `type`, `createdAt`, `readAt`. Única em `(eventId, recipientId)`; índice em `(recipientId, readAt, createdAt)`. *Alterado em 2026-11-01 na implementação (SF-061): o nome era `Notification`; e `eventId` passou a aceitar nulo para que a limpeza de eventos processados (seção 7) não seja bloqueada por notificações não lidas.*
- Nenhuma tabela existente é alterada.

## 10. Arquitetura

- Novo módulo `src/modules/events` (tipos de evento, gravação no outbox, processador, registro de consumidores).
- Novo módulo `src/modules/notifications` (regra de destinatários, consumidor, listagem e leitura).
- As transações existentes de `requests` e `comments` passam a chamar `recordEvent` dentro da mesma transação; as Server Actions chamam o processador com `after()`.
- Rota `src/app/api/cron/daily/route.ts` e `vercel.json` com o agendamento.

## 11. Critérios de aceitação

- [x] **CA-EVT-01** — Cada ação da seção 6.1 grava exatamente um evento na mesma transação; se a transação falha, nenhum evento fica gravado. *Verificado em 2026-11-01 (SF-061): `outbox-events.test.ts` (um evento por ação; com a gravação do evento falhando por gatilho, a ação inteira é desfeita).*
- [x] **CA-EVT-02** — O `payload` não contém texto de comentário, justificativa, nome de arquivo nem dado pessoal. *Verificado em 2026-11-01 (SF-061): `outboxPayload` copia só as chaves declaradas (unitário) e o conteúdo gravado não contém texto de comentário, justificativa nem descrição (integração).*
- [ ] **CA-EVT-03** — Dois processadores simultâneos não processam o mesmo evento; um evento reprocessado não gera notificação duplicada.
- [ ] **CA-EVT-04** — Falha de consumidor agenda nova tentativa com espera crescente e registra só o código; após 10 tentativas o evento é marcado como falho.
- [ ] **CA-EVT-05** — A rota de cron recusa requisição sem o segredo correto (401) e, com ele, processa pendentes e faz as limpezas da seção 7.
- [ ] **CA-EVT-06** — Os destinatários seguem a tabela 8.1; o autor não é notificado; usuário inativo não recebe; o solicitante nunca recebe notificação de nota interna.
- [ ] **CA-EVT-07** — O contador e a página mostram só as notificações do próprio usuário; "marcar todas como lidas" e abrir pelo link marcam como lidas.
- [ ] **CA-EVT-08** — Logo após uma ação (sem esperar o cron), o destinatário vê a notificação.
- [x] **CA-EVT-09** — Migration aditiva; suítes anteriores passam sem alteração de asserções. *Verificado em 2026-11-01 (SF-061): migration aditiva aplicada no banco de teste; suítes anteriores sem alteração de asserções.*

## 12. Estratégia de testes

- **Unitários:** regra de destinatários; espera entre tentativas; montagem do `payload` sem textos; verificação do segredo do cron.
- **Integração:** evento na mesma transação (inclusive com falha forçada); dois processadores concorrentes; idempotência; tentativas e falha final; limpezas; autorização das notificações.
- **E2E:** atendente comenta e o solicitante vê o contador e a notificação, abre a solicitação pelo link e o contador zera.

## 13. Riscos

- **`after()` interrompido** (limite de duração da função): os eventos ficam pendentes até o cron diário. As notificações atrasam até um dia nesse caso raro; nada se perde.
- **Mais escrita por ação:** uma linha de outbox por ação; aceitável para o volume do projeto.
- **CRON_SECRET ausente:** a rota fica recusando tudo (seguro); o job só funciona depois de a responsável cadastrar o segredo.

## 14. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-061 | Migration, módulo `events` e gravação dos eventos nas transações existentes |
| SF-062 | Processador (lote, bloqueio, tentativas), `after()` e rota de cron com limpezas |
| SF-063 | Módulo `notifications`: destinatários, consumidor, contador, página e leitura |
| SF-064 | E2E e revisão |

## 15. Decisões tomadas (2026-10-31)

Decisões da responsável pelo projeto: **todas as propostas aceitas**.

| # | Questão | Decisão | Alternativas descartadas |
|---|---|---|---|
| E1 | Primeiro consumidor dos eventos | Notificações na aplicação | Trilha de auditoria (item 12); ou nenhum (só infraestrutura) |
| E2 | Quando processar | Logo após a ação (`after()`) + cron diário de recuperação | Só cron diário (notificações com até um dia de atraso) |
| E3 | Limpeza de órfãos do armazenamento no job diário | Incluir (pulada sem armazenamento configurado) | Deixar para depois da SF-030 |
| E4 | Sem responsável efetivo, quem da equipe é avisado | Ninguém (a fila já mostra) | Todos os atendentes ativos do setor |
