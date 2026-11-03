# SPEC — Transferência de solicitação entre setores

**Data:** 2026-11-03
**Status:** Aprovada em 2026-11-03: a responsável aprovou a funcionalidade 5 ("transferência entre setores") da lista de pendências; as decisões T1 a T7 da seção 11 foram adotadas como recomendadas, e podem ser revistas por ela.
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md` (seção 4: "transferência para outro setor exige SPEC própria"; regras de responsável efetivo), `SPEC/2026-11-01-permissoes-configuraveis.md` (supervisão da fila), `SPEC/2026-11-01-aprovacoes.md` (aprovação pendente), `SPEC/2026-11-01-sla-prioridades.md` (prazo), `SPEC/2026-11-01-fluxos-configuraveis.md` (etapas), `SPEC/2026-10-31-eventos-outbox-jobs.md` (eventos e notificações), `SPEC/2026-11-02-auditoria-lgpd.md` (anonimização e "Meus dados"), `SPEC/2026-11-03-api-acoes-webhooks-setor.md` (ações pela API e filtro de setores dos webhooks)

## 1. Objetivo

Permitir que o atendimento **encaminhe** uma solicitação aberta para **outro setor** quando ela chegou ao setor errado, com justificativa, sem que o solicitante precise abrir outra. O novo setor passa a ver e atender a solicitação; o anterior deixa de vê-la; tudo fica no histórico.

## 2. Registro da mudança de escopo

A SPEC de atribuição deixou a transferência para outro setor fora de escopo ("mudaria o setor e os snapshots da solicitação; exige SPEC própria"). Esta é essa SPEC. Hoje o setor da solicitação é o do serviço na abertura (`Request.sectorId` e `sectorNameSnapshot`) e nunca muda.

## 3. Escopo

1. Ação "Encaminhar para outro setor" na página da solicitação na fila, com setor de destino e justificativa.
2. Lista de setores aceitos como destino.
3. Histórico, evento de domínio `request.sector_changed`, notificações e webhooks.
4. A mesma ação pela API (`POST /api/v1/requests/{id}/transfer-sector`) e a lista de destinos (`GET /api/v1/requests/{id}/sector-candidates`).
5. Anonimização e "Meus dados" incluem as justificativas.

## 4. Fora de escopo

- Encaminhar uma solicitação **em atendimento**, concluída ou cancelada (decisão T1).
- Trocar o **serviço** da solicitação: ela continua com o serviço, a categoria e as respostas da abertura.
- Escolher o atendente do novo setor no encaminhamento: o novo setor assume pela fila.
- Recalcular o prazo do SLA ou mudar a prioridade (decisão T2).
- Encaminhar várias solicitações de uma vez.
- Dados fictícios novos (decisão T7).

## 5. Regras

### 5.1 Quem encaminha e quando **(decisões T1 e T3)**

1. A solicitação precisa estar **aberta** (`OPEN`) e **sem aprovação pendente**. Em atendimento, concluída, cancelada ou com aprovação pendente: `409`.
2. Pode encaminhar o atendente ativo do **setor atual** que poderia iniciar o atendimento: o responsável efetivo, se houver; sem responsável efetivo, qualquer atendente ativo do setor. Quem tem a permissão **Supervisionar a fila do setor** encaminha também quando a solicitação está com um colega.
3. Quem não é atendente do setor atual não vê a solicitação e recebe `404`, como nas outras ações. Atendente do setor sem direito pela regra 2 (a solicitação está com um colega e ele não supervisiona) recebe `409`, como ao iniciar ou liberar a solicitação de um colega.
4. Justificativa **obrigatória**, de 1 a 1.000 caracteres depois de tirar espaços das pontas.

### 5.2 Setor de destino **(decisão T4)**

1. Setor **ativo**, **diferente** do atual e com **pelo menos um atendente ativo**. Outro destino é recusado com `400` no campo `sectorId`.
2. A lista de destinos mostra esses setores pelo nome, em ordem alfabética.
3. O identificador vem do formulário ou do corpo da API e é conferido no servidor, na mesma transação da mudança.

### 5.3 Efeitos, numa única transação

1. `Request.sectorId` e `sectorNameSnapshot` passam a ser os do novo setor.
2. O responsável é removido. Se havia um, fica registrado um evento de atribuição de "responsável" para "sem responsável", com o encaminhador como autor.
3. Fica registrado um evento de setor: setor de origem e de destino (identificadores e nomes no momento), autor, justificativa e data.
4. O status, a prioridade, o prazo (`dueAt`), as respostas, os documentos, os comentários e a aprovação já decidida não mudam **(decisão T2)**.
5. Um evento `request.sector_changed` vai para a outbox com `fromSectorId`, `toSectorId` e `actorId`.
6. Se a solicitação mudou entre a leitura e a gravação (status, setor ou responsável), nada é gravado e a resposta é `409`.

### 5.4 Quem vê depois **(decisão T5)**

1. Os atendentes do novo setor veem a solicitação na fila e no detalhe, com **todo** o histórico e todos os comentários, inclusive as notas internas do setor anterior.
2. Os atendentes do setor anterior deixam de vê-la (`404`). Notificações antigas deles sobre essa solicitação continuam na lista, mas o link responde como uma solicitação que não podem ler.
3. O solicitante continua vendo a solicitação, com o setor novo e a linha do histórico, inclusive a justificativa, como nas outras justificativas do histórico.
4. Gestores e relatórios passam a contar a solicitação no novo setor (painel, CSV e "Todas do setor" usam o setor atual).

### 5.5 Histórico

Linha "Encaminhada do setor *Origem* para o setor *Destino*", com quem fez, a data e "Justificativa: …". Os nomes são os do momento do encaminhamento.

### 5.6 Notificações e e-mail

1. Os atendentes ativos do novo setor recebem "Solicitação encaminhada ao seu setor: *serviço*" (tipo `sector.received`, categoria de e-mail "transferências").
2. O solicitante recebe "Solicitação encaminhada a outro setor: *serviço*" (tipo `sector.changed`, categoria de e-mail "status").
3. Quem encaminhou não é notificado.

### 5.7 Webhooks **(decisão T6)**

1. Novo evento de webhook "Mudança de setor" (`request.sector_changed`), com corpo só de identificadores: `fromSectorId`, `toSectorId`, `actorId`.
2. Um webhook filtrado por setores recebe esse evento quando aceita o setor de **origem ou** o de **destino**. Os eventos seguintes usam o setor atual, como hoje.

### 5.8 API

1. `GET /api/v1/requests/{id}/sector-candidates` (escopo `READ`): lista `{id, name}` dos destinos da regra 5.2 para atendentes do setor da solicitação; `403` para outros perfis e `404` para atendente de outro setor, como `transfer-candidates`.
2. `POST /api/v1/requests/{id}/transfer-sector` (escopo `WRITE`), corpo `{"sectorId", "note"}`, estrito; devolve o detalhe atualizado (que pode passar a ser `404` numa leitura seguinte, porque a pessoa deixa de ver a solicitação). Erros no formato da v1.
3. O OpenAPI descreve as duas rotas.

### 5.9 Anonimização e "Meus dados"

A justificativa do encaminhamento é texto escrito pela pessoa: a anonimização a substitui por "[conteúdo removido na anonimização]" e "Meus dados" a inclui entre as justificativas que a pessoa escreveu.

## 6. Dados

Migration aditiva:

- Tabela `RequestSectorEvent`: `id`, `requestId`, `actorId`, `fromSectorId`, `toSectorId`, `fromSectorName`, `toSectorName`, `note` (obrigatória, 1 a 1.000), `occurredAt`; índice por `requestId`; restrição "origem diferente do destino".
- Restrições de tipo de `OutboxEvent.type` e de `WebhookEndpoint.eventTypes` passam a aceitar `request.sector_changed`.

Nenhuma dependência nova.

## 7. Critérios de aceitação

- [ ] **CA-SET-01** — Sem encaminhar, nada muda: suítes anteriores passam sem alteração de asserções.
- [ ] **CA-SET-02** — O atendente do setor (o responsável, se houver; o supervisor também) encaminha uma solicitação aberta, com justificativa, para um setor ativo com atendente ativo; ela passa ao novo setor sem responsável, com status, prioridade e prazo iguais.
- [ ] **CA-SET-03** — São recusados: solicitação em atendimento, concluída, cancelada ou com aprovação pendente (`409`); sem justificativa (`400`); destino igual ao atual, inativo, inexistente ou sem atendente ativo (`400`); atendente do setor sem direito (`409`); quem não é do setor (`404`).
- [ ] **CA-SET-04** — Depois do encaminhamento, o novo setor vê a solicitação na fila, com todo o histórico e as notas internas; o setor anterior recebe `404`; o solicitante vê o setor novo e a linha do histórico.
- [ ] **CA-SET-05** — Os atendentes do novo setor e o solicitante recebem a notificação; quem encaminhou não.
- [ ] **CA-SET-06** — O evento `request.sector_changed` chega aos webhooks sem filtro e aos filtrados pelo setor de origem ou de destino, só com identificadores.
- [ ] **CA-SET-07** — A API encaminha e lista destinos com as mesmas regras; o OpenAPI descreve as rotas.
- [ ] **CA-SET-08** — A anonimização substitui a justificativa; "Meus dados" a inclui.
- [ ] **CA-SET-09** — Nenhuma dependência nova; uma migration aditiva; README explica o encaminhamento.

## 8. Estratégia de testes

- **Unitários:** regra de quem encaminha; regra dos destinos; caso de uso com portas simuladas; mensagens de notificação; filtro de webhook com origem e destino.
- **Integração:** encaminhamento com os perfis certos e errados no banco (histórico, outbox, responsável removido, setor e nome atualizados); concorrência (`409`); leitura antes e depois; notificações; anonimização e "Meus dados"; rotas da API.
- **E2E:** o atendente encaminha pela tela para um segundo setor; o atendente do segundo setor a vê na fila com o histórico e as notas internas; o primeiro deixa de vê-la; o solicitante vê o novo setor.

## 9. Riscos

- **Leitura por setor espalhada:** filas, detalhe, comentários, documentos, painel e API decidem o acesso pelo setor atual. Mitigação: o encaminhamento só muda `sectorId`; os testes conferem a leitura antes e depois em cada tela principal.
- **Serviço de outro setor:** o novo setor atende um serviço que não é do seu catálogo. É intencional (o serviço é o que o solicitante pediu); a tela mostra o nome do serviço da abertura, como hoje.
- **Notas internas expostas ao novo setor:** decisão T5, explícita.

## 10. Tarefas (registradas em `TASKS.md`)

| ID | Tarefa |
|---|---|
| SF-120 | Migration e regras de quem encaminha e dos destinos |
| SF-121 | Caso de uso, tela, histórico, notificações, anonimização e "Meus dados" |
| SF-122 | API, OpenAPI e webhooks |
| SF-123 | E2E, README e revisão |

**Ordem:** SF-120 → SF-121 → SF-122 → SF-123.

## 11. Decisões tomadas (2026-11-03)

Funcionalidade aprovada pela responsável; decisões adotadas como recomendadas.

| # | Questão | Decisão | Alternativas |
|---|---|---|---|
| T1 | Em que status | Só aberta. Em atendimento, o setor já começou o fluxo (etapas do serviço) e voltar ao estado aberto mudaria status e etapas | Também em atendimento, voltando a aberta e limpando as etapas |
| T2 | Prazo e prioridade | Não mudam: o solicitante não deve perder prazo por um erro de encaminhamento | Recalcular o prazo a partir do encaminhamento |
| T3 | Aprovação pendente | Encaminhamento recusado até a decisão (a aprovação é dos gestores do setor atual) | Mover a aprovação pendente para os gestores do novo setor |
| T4 | Destinos | Setor ativo, diferente, com pelo menos um atendente ativo | Qualquer setor ativo |
| T5 | Notas internas | O novo setor vê todas, para continuar o atendimento | Esconder as notas do setor anterior |
| T6 | Webhooks filtrados | Evento de mudança vai aos webhooks da origem e do destino | Só ao do destino |
| T7 | Dados fictícios | Sem mudança: a demonstração tem um setor só; para mostrar, o administrador cria um setor e um atendente | Acrescentar um segundo setor e uma pessoa fictícia ao conjunto de demonstração |
