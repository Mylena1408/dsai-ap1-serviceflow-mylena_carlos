# SPEC — SLA e prioridades

**Data:** 2026-11-01
**Status:** Aprovada em 2026-11-01, com as decisões P1, S1, S2 e S3 da seção 11 conforme propostas (nenhum código implementado)
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-visao-geral.md` (§5 "prioridade" e "prazo"; §9 SLA), `SPEC/2026-10-29-plano-escala-100k.md` (item 5 e garantia 7.4), `SPEC/2026-10-31-eventos-outbox-jobs.md` (eventos, job diário e notificações), `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md`, `SPEC/2026-10-31-busca-filtros-paginacao.md`

## 1. Objetivo

Dar a cada solicitação uma **prioridade** e, quando o serviço tiver prazo configurado, um **prazo de atendimento**, com a situação visível ("dentro do prazo", "próximo do vencimento", "vencido") e alertas para a equipe.

## 2. Registro da mudança de escopo

"SLA, prazos de atendimento, alertas ou priorização" estavam fora da primeira entrega (SPEC principal, seções 5 e 19). O item 5 do plano de escala foi aceito em 2026-10-29, condicionado a esta SPEC. Pela garantia 7.4 do plano, **um serviço sem prazo configurado se comporta exatamente como hoje**.

## 3. Escopo

1. Prioridade da solicitação (Baixa, Normal, Alta, Urgente) e quem a define **(decisão P1)**.
2. Prazo por serviço, configurado pelo administrador, com ajuste pela prioridade **(decisão S2)**.
3. Cálculo do vencimento e da situação **(decisão S1)**.
4. Indicação na fila, nos detalhes e na lista do solicitante; filtro e ordenação por prazo na fila.
5. Alertas de "próximo do vencimento" e "vencido" como notificações **(decisão S3)**.

## 4. Fora de escopo

- Calendário de feriados e horários por setor.
- Pausa do prazo (por exemplo, "aguardando o solicitante").
- Relatórios e indicadores de cumprimento (item 11 do plano).
- E-mail ou outros canais de alerta.

## 5. Regras

### 5.1 Prioridade **(decisão P1)**

- Valores: `LOW` (Baixa), `NORMAL` (Normal), `HIGH` (Alta), `URGENT` (Urgente).
- O administrador define a **prioridade padrão do serviço** (padrão `NORMAL`). A solicitação nasce com ela.
- O **atendente do setor** (o responsável efetivo, se houver, como na regra 5.3 da SPEC de atribuição) pode mudar a prioridade de uma solicitação aberta ou em atendimento. A mudança fica no histórico e gera evento.
- O solicitante vê a prioridade, mas não a escolhe.

### 5.2 Prazo do serviço **(decisão S2)**

- O administrador pode definir, por serviço, um **prazo-base em horas** (1 a 2.000). Sem prazo, o serviço não tem SLA: nada de vencimento, situação ou alerta.
- O prazo efetivo depende da prioridade: Urgente = 25% do prazo-base, Alta = 50%, Normal = 100%, Baixa = 200% (arredondado para cima, em minutos).
- **Snapshot:** na abertura, a solicitação guarda o prazo-base vigente. Mudar o prazo do serviço depois não altera solicitações existentes.

### 5.3 Contagem do tempo **(decisão S1)**

- Horas corridas (24 horas por dia, 7 dias por semana), a partir da abertura, pelo relógio do banco.
- `vencimento = abertura + prazo efetivo`. Mudar a prioridade recalcula o vencimento a partir da **abertura** (não do momento da mudança).
- **Reabertura:** o vencimento é recalculado a partir do momento da reabertura, com o prazo efetivo da prioridade atual.
- *Interpretação registrada em 2026-11-01 (SF-067):* depois de uma reabertura, "a partir da abertura" significa a partir do **início do período atual de contagem** (a reabertura). Esse início é obtido como `vencimento atual − prazo efetivo da prioridade antiga`, sem coluna nova. Assim, mudar a prioridade de uma solicitação reaberta não volta a contar desde a abertura original.
- Solicitações concluídas ou canceladas param de contar e guardam o resultado: "concluída no prazo" ou "concluída com atraso" (cancelada não tem resultado).

### 5.4 Situação

| Situação | Condição (solicitação aberta ou em atendimento) |
|---|---|
| Dentro do prazo | Faltam mais de 20% do prazo efetivo |
| Próximo do vencimento | Faltam 20% ou menos, e o vencimento ainda não passou |
| Vencido | O vencimento passou |

A situação é **calculada na hora de exibir**, sempre exata. Ela não depende do job diário.

### 5.5 Alertas **(decisão S3)**

- O job diário verifica as solicitações abertas ou em atendimento e grava, **uma única vez por solicitação e situação**, os eventos `request.sla_warning` (entrou em "próximo do vencimento") e `request.sla_breached` (venceu). Os eventos viram notificações pelo mecanismo da SPEC de eventos.
- Destinatário: o **responsável efetivo**; sem responsável, **todos os atendentes ativos do setor**. A regra E4 (ninguém sem responsável) é exceção aqui, porque um prazo vencendo sem dono precisa de atenção.
- Limitação conhecida: no plano gratuito da Vercel o job roda **uma vez por dia**, então o alerta pode chegar com até um dia de atraso. A indicação na tela (5.4) é sempre exata.
- A reabertura ou a mudança de prioridade que empurre o vencimento para frente permite novo alerta.

### 5.6 Telas

- **Administração:** campos "Prioridade padrão" e "Prazo-base (horas)" no cadastro e na edição do serviço.
- **Fila:** prioridade e situação do prazo em cada item; filtro "Situação do prazo" (dentro, próximo, vencido, sem prazo); nova ordem "Vencimento mais próximo".
- **Detalhes:** prioridade, vencimento e situação para o atendente e o solicitante; para o atendente, um formulário para mudar a prioridade.
- **Lista do solicitante:** prioridade e situação.

### 5.7 Autorização

| Operação | Administrador | Solicitante | Atendente |
|---|---|---|---|
| Configurar prazo e prioridade padrão do serviço | Permitido | Negado | Negado |
| Mudar a prioridade de uma solicitação | Negado | Negado | Somente no setor atual, regra 5.1 |
| Ver prioridade, vencimento e situação | Negado (sem acesso a solicitações) | Somente as próprias | Somente no setor atual |

## 6. Dados (migration somente aditiva)

- `RequestPriority`: novo enum `LOW`, `NORMAL`, `HIGH`, `URGENT`.
- `Service`: `defaultPriority` (padrão `NORMAL`), `slaHours` (opcional, `CHECK` de 1 a 2.000).
- `Request`:
  - `priority` (padrão `NORMAL`);
  - `slaHoursSnapshot` (opcional);
  - `dueAt` (opcional);
  - `slaWarningNotifiedAt` e `slaBreachNotifiedAt` (opcionais, para não repetir alertas);
  - `completedLate` (opcional; preenchido na conclusão quando há prazo);
  - índice em `(sectorId, dueAt)`.
- `RequestStatusEvent` não muda. A mudança de prioridade fica numa nova tabela `RequestPriorityEvent` (`requestId`, `actorId`, `fromPriority`, `toPriority`, `occurredAt`) e aparece no histórico único.
- `OutboxEvent`: o `CHECK` de tipos passa a aceitar `request.priority_changed`, `request.sla_warning` e `request.sla_breached`.
- Solicitações existentes ficam com prioridade `NORMAL` e sem prazo.
- *Atualização registrada em 2026-11-01 (SF-068), também aditiva:* `Request.dueSoonAt` (opcional) guarda o instante em que a solicitação entra em "próximo do vencimento" (vencimento − 20% do prazo efetivo). O filtro da fila precisa dessa conta por linha, que o Prisma não expressa em filtros. Um trigger do banco preenche o campo em toda gravação de vencimento, prioridade ou prazo; a aplicação nunca o escreve. Índice em `(sectorId, dueSoonAt)`.
- *Regras do filtro (SF-068), iguais às da tela (5.4):* "dentro", "próximo" e "vencido" valem só para solicitações abertas ou em atendimento; "sem prazo" inclui as sem SLA e as canceladas; concluídas com SLA aparecem só sem filtro de situação, com o resultado "no prazo" ou "com atraso". A ordem "vencimento mais próximo" põe as sem prazo no fim, das mais antigas para as mais novas.

## 7. Critérios de aceitação

- [x] **CA-SLA-01** — Serviço sem prazo: a solicitação não tem vencimento, situação nem alerta, e todas as suítes anteriores passam sem alteração de asserções. *Verificado em 2026-11-01 (SF-066): serviço sem prazo abre e conclui sem vencimento nem resultado (unitário e integração); suítes anteriores sem alteração de asserções.*
- [x] **CA-SLA-02** — O administrador configura prioridade padrão e prazo-base do serviço; valores fora de 1 a 2.000 horas são rejeitados; outros perfis são negados. *Verificado em 2026-11-01 (SF-066): administrador configura; prazo fora de 1 a 2.000 horas, não inteiro ou prioridade desconhecida rejeitados; solicitante negado; formulário sem os campos mantém os valores e prazo vazio remove o SLA (integração e unitário das ações).*
- [x] **CA-SLA-03** — A solicitação nasce com a prioridade padrão e o snapshot do prazo; mudar o serviço depois não altera solicitações existentes. *Verificado em 2026-11-01 (SF-066): prioridade, prazo e vencimento gravados na abertura; mudar o serviço depois não altera a solicitação (integração).*
- [x] **CA-SLA-04** — O vencimento segue a tabela de percentuais por prioridade e é recalculado ao mudar a prioridade (a partir da abertura) e ao reabrir (a partir da reabertura). *Parte de reabertura verificada em 2026-11-01 (SF-066): novo vencimento a partir do horário da reabertura com a prioridade atual. A parte de mudança de prioridade é da SF-067.* *Verificado em 2026-11-01. Reabertura (SF-066): novo vencimento a partir da reabertura. Mudança de prioridade (SF-067): vencimento recalculado com o prazo efetivo da nova prioridade a partir do início do período atual (unitário e integração).*
- [x] **CA-SLA-05** — A situação segue a tabela 5.4 nas bordas (exatamente 20% restantes; exatamente no vencimento). *Verificado em 2026-11-01 (SF-065): situação nas bordas (1 ms antes dos 20% restantes, exatamente nos 20%, exatamente no vencimento e 1 ms depois) e janela da prioridade atual (`sla.test.ts`).*
- [x] **CA-SLA-06** — Só o atendente do setor (o responsável efetivo, se houver) muda a prioridade; a mudança aparece no histórico e gera evento. *Verificado em 2026-11-01 (SF-067): atendente do setor muda a prioridade; colega com responsável definido recebe conflito; outro setor e solicitante não encontram a solicitação; concluída e cancelada recusadas; prioridade igual rejeitada; histórico e evento na outbox (unitário e integração).*
- [ ] **CA-SLA-07** — O job diário gera no máximo um alerta de cada tipo por solicitação; o responsável recebe e, sem responsável, os atendentes ativos do setor.
- [x] **CA-SLA-08** — A conclusão registra "no prazo" ou "com atraso"; cancelada não tem resultado. *Verificado em 2026-11-01 (SF-066): "no prazo" exatamente no vencimento, "com atraso" 1 ms depois, sem resultado sem SLA (unitário); conclusão atrasada no banco (integração).*
- [x] **CA-SLA-09** — A fila filtra por situação do prazo e ordena por vencimento mais próximo, sem quebrar a busca e a paginação existentes. *Verificado em 2026-11-01 (SF-068): filtro por situação com as mesmas regras da tela, ordem por vencimento com as sem prazo no fim, combinação com busca, status e páginas, parâmetros ignorados ou recusados na lista do solicitante (integração e unitário); suítes de busca anteriores sem alteração de asserções.*
- [x] **CA-SLA-10** — Migration aditiva; solicitações existentes ficam `NORMAL` e sem prazo. *Verificado em 2026-11-01 (SF-065): migration aplicada sobre dados existentes; serviços e solicitações ficam `NORMAL` e sem prazo (`sla-schema.test.ts`); suítes anteriores sem alteração de asserções.*

## 8. Estratégia de testes

- **Unitários:** cálculo do prazo efetivo e do vencimento; situação nas bordas; regras de quem muda a prioridade; seleção de alertas.
- **Integração:** snapshot na abertura; mudança de prioridade com evento e histórico; reabertura; job diário com alertas únicos; filtro e ordem por vencimento.
- **E2E:** administrador configura um prazo curto; solicitante abre; atendente vê a situação e muda a prioridade; o vencimento muda.

## 9. Riscos

- **Alertas diários** (plano Hobby): mitigado pela indicação exata na tela.
- **Horas corridas** podem parecer injustas em fins de semana; o calendário comercial fica para uma SPEC futura (decisão S1: horas corridas).
- **Mais colunas em `Request`:** todas opcionais ou com padrão; nenhuma consulta existente muda de resultado.

## 10. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-065 | Migration e domínio (prioridade, prazo efetivo, vencimento, situação) |
| SF-066 | Configuração no serviço e snapshot na abertura; conclusão no prazo/com atraso; reabertura |
| SF-067 | Mudança de prioridade (caso de uso, histórico, evento) |
| SF-068 | Telas: indicação, filtro e ordem por vencimento na fila |
| SF-069 | Alertas no job diário e notificações |
| SF-070 | E2E e revisão |

## 11. Decisões tomadas (2026-11-01)

Decisões da responsável pelo projeto: **todas as propostas aceitas**.

| # | Questão | Decisão | Alternativas descartadas |
|---|---|---|---|
| P1 | Quem define a prioridade | Padrão do serviço; o atendente do setor pode mudar | O solicitante escolhe na abertura; ou só o padrão do serviço |
| S1 | Como contar o tempo | Horas corridas (24x7) | Horário comercial, segunda a sexta, 8h–18h, sem feriados |
| S2 | De onde vem o prazo | Prazo-base do serviço ajustado pela prioridade (25/50/100/200%) | Só o prazo do serviço (a prioridade apenas ordena a fila) |
| S3 | Alertas | Responsável; sem responsável, todos os atendentes do setor | Só o responsável; ou nenhum alerta, só a indicação na tela |
