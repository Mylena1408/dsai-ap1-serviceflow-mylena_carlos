# SPEC — Pausa do prazo e calendário de horas úteis

**Data:** 2026-11-03
**Status:** Aprovada em 2026-11-03: a responsável aprovou a funcionalidade 7 ("pausa do SLA e calendário de dias úteis") da lista de pendências; as decisões H1 a H9 da seção 11 foram adotadas como recomendadas, e podem ser revistas por ela.
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-11-01-sla-prioridades.md` (seção 4: "calendário de feriados" e "pausa do prazo" fora de escopo; decisão S1, horas corridas; regras 5.2 a 5.5), `SPEC/2026-11-01-aprovacoes.md` (prazo a partir da aprovação), `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md` (responsável efetivo, liberação, reabertura), `SPEC/2026-11-01-permissoes-configuraveis.md` (supervisão da fila), `SPEC/2026-10-31-comentarios.md`, `SPEC/2026-11-03-anexos-comentarios-documentos.md` (documento depois da abertura), `SPEC/2026-11-02-auditoria-lgpd.md`, `SPEC/2026-11-02-painel-relatorios.md`, `SPEC/2026-11-03-api-acoes-webhooks-setor.md`

## 1. Objetivo

Tornar o prazo de atendimento mais justo em dois pontos que a SPEC de SLA deixou de fora:

1. **Calendário de horas úteis:** um serviço pode contar o prazo só nos dias e horários de expediente da organização, descontando feriados cadastrados.
2. **Pausa do prazo:** enquanto o atendimento espera uma resposta do solicitante, o prazo para de correr e volta a correr quando ele responde.

## 2. Registro da mudança de escopo

A SPEC de SLA (seção 4) deixou de fora "calendário de feriados e horários por setor" e "pausa do prazo (por exemplo, 'aguardando o solicitante')", e registrou na seção 9 que o calendário comercial ficaria para uma SPEC futura. Esta é essa SPEC. Pela garantia 7.4 do plano de escala, **um serviço que continua em horas corridas e uma solicitação que nunca é pausada se comportam exatamente como hoje**.

## 3. Escopo

1. Calendário da organização (dias da semana, horário de expediente, fuso) e feriados, na administração **(decisões H1 e H4)**.
2. Opção por serviço: prazo em horas corridas (como hoje) ou em horas úteis, guardada na abertura **(decisões H2 e H3)**.
3. Pausa do prazo "aguardando o solicitante" pelo atendimento, com motivo, e retomada manual ou automática **(decisões H5 a H7)**.
4. Situação "Prazo pausado" nas telas, no filtro da fila, no painel, no CSV e na API.
5. Histórico, eventos `request.sla_paused` e `request.sla_resumed`, notificação ao solicitante e webhooks **(decisão H8)**.
6. Ações de pausar e retomar pela API.
7. Auditoria do calendário; anonimização e "Meus dados" com as pausas.

## 4. Fora de escopo

- Calendário ou horário **por setor** e mais de uma janela por dia (por exemplo, intervalo de almoço) (decisão H1).
- Recalcular prazos já gravados quando o calendário muda (decisão H3).
- Outros motivos de pausa além de "aguardando o solicitante", e pausa de solicitação aberta (decisão H5).
- Pausa automática (por exemplo, ao pedir algo num comentário): a pausa é sempre uma ação do atendimento.
- Feriados carregados automaticamente de uma fonte externa.
- Dados fictícios novos (decisão H9).

## 5. Regras

### 5.1 Calendário **(decisões H1 e H4)**

1. Existe **um** calendário para a organização, com:
   - **dias de expediente:** um ou mais dias da semana (padrão: segunda a sexta);
   - **horário:** uma janela por dia, início e fim no formato `HH:MM`, com o início antes do fim (padrão: 08:00 às 18:00);
   - **fuso horário:** um identificador IANA válido (padrão: `America/Sao_Paulo`, o mesmo dos filtros por data).
2. **Feriados:** data, nome (1 a 80 caracteres depois de tirar espaços das pontas) e se **repete todo ano** (mesmo dia e mês; um feriado anual em 29/02 só cai em anos bissextos). Não pode haver dois feriados na mesma data. Feriados podem ser cadastrados e removidos; a remoção apaga o cadastro.
3. Em dia de feriado não há expediente, mesmo que seja dia de expediente da semana.
4. Só o administrador configura o calendário e os feriados. Cada alteração e cada feriado criado ou removido entra na auditoria (seção 5.9).

### 5.2 Prazo em horas úteis **(decisões H2 e H3)**

1. O serviço ganha a opção **"Contagem do prazo"**: "Horas corridas" (padrão; é o comportamento atual) ou "Horas úteis (calendário)". A opção só tem efeito em serviço com prazo-base.
2. Na abertura, a solicitação guarda a opção do serviço, como já guarda o prazo-base. Mudar a opção do serviço depois não altera solicitações existentes.
3. Em horas úteis, só conta o tempo dentro da janela de expediente, em dias de expediente que não sejam feriado, no fuso do calendário. O prazo efetivo em minutos (prazo-base × fator da prioridade) não muda; muda só o relógio.
   - Exemplo: expediente de segunda a sexta, 08:00–18:00. Prazo efetivo de 4 horas aberto numa sexta às 16:00: conta 2 horas na sexta e vence na segunda às 10:00.
   - Aberta fora do expediente, a contagem começa na abertura seguinte da janela.
   - O vencimento cai sempre dentro de uma janela ou no fim dela.
4. **"Próximo do vencimento"** continua sendo "faltam 20% ou menos do prazo efetivo" (SPEC de SLA, 5.4), medido no relógio da solicitação. Em horas úteis, o tempo restante conta só o expediente.
5. Os mesmos cálculos de hoje usam o relógio da solicitação: abertura, aprovação, mudança de prioridade (a partir do início do período atual, como a interpretação da SF-067), reabertura e retomada da pausa (5.4). A conclusão continua comparando o horário da conclusão com o vencimento.
6. Mudar o calendário ou os feriados **não recalcula** vencimentos já gravados. A configuração nova vale para os próximos cálculos de qualquer solicitação em horas úteis (decisão H3).

### 5.3 Pausar o prazo **(decisões H5 e H7)**

1. Só existe um tipo de pausa: **"aguardando o solicitante"**, com **motivo obrigatório** de 1 a 500 caracteres depois de tirar espaços das pontas (por exemplo, "Precisamos do número do patrimônio").
2. A solicitação precisa estar **em atendimento**, ter prazo (SLA), não estar pausada e **não estar vencida**. Caso contrário: `409`.
3. Pode pausar o **responsável efetivo**; quem tem a permissão **Supervisionar a fila do setor** pode pausar também a de um colega. Atendente do setor sem esse direito recebe `409`; quem não é atendente do setor recebe `404`, como nas outras ações.
4. Enquanto pausada:
   - a situação é **"Prazo pausado"**, e não "dentro do prazo", "próximo" ou "vencido";
   - nenhum alerta de prazo é gerado;
   - o solicitante vê o motivo e o aviso de que, ao responder com um comentário, o prazo volta a contar.
5. Pausar não muda status, responsável, etapa nem prioridade.

### 5.4 Retomar o prazo **(decisão H6)**

1. **Manual:** quem pode pausar (5.3, regra 3) pode retomar uma solicitação pausada.
2. **Automática pela resposta:** quando o **solicitante** grava um comentário (comentário público, com ou sem arquivos) ou envia um documento depois da abertura, o prazo é retomado na mesma transação.
3. **Fim do atendimento:** concluir, cancelar ou liberar a solicitação (voltar para "Aberta") encerra a pausa no mesmo momento, antes de calcular o resultado da conclusão.
4. **O tempo pausado não conta.** O tempo que faltava no momento da pausa, medido no relógio da solicitação, volta a faltar a partir da retomada:
   - em horas corridas, o vencimento avança exatamente a duração da pausa;
   - em horas úteis, o vencimento avança o expediente que houve durante a pausa.
5. As marcas de alerta já enviadas continuam como estão: o que faltava na pausa é o que falta na retomada.
6. Mudar a prioridade de uma solicitação pausada é permitido; o vencimento é recalculado como hoje e a pausa continua.
7. Transferir para outro atendente e mudar de etapa não mexem na pausa.

### 5.5 Histórico

- "Prazo pausado: aguardando o solicitante", com quem pausou, a data e "Motivo: …".
- "Prazo retomado", com a data e a causa: "por *Fulano*" (manual), "pela resposta do solicitante" ou "com o fim do atendimento".

### 5.6 Notificações e e-mail **(decisão H8)**

1. O solicitante recebe "Aguardando sua resposta: *serviço*" (tipo `sla.paused`, categoria de e-mail "status").
2. A retomada não gera notificação; a resposta do solicitante já notifica o responsável pela regra dos comentários.

### 5.7 Telas

- **Administração, "Calendário":** dias de expediente (caixas de seleção), início e fim do expediente, fuso horário e a lista de feriados, com cadastro (data, nome, "repete todo ano") e remoção.
- **Serviço (cadastro e edição):** "Contagem do prazo" (horas corridas ou horas úteis); a lista de serviços mostra "horas úteis" ao lado do prazo quando escolhido.
- **Fila e detalhe do atendente:** situação "Prazo pausado"; no detalhe, para quem pode pausar, o formulário "Pausar prazo (aguardando o solicitante)" com o motivo e, quando pausada, o botão "Retomar prazo". O filtro "Situação do prazo" ganha "Pausado". Solicitações em horas úteis mostram "(horas úteis)" junto do vencimento.
- **Solicitante:** situação "Prazo pausado", o motivo e o aviso da regra 5.3.4.
- **Painel:** a contagem atual ganha "Prazo pausado", e as pausadas deixam de contar em "próximo do vencimento" e "vencido".
- **CSV:** a coluna de situação do prazo pode trazer "Prazo pausado".

### 5.8 API, webhooks e eventos

1. Eventos de domínio `request.sla_paused` (`pauseId`, `actorId`) e `request.sla_resumed` (`pauseId`, `actorId`, `cause`: `manual`, `requester_reply` ou `attendance_ended`), só com identificadores.
2. Webhooks: novos eventos "Prazo pausado" e "Prazo retomado", com o filtro por setor de sempre.
3. Detalhe da API:
   - `slaSituation` passa a aceitar `paused`;
   - campos novos `slaBusinessHours` e `slaPausedAt`;
   - `history.pauses`, com motivo, quem pausou, datas e causa da retomada.
4. O filtro `sla` aceita `paused` onde já é aceito.
5. `POST /api/v1/requests/{id}/pause-sla` (escopo `WRITE`): corpo `{"reason"}`, estrito.
6. `POST /api/v1/requests/{id}/resume-sla` (escopo `WRITE`): corpo vazio `{}`.
7. As duas rotas respondem `200` com o detalhe, com os códigos da tela (5.3).
8. O OpenAPI descreve tudo.

### 5.9 Auditoria, anonimização e "Meus dados"

1. **Auditoria:** "Calendário alterado" registra os campos alterados, com valor anterior e novo. Também entram "Feriado cadastrado" e "Feriado removido", com data e nome. A opção "Contagem do prazo" do serviço entra como os outros campos do serviço.
2. **Anonimização:** o motivo da pausa é texto escrito pela pessoa e é substituído por "[conteúdo removido na anonimização]".
3. **"Meus dados":** nas solicitações que a pessoa abriu, aparecem as pausas (motivo, quem pausou, quando e a retomada). O modelo é o mesmo dos encaminhamentos.

### 5.10 Autorização (complementa a SPEC de SLA, 5.7)

| Operação | Administrador | Solicitante | Atendente |
|---|---|---|---|
| Configurar calendário e feriados | Permitido | Negado | Negado |
| Escolher a contagem do prazo do serviço | Permitido (e quem gere serviços do setor, como os outros campos) | Negado | Negado |
| Pausar e retomar o prazo | Negado | Negado (retoma só respondendo, 5.4.2) | Regra 5.3.3 |
| Ver a pausa e o motivo | Negado (sem acesso a solicitações) | Somente as próprias | Somente no setor atual |

## 6. Dados

Migration aditiva:

- **`BusinessCalendar`**, linha única (`id = 1`):
  - campos `weekdays` (dias ISO, 1 = segunda a 7 = domingo, de 1 a 7 valores entre 1 e 7), `startMinute` e `endMinute` (0 ≤ início < fim ≤ 1440), `timeZone` (texto não vazio), `updatedAt`, `updatedById` (opcional);
  - a migration cria a linha com o padrão da regra 5.1.
- **`BusinessHoliday`:** `id`, `day` (data, única), `name` (1 a 80, sem espaços nas pontas), `yearly`, `createdAt`, `createdById`.
- **Colunas novas:**
  - `Service.slaBusinessHours` (padrão falso);
  - `Request.slaBusinessHours` (padrão falso, cópia da abertura);
  - `Request.slaPausedAt` (opcional; só com solicitação em atendimento e com prazo).
- **`RequestSlaPause`:**
  - campos `id`, `requestId`, `pausedById`, `reason` (1 a 500, sem espaços nas pontas), `pausedAt`, `resumedAt`, `resumedById`, `resumeCause` (`MANUAL`, `REQUESTER_REPLY`, `ATTENDANCE_ENDED`);
  - a retomada tem as três colunas preenchidas juntas, ou nenhuma;
  - a retomada não é anterior à pausa;
  - no máximo uma pausa aberta por solicitação (índice único parcial);
  - índice por `requestId`.
- **`dueSoonAt`:** o trigger `request_due_soon_at` continua calculando o valor para horas corridas. Para solicitação em horas úteis, ele mantém o valor gravado pela aplicação, porque a conta depende do calendário. A função é recriada (único ponto que substitui algo, sem perda de dados).
- **Restrições recriadas mais amplas, sem perda de dados:**
  - `OutboxEvent.type` e `WebhookEndpoint.eventTypes` aceitam `request.sla_paused` e `request.sla_resumed`;
  - a auditoria ganha os tipos de entidade `BUSINESS_CALENDAR` e `HOLIDAY` e a ação `DELETED`.
- Serviços e solicitações existentes ficam em horas corridas e sem pausa.

Nenhuma dependência nova: as contas de fuso usam `Intl`, como os filtros por data.

## 7. Critérios de aceitação

- [ ] **CA-PSL-01** — Sem calendário escolhido e sem pausa, nada muda: suítes anteriores passam (as listas que enumeram todos os tipos de evento, notificação ou situação são estendidas, como nas SPECs anteriores).
- [ ] **CA-PSL-02** — O administrador configura dias, horário e fuso e cadastra e remove feriados; valores inválidos são recusados (nenhum dia, início não anterior ao fim, fuso desconhecido, data repetida, nome vazio); outros perfis são negados; cada mudança entra na auditoria.
- [ ] **CA-PSL-03** — Em horas úteis, o vencimento pula noites, dias sem expediente e feriados (inclusive anuais), na abertura, na aprovação, na mudança de prioridade e na reabertura; o "próximo do vencimento" usa 20% medidos no expediente; serviço em horas corridas calcula como antes.
- [ ] **CA-PSL-04** — Mudar o calendário ou a opção do serviço não altera vencimentos já gravados.
- [ ] **CA-PSL-05** — O responsável (ou o supervisor) pausa uma solicitação em atendimento com prazo, com motivo; são recusadas: sem motivo (`400`), aberta, concluída, sem prazo, já pausada ou vencida (`409`), colega sem direito (`409`), outro setor (`404`).
- [ ] **CA-PSL-06** — Pausada, a situação é "Prazo pausado" nas telas, no filtro, no painel, no CSV e na API, e o job não gera alerta.
- [ ] **CA-PSL-07** — A retomada manual, o comentário ou documento do solicitante e o fim do atendimento encerram a pausa; o vencimento avança o tempo pausado no relógio da solicitação; a conclusão de uma pausada não fica atrasada pelo tempo pausado.
- [ ] **CA-PSL-08** — O histórico mostra pausa e retomada com a causa; o solicitante recebe "Aguardando sua resposta"; os webhooks recebem os dois eventos só com identificadores.
- [ ] **CA-PSL-09** — A API pausa e retoma com as mesmas regras e mostra a situação, a pausa e o histórico; o OpenAPI descreve as rotas.
- [ ] **CA-PSL-10** — A anonimização substitui o motivo; "Meus dados" inclui as pausas das solicitações da pessoa.
- [ ] **CA-PSL-11** — Nenhuma dependência nova; uma migration aditiva (com as restrições e o trigger recriados mais amplos); README explica o calendário e a pausa.

## 8. Estratégia de testes

- **Unitários:**
  - relógio de horas úteis: somar tempo e medir intervalos, com início fora do expediente, virada de semana, feriado simples e anual, 29/02, fuso diferente e janela que termina à meia-noite;
  - vencimento e "próximo do vencimento" nos dois relógios;
  - regras de quem pausa e retoma;
  - deslocamento do vencimento na retomada;
  - validação do calendário e dos feriados;
  - casos de uso com portas simuladas.
- **Integração:**
  - calendário e feriados no banco, com auditoria;
  - abertura, aprovação, prioridade e reabertura em horas úteis;
  - trigger nos dois relógios;
  - pausa e retomada, inclusive por comentário, por documento e por conclusão;
  - concorrência (`409`);
  - filtro da fila e painel;
  - alertas pulando pausadas;
  - notificações, webhooks, anonimização, "Meus dados" e rotas da API.
- **E2E:**
  1. O administrador cadastra um feriado e põe um serviço em horas úteis.
  2. O solicitante abre e o atendente assume.
  3. O atendente pausa com motivo.
  4. O solicitante vê "Prazo pausado" com o motivo e responde.
  5. O atendente vê o prazo retomado no histórico.

## 9. Riscos

- **Conta de horas úteis lenta em configurações extremas** (um dia por semana, janela curta, prazo longo): o cálculo anda dia a dia, com no máximo 20 anos de procura. Configurações reais terminam em poucos dias.
- **Dois relógios para o "próximo do vencimento":**
  - o trigger cuida das horas corridas, e a aplicação grava o valor das horas úteis em todos os caminhos que gravam o vencimento;
  - mitigação: uma função de domínio única devolve vencimento e "próximo" juntos, e um teste de integração compara o banco com a regra nos dois relógios.
- **Pausa usada para esconder atraso:** mitigada pela regra 5.3.2 (vencida não pausa) e pelo histórico.
- **Mudança de calendário com solicitações em andamento:** decisão H3. O vencimento gravado não muda, mas a próxima retomada ou mudança de prioridade usa o calendário novo.

## 10. Tarefas (registradas em `TASKS.md`)

| ID | Tarefa |
|---|---|
| SF-128 | Migration; relógio de horas úteis; regras do calendário e da pausa (domínio) |
| SF-129 | Calendário na administração com auditoria; opção do serviço; horas úteis na abertura, aprovação, prioridade e reabertura |
| SF-130 | Pausa e retomada (caso de uso, tela, retomada automática, fim do atendimento, histórico, notificação, alertas, filtro, painel, CSV, anonimização e "Meus dados") |
| SF-131 | API, OpenAPI e webhooks |
| SF-132 | E2E, README e revisão |

**Ordem:** SF-128 → SF-129 → SF-130 → SF-131 → SF-132.

## 11. Decisões tomadas (2026-11-03)

Funcionalidade aprovada pela responsável; decisões adotadas como recomendadas.

| # | Questão | Decisão | Alternativas |
|---|---|---|---|
| H1 | Forma do calendário | Um calendário da organização: dias da semana, uma janela de horário por dia e feriados | Dias úteis inteiros (24 h nos dias de expediente); calendário por setor; várias janelas por dia |
| H2 | Quem usa o calendário | Opção por serviço, padrão horas corridas; cópia na abertura | Calendário obrigatório para todos os serviços com prazo |
| H3 | Mudança do calendário | Não recalcula vencimentos gravados; vale para os próximos cálculos | Recalcular todas as solicitações em andamento |
| H4 | Fuso | Configurável, padrão `America/Sao_Paulo` | Fixo |
| H5 | Tipo de pausa | Só "aguardando o solicitante", com motivo, em atendimento, pelo responsável ou supervisor | Motivos livres; pausar também solicitação aberta |
| H6 | Retomada | Manual, automática pela resposta do solicitante (comentário ou documento) e no fim do atendimento | Só manual |
| H7 | Pausa de solicitação vencida | Recusada, para a pausa não esconder atraso | Permitida, mantendo o atraso |
| H8 | Avisos | O solicitante é notificado da pausa; webhooks para pausa e retomada | Sem notificação; sem webhooks |
| H9 | Dados fictícios | Sem mudança: o calendário nasce com o padrão e sem feriados, e os serviços da demonstração continuam em horas corridas | Feriados nacionais e um serviço em horas úteis na demonstração |
