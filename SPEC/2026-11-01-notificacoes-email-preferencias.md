# SPEC — Notificações por e-mail e preferências

**Data:** 2026-11-01
**Status:** Aprovada em 2026-11-01, com as decisões N1 a N5 da seção 11 conforme propostas.
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-visao-geral.md` (§11 Notificações), `SPEC/2026-10-31-eventos-outbox-jobs.md` (seções 6 a 8; e-mail fora de escopo), `SPEC/2026-11-01-sla-prioridades.md` (5.5), `SPEC/2026-11-01-fluxos-configuraveis.md`, `SPEC/2026-11-01-aprovacoes.md` (5.6), `SPEC/2026-10-29-plano-escala-100k.md` (item 10, garantia 7.4 e risco "dependências novas"), `SPEC/2026-11-01-relatorio-fase-3.md` (seção 8)

## 1. Objetivo

Hoje as notificações existem só dentro da aplicação: quem não abre o ServiceFlow não fica sabendo de uma transferência, de um prazo vencendo ou de uma aprovação pendente. Esta SPEC permite que cada pessoa **escolha receber por e-mail** as notificações que já existem, por categoria, e dá ao administrador uma forma de acompanhar os envios.

## 2. Registro da mudança de escopo

A SPEC de eventos (2026-10-31) autorizou só notificações na aplicação e deixou e-mail para "a SPEC completa de notificações", porque exige conta e credenciais de um provedor. O plano de escala (item 10) previu "na aplicação e por e-mail, com preferências". Pela garantia 7.4, **sem nenhuma preferência ligada, o sistema se comporta exatamente como hoje**: as notificações na aplicação, seus destinatários e seus textos não mudam.

## 3. Escopo

1. Preferências de e-mail por pessoa e por categoria de notificação **(decisão N1)**.
2. Registro de cada e-mail a enviar, criado junto da notificação na aplicação **(decisão N2)**.
3. Envio por um provedor configurado só por variáveis de ambiente, com novas tentativas **(decisão N3)**.
4. Conteúdo mínimo do e-mail, sem dados sensíveis da solicitação **(decisão N4)**.
5. Acompanhamento dos envios pelo administrador **(decisão N5)**.

## 4. Fora de escopo

- Desligar notificações **na aplicação** (elas continuam sempre ligadas).
- Novos tipos de notificação ou novos destinatários (as regras de `recipients.ts` não mudam).
- Resumo diário ou agrupamento de e-mails; e-mail em HTML com layout; anexos.
- SMS, push, Slack e outros canais.
- Cancelamento de inscrição em um clique (`List-Unsubscribe`), tratamento de devoluções (*bounces*) e verificação do endereço de e-mail.
- Preferências definidas pelo administrador para outras pessoas.

## 5. Regras

### 5.1 Categorias e preferências **(decisão N1)**

| Categoria | Nome na tela | Tipos de notificação |
|---|---|---|
| `STATUS` | Mudanças de status | `status.IN_PROGRESS`, `status.COMPLETED`, `status.CANCELLED`, `status.OPEN` |
| `ASSIGNMENT` | Solicitações transferidas para você | `assignment.received` |
| `COMMENTS` | Comentários e notas internas | `comment.public`, `comment.internal` |
| `SLA` | Prazos próximos e vencidos | `sla.warning`, `sla.breached` |
| `STAGES` | Mudanças de etapa | `stage.changed` |
| `APPROVALS` | Aprovações | `approval.requested`, `approval.approved`, `approval.rejected` |

1. Cada pessoa liga ou desliga o e-mail **por categoria**, na página "Preferências de notificação", ligada à página de notificações de cada área (solicitante, atendente e gestor). Só a própria pessoa altera as suas preferências; a verificação é feita no servidor.
2. **Tudo começa desligado.** Ninguém recebe e-mail sem ter escolhido.
3. Um tipo de notificação novo, criado por uma SPEC futura, precisa entrar numa categoria; o teste da tabela falha se algum tipo ficar sem categoria.

### 5.2 Registro dos envios **(decisão N2)**

1. Quando o consumidor de notificações cria uma notificação na aplicação, ele cria também, **na mesma operação**, um registro de envio por e-mail se a categoria daquele tipo estiver ligada para a pessoa naquele momento.
2. Um registro por notificação, no máximo: reprocessar o mesmo evento não duplica e-mails (mesma garantia de idempotência das notificações).
3. Mudar a preferência depois não altera envios já registrados; vale para as notificações seguintes.
4. Situações do envio: **pendente**, **enviado**, **falhou** (após a última tentativa) e **não enviado** (e-mail não configurado, ou a pessoa ficou inativa antes do envio).

### 5.3 Envio **(decisão N3)**

1. O envio fica atrás de uma porta (`EmailTransport`) com uma implementação para a API HTTP de um provedor, chamada com `fetch` (**sem dependência nova**), e configurada só por variáveis de ambiente: `EMAIL_API_KEY`, `EMAIL_FROM` e `APP_BASE_URL`. **Nenhum valor real entra no repositório**; o `.env.example` traz as variáveis comentadas e vazias.
2. Sem configuração completa, nada é enviado: os registros ficam como "não enviado — e-mail não configurado" e não são tentados de novo.
3. Os envios pendentes são processados logo após a resposta (como os eventos hoje) e pelo job diário. Uma falha agenda nova tentativa com as mesmas regras de espera e de limite de tentativas dos eventos, guardando só o código do erro, nunca a resposta do provedor nem o endereço.
4. O endereço usado é o e-mail **atual** da pessoa no momento do envio.
5. Os testes nunca chamam um provedor real: usam uma implementação em memória da porta.

### 5.4 Conteúdo **(decisão N4)**

- **Assunto:** `[ServiceFlow] <texto da notificação> — <nome do serviço>` (o mesmo texto da lista de notificações).
- **Corpo, só em texto:** o texto da notificação, o serviço, o código curto da solicitação, o link para abri-la na área da pessoa e, no fim, o link para as preferências.
- **Nunca inclui:** descrição da solicitação, texto de comentários ou notas internas, respostas de campos, documentos ou observações de aprovação. Quem quiser os detalhes entra no sistema, onde as regras de leitura de cada perfil continuam valendo.

### 5.5 Acompanhamento pelo administrador **(decisão N5)**

A administração ganha a seção "E-mails", só para o administrador, com:

- se o envio está configurado ou não (sem mostrar nenhum valor das variáveis);
- os 50 envios mais recentes: destinatário, tipo, situação, tentativas, data de criação e de envio e código do último erro. **Sem o conteúdo** do e-mail.

### 5.6 Autorização (complementa as SPECs anteriores)

| Operação | Quem pode |
|---|---|
| Ver e alterar preferências de e-mail | A própria pessoa (solicitante, atendente ou gestor), só as suas |
| Ver o acompanhamento de envios | Só o administrador |
| Disparar o envio | Só o servidor (após a resposta e no job diário protegido por `CRON_SECRET`) |

## 6. Dados (migration somente aditiva)

- Novo enum `NotificationCategory` (as seis categorias da tabela 5.1) e novo enum `EmailDeliveryStatus` (`PENDING`, `SENT`, `FAILED`, `SKIPPED`).
- Nova tabela `NotificationPreference` (`userId`, `category`, `emailEnabled`, `updatedAt`), única em (`userId`, `category`). Sem linha, a categoria está desligada.
- Nova tabela `EmailDelivery` (`notificationId` único, `recipientId`, `status`, `attempts`, `availableAt`, `createdAt`, `sentAt`, `lastErrorCode`), com índice para buscar os pendentes.
- Nenhuma tabela existente muda.

## 7. Critérios de aceitação

- [ ] **CA-MAIL-01** — Sem preferências ligadas, as notificações na aplicação, seus destinatários e textos não mudam, nenhum envio é registrado, e as suítes anteriores passam sem alteração de asserções.
- [x] **CA-MAIL-02** — Todo tipo de notificação pertence a exatamente uma categoria da tabela 5.1. *Verificado em 2026-11-01 (SF-092): a tabela de categorias é indexada por todos os tipos de notificação (um tipo novo sem categoria quebra o typecheck), e o teste unitário confere as seis categorias com os tipos da tabela 5.1, cada tipo em exatamente uma.*
- [x] **CA-MAIL-03** — Cada pessoa vê e altera só as próprias preferências, por categoria; tudo começa desligado; o administrador e outras pessoas não alteram as de ninguém. *Verificado em 2026-11-01 (SF-093): solicitante, atendente e gestor começam com as seis categorias desligadas, ligam e desligam por categoria e só alteram as próprias (nenhuma entrada indica o usuário; um `userId` no pedido é recusado); o administrador é recusado; categorias desconhecidas são recusadas (unitário dos casos de uso e da ação, integração e navegador).*
- [ ] **CA-MAIL-04** — Com a categoria ligada, cada notificação na aplicação daquela categoria gera um registro de envio, na mesma operação; reprocessar o evento não duplica; categorias desligadas não geram registro.
- [ ] **CA-MAIL-05** — Mudar a preferência não altera envios já registrados.
- [ ] **CA-MAIL-06** — Com o envio configurado, os pendentes são enviados ao e-mail atual da pessoa e marcados como enviados; falhas são tentadas de novo com espera crescente e marcadas como falhas após o limite, guardando só o código do erro.
- [ ] **CA-MAIL-07** — Sem configuração, ou com a pessoa inativa, o envio fica "não enviado" e não é tentado de novo; nenhum valor de configuração aparece em telas, registros ou logs.
- [ ] **CA-MAIL-08** — O e-mail tem assunto e corpo da seção 5.4, com o link para a solicitação na área da pessoa e o link para as preferências, e nunca inclui descrição, comentários, notas internas, respostas, documentos ou observações.
- [ ] **CA-MAIL-09** — Só o administrador vê a seção "E-mails", com a situação da configuração e os 50 envios mais recentes, sem conteúdo.
- [x] **CA-MAIL-10** — Migration aditiva; dados existentes não mudam. *Verificado em 2026-11-01 (SF-092): migration só com criações (dois enums, duas tabelas, índices e chaves); ninguém começa com preferência ou envio; uma preferência por pessoa e categoria e um envio por notificação (`email-notification-schema.test.ts`); suítes anteriores sem alteração de asserções.*

## 8. Estratégia de testes

- **Unitários:** tabela de categorias (todo tipo com categoria); regra de criação do registro; montagem do assunto e do corpo (inclusive o que nunca entra); processamento dos pendentes com a porta em memória (envio, nova tentativa, falha, não configurado, pessoa inativa).
- **Integração:** preferências com autorização; registro criado junto da notificação e idempotente; processamento com a porta em memória sobre o banco; acompanhamento do administrador. A implementação HTTP é testada com `fetch` simulado, sem rede.
- **E2E:** o solicitante liga "Mudanças de status"; o atendente inicia a solicitação; o administrador vê na seção "E-mails" o envio registrado (como "não enviado — e-mail não configurado", já que o ambiente de teste não tem provedor).

## 9. Riscos

- **Vazamento de dados por e-mail:** mitigação: conteúdo mínimo (5.4) e link que passa pelas regras de leitura do sistema.
- **Segredo do provedor:** mitigação: só variáveis de ambiente cadastradas pela responsável; nada no repositório; a tela só diz "configurado" ou "não configurado".
- **Excesso de e-mails:** mitigação: tudo começa desligado e cada categoria é escolhida pela própria pessoa.
- **Provedor fora do ar:** mitigação: o envio não participa da ação do usuário (vem depois, com novas tentativas) e a notificação na aplicação existe de qualquer forma.

## 10. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-092 | Migration e domínio: categorias, preferências, situação dos envios |
| SF-093 | Página "Preferências de notificação" nas áreas de solicitante, atendente e gestor |
| SF-094 | Registro dos envios no consumidor de notificações; processamento dos pendentes; conteúdo; implementação HTTP e configuração |
| SF-095 | Seção "E-mails" na administração |
| SF-096 | E2E e revisão |

**Ordem:** SF-092 → SF-093 → SF-094 → SF-095 → SF-096.

## 11. Decisões tomadas (2026-11-01)

Decisões da responsável pelo projeto: **todas as propostas aceitas**.

| # | Questão | Decisão | Alternativas descartadas |
|---|---|---|---|
| N1 | Como as preferências funcionam | E-mail por categoria (seis categorias), escolhido pela própria pessoa, tudo começando desligado; notificações na aplicação sempre ligadas | Começar com tudo ligado; preferência por tipo de notificação (13 opções); permitir desligar também na aplicação |
| N2 | Quando o e-mail é decidido | Registro de envio criado junto da notificação, conforme a preferência daquele momento | Decidir só na hora de enviar, relendo a preferência |
| N3 | Como enviar | API HTTP de um provedor via `fetch`, sem dependência nova, configurada por variáveis de ambiente; sem configuração, nada é enviado | SMTP com a biblioteca `nodemailer` (dependência nova); só registrar, sem nenhum envio real |
| N4 | O que o e-mail contém | Texto mínimo com link (seção 5.4), sem dados da solicitação | Incluir a descrição e o texto dos comentários públicos |
| N5 | Acompanhamento | Seção "E-mails" na administração, com os 50 envios mais recentes e sem conteúdo | Sem tela (só no banco) |
