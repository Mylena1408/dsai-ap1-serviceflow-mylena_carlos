# SPEC — Ações de atendimento pela API e webhooks por setor

**Data:** 2026-11-03
**Status:** Aprovada em 2026-11-03: a responsável aprovou as funcionalidades 3 ("mudança de status, atribuição e cancelamento pela API") e 4 ("webhooks por setor e reenvio manual de entrega") da lista de pendências; as decisões W1 a W4 da seção 11 foram adotadas como recomendadas, e podem ser revistas por ela.
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-11-02-api-externa-webhooks.md` (seções 4 e 5; esta SPEC amplia o que lá ficou fora de escopo), `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md` (regras de atribuição, cancelamento e reabertura), `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (transições de status), `SPEC/2026-10-29-plano-escala-100k.md` (garantia 7.4)

## 1. Objetivo

A v1 da API só lê, abre solicitações e comenta. Um sistema de atendimento integrado não consegue iniciar, concluir, assumir, transferir ou cancelar. E todo webhook recebe os eventos da organização inteira, sem como receber só os de um setor, e uma entrega que falhou de vez não tem como ser enviada de novo. Esta SPEC acrescenta essas ações à API, com as mesmas regras da tela, e dá ao administrador o filtro por setor e o reenvio.

## 2. Registro da mudança de escopo

- A SPEC de API (seção 4) deixou fora "mudança de status, atribuição, etapas, prioridade, aprovação, cancelamento e reabertura pela API" e "filtro de webhook por setor ou serviço; reenvio manual de uma entrega". Esta SPEC traz status, atribuição, cancelamento e reabertura, o filtro por setor e o reenvio. **Continuam fora:** etapas, prioridade e aprovação pela API, e filtro de webhook por serviço.
- Nenhuma regra de negócio nova: as ações chamam os casos de uso da tela. Pela garantia 7.4, sem usar as rotas novas e sem marcar setores num webhook, tudo funciona como hoje (webhook sem setores marcados recebe de todos os setores, como agora).

## 3. Escopo

1. Rotas de ação na API (decisão W1).
2. Lista de para quem se pode transferir (W1).
3. Filtro opcional por setor em cada webhook (W2).
4. Reenvio de uma entrega encerrada sem sucesso (W3).
5. OpenAPI, auditoria e README atualizados.

## 4. Fora de escopo

- Etapas, prioridade e decisão de aprovação pela API.
- Filtro de webhook por serviço ou por categoria.
- Reenvio em lote; reenvio de entrega já entregue.
- Chave de idempotência (a repetição de uma ação já feita continua sendo `409 conflict`, como na tela).

## 5. Regras

### 5.1 Rotas de ação **(decisão W1)**

Todas exigem escopo `write` (`403 insufficient_scope` com token de leitura) e respondem `200` com o detalhe atualizado (o mesmo de `GET /api/v1/requests/{id}`).

| Método e caminho | Quem pode (regras da tela) | Corpo | Caso de uso |
|---|---|---|---|
| `POST /api/v1/requests/{id}/start` | Atendente do setor (o responsável, quando houver) | — | iniciar atendimento |
| `POST /api/v1/requests/{id}/complete` | Atendente do setor (o responsável, quando houver) | — | concluir |
| `POST /api/v1/requests/{id}/assume` | Atendente do setor, sem responsável efetivo | — | assumir |
| `POST /api/v1/requests/{id}/release` | O responsável (ou quem supervisiona a fila) | — | liberar |
| `POST /api/v1/requests/{id}/transfer` | O responsável (ou quem supervisiona a fila) | `{"assigneeId"}` | transferir |
| `GET /api/v1/requests/{id}/transfer-candidates` | Quem pode transferir | — | lista de atendentes ativos do setor (id e nome) |
| `POST /api/v1/requests/{id}/cancel` | Solicitante (só aberta) ou atendente do setor (com motivo) | `{"note"}` (obrigatório para o atendente) | cancelar |
| `POST /api/v1/requests/{id}/reopen` | Solicitante, até 7 dias depois da conclusão | `{"note"}` (obrigatório) | reabrir |

- O que a pessoa não pode ler é `404`; o que ela lê mas não pode fazer é `403 forbidden`; uma ação fora do estado (iniciar algo já iniciado, cancelar algo concluído) é `409 conflict`; motivo ausente ou longo demais é `400 invalid_request`.
- Cada ação grava o mesmo histórico, eventos da outbox e notificações da tela, e o processamento de eventos roda logo após a resposta.
- A aprovação pendente continua impedindo o início (`409`), como na tela.

### 5.2 Webhooks por setor **(decisão W2)**

- No cadastro e na edição, o administrador pode marcar setores. **Sem setor marcado, o webhook recebe de todos os setores** (como hoje).
- Com setores marcados, uma entrega só é registrada quando a solicitação do evento é de um desses setores (o setor gravado na abertura, como na fila).
- Setores inativos aparecem marcados com "(inativo)" e continuam valendo para solicitações antigas. Um setor inexistente é recusado.
- A lista de setores entra na auditoria do webhook (pelos nomes).

### 5.3 Reenvio **(decisão W3)**

- Na lista de entregas, uma entrega **falha** ou **cancelada** de um webhook **ativo** tem o botão "Reenviar".
- Reenviar põe a entrega de novo como pendente, com as tentativas zeradas e disponível na hora, e processa logo em seguida. O corpo e o identificador da entrega são os mesmos (o receptor reconhece a repetição pelo `ServiceFlow-Delivery`); a assinatura usa o segredo e o horário atuais.
- Entrega pendente ou entregue não pode ser reenviada (`conflito`). Webhook inativo também não.
- O reenvio é uma operação de acompanhamento, como o envio dos e-mails: não entra na auditoria.

### 5.4 Autorização

| Operação | Quem pode |
|---|---|
| Ações da seção 5.1 | O dono do token, com as regras da tela do seu perfil e as permissões dele |
| Marcar setores num webhook | Administrador |
| Reenviar entrega | Administrador |

## 6. Dados

Migration **aditiva**: `WebhookEndpoint.sectorIds` (lista de UUID, padrão vazia). Nenhuma outra tabela muda.

## 7. Critérios de aceitação

- [ ] **CA-ACT-01** — Sem usar as rotas novas e sem marcar setores, nada muda: suítes anteriores passam sem alteração de asserções; webhook antigo continua recebendo de todos os setores.
- [ ] **CA-ACT-02** — Iniciar, concluir, assumir, liberar e transferir pela API seguem as regras da tela (setor, responsável, supervisão, aprovação pendente) e gravam o mesmo histórico e os mesmos eventos.
- [ ] **CA-ACT-03** — Cancelar e reabrir pela API seguem as regras da tela (solicitante só com a aberta; atendente com motivo; reabrir em até 7 dias com motivo).
- [ ] **CA-ACT-04** — As respostas seguem o formato da v1: `403 insufficient_scope` com token de leitura, `404` para o que não se lê, `403 forbidden` para o que não se pode fazer, `409` fora do estado, `400` sem motivo; sucesso devolve o detalhe atualizado.
- [ ] **CA-ACT-05** — A lista de candidatos à transferência traz só atendentes ativos do setor, sem o responsável atual nem quem pede.
- [ ] **CA-ACT-06** — Webhook com setores marcados só recebe eventos de solicitações desses setores; sem setores, recebe de todos; setor inexistente é recusado; a mudança aparece na auditoria.
- [ ] **CA-ACT-07** — O administrador reenvia uma entrega falha ou cancelada de webhook ativo, que volta a pendente com as tentativas zeradas e é enviada com o mesmo identificador e assinatura válida; entrega pendente ou entregue, ou de webhook inativo, é recusada.
- [ ] **CA-ACT-08** — O OpenAPI descreve as rotas novas (o teste de correspondência continua passando); o README explica as ações e o filtro por setor.
- [ ] **CA-ACT-09** — Nenhuma dependência nova; uma migration aditiva.

## 8. Estratégia de testes

- **Unitários:** regra do filtro por setor; regra do reenvio; operações da API com os casos de uso simulados; OpenAPI.
- **Integração:** cada ação com os perfis certos e errados sobre o banco fictício (histórico e outbox); cancelar e reabrir; candidatos; consumidor com setores; reenvio com receptor HTTP local.
- **E2E:** um atendente com token assume, inicia e conclui pela API, e a tela mostra o histórico; o administrador marca um setor num webhook, e só os eventos desse setor chegam ao receptor; uma entrega falha é reenviada e chega.

## 9. Riscos

- **Ações em dobro por sistemas externos:** mitigação: as mesmas travas da tela (estado esperado na transação), com `409` na repetição.
- **Filtro por setor que esconde eventos sem querer:** mitigação: sem setores marcados o comportamento é o atual; a lista mostra os setores de cada webhook.
- **Reenvio de algo que o receptor já tratou:** mitigação: o mesmo `ServiceFlow-Delivery`, documentado para descartar repetições.

## 10. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-116 | Migration (`sectorIds`) e regras puras: filtro por setor e reenvio |
| SF-117 | Rotas de ação da API e candidatos à transferência, com OpenAPI |
| SF-118 | Webhooks por setor (cadastro, consumidor, auditoria) e reenvio |
| SF-119 | E2E e revisão |

**Ordem:** SF-116 → SF-117 → SF-118 → SF-119.

## 11. Decisões tomadas (2026-11-03)

Funcionalidades aprovadas pela responsável; decisões adotadas como recomendadas.

| # | Questão | Decisão | Alternativas |
|---|---|---|---|
| W1 | Formato das ações | Uma rota `POST` por ação (`/start`, `/complete`, `/assume`, `/release`, `/transfer`, `/cancel`, `/reopen`), devolvendo o detalhe atualizado | `PATCH` genérico do status; uma rota única com o nome da ação no corpo |
| W2 | Filtro do webhook | Lista opcional de setores; vazia = todos | Filtro obrigatório; filtro também por serviço |
| W3 | Reenvio | Uma entrega por vez, falha ou cancelada, de webhook ativo; mesmo corpo e identificador; fora da auditoria | Reenvio em lote; nova entrega com outro identificador |
| W4 | Repetição de ação | `409 conflict`, como na tela | Chave de idempotência |
