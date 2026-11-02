# SPEC — API externa com tokens e webhooks

**Data:** 2026-11-02
**Status:** Aprovada em 2026-11-02, com as decisões A1 a A6 da seção 11 conforme propostas.
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seção 19, "integrações externas"), `SPEC/2026-10-29-plano-escala-100k.md` (item 14, garantia 7.4 e risco "dependências novas"), `SPEC/2026-10-30-camadas-para-100k.md` (camadas "API HTTP pública" e "Adaptadores externos"), `SPEC/2026-10-31-eventos-outbox-jobs.md` (eventos e consumidores), `SPEC/2026-11-01-notificacoes-email-preferencias.md` (padrão de envio com novas tentativas), `SPEC/2026-11-02-auditoria-lgpd.md` (auditoria, retenção e anonimização), `SPEC/2026-11-02-relatorio-fase-4.md` (seção 8)

## 1. Objetivo

Hoje o ServiceFlow só é usado pelo navegador. Outro sistema da organização (um portal, um chat interno, uma planilha automatizada) não consegue abrir uma solicitação nem saber que ela mudou. Esta SPEC cria:

- uma **API HTTP versionada** (`/api/v1`), autenticada por **tokens pessoais**, para consultar o catálogo e as solicitações e para abrir solicitações e comentar, **sempre com as mesmas regras da tela**;
- **webhooks de saída**, cadastrados pelo administrador, que avisam um endereço externo quando acontece um evento de solicitação.

## 2. Registro da mudança de escopo

- A SPEC principal (seção 19) deixou "integrações externas" para SPEC própria; o plano (item 14) previu "API externa com tokens e webhooks".
- **Nenhuma regra de negócio nova:** a API chama os mesmos casos de uso da tela, com a mesma autorização. Quem não pode fazer algo na tela também não pode pela API.
- Pela garantia 7.4, **sem nenhum token criado e nenhum webhook cadastrado, o sistema funciona exatamente como hoje**. A sessão do navegador não autentica a API, e o token não autentica as telas.

## 3. Escopo

1. Tokens pessoais criados pela própria pessoa, com validade e escopo **(decisões A1, A2 e A3)**.
2. Rotas `/api/v1` de leitura e de escrita, com formato de resposta e de erro fixos **(decisão A4)**.
3. Limite de chamadas por token **(decisão A6)**.
4. Webhooks de saída com assinatura, novas tentativas e acompanhamento dos envios **(decisão A5)**.
5. Documento OpenAPI das rotas.
6. Auditoria, "Meus dados", anonimização e retenção cobrindo os dados novos.

## 4. Fora de escopo

- Anexos pela API (envio ou download): serviços que exigem documento obrigatório não podem ser abertos pela API (5.4).
- Mudança de status, atribuição, etapas, prioridade, aprovação, cancelamento e reabertura pela API.
- Rotas da administração (cadastros, usuários, permissões, painel, auditoria).
- OAuth, tokens de aplicação sem dono e login pela API.
- Webhooks cadastrados por pessoas que não são administradoras; filtro de webhook por setor ou serviço; reenvio manual de uma entrega.
- Chave de idempotência na abertura de solicitações.
- SDKs e páginas de documentação interativas (o OpenAPI é servido como JSON).

## 5. Regras

### 5.1 Tokens pessoais **(decisões A1 e A3)**

- **Quem cria:** solicitante, atendente e gestor ativos, cada um só para si, na página "Acesso à API" da própria área. O administrador **não** tem token: nenhuma rota da v1 serve ao perfil (5.4).
- **Dados do token:** nome dado pela pessoa (1 a 60 caracteres), escopo (5.2), validade escolhida entre **30, 90 ou 365 dias** (padrão 90), data de criação, de expiração, de último uso e de revogação.
- **Formato:** `sf_` seguido de 32 bytes aleatórios em base64url (`node:crypto`). O valor aparece **uma única vez**, logo depois de criado. O banco guarda só o **SHA-256** do valor (índice único) e os 4 últimos caracteres, para a pessoa reconhecer o token na lista.
- **Limite:** no máximo **10 tokens ativos** (não revogados e não expirados) por pessoa.
- **Revogação:** a própria pessoa revoga os seus; o administrador vê a lista de todos os tokens (nome, dono, escopo, datas, sem valor) na seção "Acesso à API" e pode revogar qualquer um. Revogar é imediato e irreversível.
- **Validade na chamada:** o token só vale se existir, não estiver revogado nem expirado e o dono estiver **ativo** e não anonimizado, com o perfil lido do banco **a cada chamada** (desativar a pessoa ou mudar o perfil para administrador corta o acesso na chamada seguinte). Mudança de setor vale na chamada seguinte, como na tela.
- **Último uso:** gravado no máximo uma vez por minuto por token.

### 5.2 Escopos **(decisão A2)**

| Escopo | Nome na tela | Libera |
|---|---|---|
| `read` | Somente leitura | Rotas `GET` |
| `write` | Leitura e escrita | Rotas `GET` e `POST` |

Uma chamada `POST` com token `read` é recusada com `403 insufficient_scope`.

### 5.3 Autenticação e contexto

- Cabeçalho `Authorization: Bearer sf_...`. Sem cabeçalho, com formato errado ou token inválido, expirado ou revogado: `401 invalid_token`, sempre com a mesma mensagem (não revela se o token existiu).
- Cookies de sessão são ignorados nas rotas `/api/v1`, e o token é ignorado fora delas.
- O dono do token é passado aos casos de uso como a pessoa autenticada **apenas durante a chamada**, por um contexto do servidor (`AsyncLocalStorage`), sem mudar os casos de uso nem a autorização existente.
- A comparação usa o hash, e o tempo da recusa não depende de qual parte do token está errada.

### 5.4 Rotas **(decisão A4)**

| Método e caminho | Escopo | Perfis | Equivale a |
|---|---|---|---|
| `GET /api/v1/me` | `read` | todos com token | Nome, e-mail, perfil, setor e permissões da pessoa; escopo e expiração do token |
| `GET /api/v1/services` | `read` | Solicitante | Catálogo publicado: serviço, descrição, categoria, setor, prioridade, prazo-base, se exige aprovação, documentos exigidos (nome, obrigatório) e campos (identificador, rótulo, tipo, obrigatório, opções) |
| `GET /api/v1/requests` | `read` | Solicitante, atendente, gestor | Solicitante: as próprias (busca de "Minhas solicitações"); atendente: a fila do setor (mesmos filtros da busca da fila); gestor: "Aprovações" (pendentes ou todas; "Todas do setor" com a permissão) |
| `GET /api/v1/requests/{id}` | `read` | quem pode ler a solicitação na tela | Detalhe: dados, status, prioridade, prazo e situação do prazo, aprovação, etapa, responsável, respostas dos campos, anexos (só nome, tipo e tamanho, sem download), comentários visíveis à pessoa e histórico |
| `POST /api/v1/requests` | `write` | Solicitante | Abertura: `serviceId`, `description` e respostas dos campos, com as mesmas validações da tela. Serviço com documento obrigatório: `422 documents_required` |
| `POST /api/v1/requests/{id}/comments` | `write` | quem pode comentar na tela | Comentário público; nota interna só para quem pode escrevê-la na tela (`internal: true`) |

- **Formato:** JSON em UTF-8, nomes de campos em inglês (`camelCase`), datas em ISO 8601 UTC, status e prioridade pelos códigos (`OPEN`, `HIGH`...).
- **Paginação:** `page` (a partir de 1) e o mesmo tamanho de página da tela (20); a resposta traz `page`, `pageCount` e `total`.
- **Erros:** `{"error": {"code": "...", "message": "..."}}`, com os códigos públicos que a aplicação já usa e `400 invalid_request`, `401 invalid_token`, `403 forbidden`, `403 insufficient_scope`, `404 not_found` (também para o que a pessoa não pode ler), `409 conflict`, `422 documents_required`, `429 rate_limited`. Nenhum erro devolve pilha, SQL ou dado de outra pessoa.
- **Cabeçalhos:** `Cache-Control: no-store` e `X-Content-Type-Options: nosniff` em todas as respostas; sem CORS (a API é para servidores, não para navegadores de outros sites).
- **OpenAPI:** `GET /api/v1/openapi.json` (público, sem token) descreve todas as rotas, escopos, formatos e erros. Um teste confere que toda rota existente está no documento e vice-versa.

### 5.5 Limite de chamadas **(decisão A6)**

- **60 chamadas por minuto por token**, em janela fixa contada no banco. Acima disso: `429 rate_limited` com `Retry-After` em segundos.
- As janelas antigas são apagadas no job diário.

### 5.6 Webhooks **(decisão A5)**

**Cadastro (só administrador, seção "Webhooks" da administração):**

- Nome, URL, eventos escolhidos (pelo menos um, entre os tipos de evento existentes da outbox: abertura, mudança de status, atribuição, comentário, prioridade, etapa, decisão de aprovação, alerta e vencimento de SLA), ativo ou inativo. No máximo **10 webhooks**.
- **URL:** só `https`, sem usuário e senha na URL, sem porta fora de 443 e 8443, com host que não seja `localhost` nem endereço IP literal de rede privada, local ou reservada. Exceção só para os testes: com `WEBHOOK_ALLOW_LOCAL=true` no ambiente, `http://localhost` e `http://127.0.0.1` são aceitos (a variável não existe nos ambientes publicados).
- **Segredo de assinatura:** gerado pelo servidor (32 bytes aleatórios, prefixo `whsec_`), mostrado **uma única vez** na criação e na troca de segredo ("Gerar novo segredo"). Guardado **cifrado** (AES-256-GCM, `node:crypto`) com a chave de `WEBHOOK_ENCRYPTION_KEY` (32 bytes em base64, só em variável de ambiente). **Sem a chave configurada**, a seção avisa "Webhooks não configurados" (pelo nome da variável, nunca pelo valor), não deixa cadastrar e nada é enviado.

**Entrega:**

- Um consumidor novo da outbox registra, para cada evento, uma entrega por webhook **ativo que assina aquele tipo** (única por evento e webhook, para o reprocessamento não duplicar), copiando o corpo já montado (o evento da outbox é apagado depois de 30 dias).
- **Corpo:** `{"id", "type", "occurredAt", "requestId", "data"}`, em que `data` é exatamente o conteúdo da outbox (identificadores e códigos). **Nunca** leva descrição, comentário, nota, resposta de campo, nome de arquivo, nome ou e-mail de pessoa.
- **Assinatura:** cabeçalho `ServiceFlow-Signature: t=<segundos>,v1=<HMAC-SHA256 em hexadecimal de "<t>.<corpo>">`, mais `ServiceFlow-Event` e `ServiceFlow-Delivery` (identificador da entrega, igual em todas as tentativas). O README explica como verificar.
- **Envio:** `POST` com tempo-limite de 10 s, **sem seguir redirecionamentos**. Antes de cada envio, o host é resolvido e o envio é recusado se algum endereço for privado, local ou reservado (salvo a exceção dos testes). Sucesso é qualquer resposta 2xx.
- **Novas tentativas:** até **6 tentativas** com espera crescente (1 min, 5 min, 30 min, 2 h, 12 h). Falha guarda só o código (`HTTP_<status>`, `TIMEOUT`, `NETWORK`, `BLOCKED_ADDRESS`, `REDIRECT`), nunca o corpo da resposta.
- **Quando roda:** logo após a resposta que gerou o evento (como os e-mails) e no job diário.
- Webhook desativado ou excluído logicamente não recebe entregas novas; as pendentes dele passam a "cancelada".
- **Acompanhamento:** a seção mostra as 50 entregas mais recentes (webhook, tipo do evento, situação, tentativas, código do último erro e datas), sem o corpo.

### 5.7 Auditoria, LGPD e retenção

- **Auditoria:** criação e revogação de token (sem o valor nem o hash) e criação, alteração, desativação e troca de segredo de webhook (sem o segredo) entram na seção "Auditoria", com os tipos novos "Token de API" e "Webhook".
- **"Meus dados":** inclui os tokens da pessoa (nome, escopo, final, datas), sem o valor e sem o hash.
- **Anonimização:** revoga todos os tokens da pessoa.
- **Retenção (job diário):** entregas de webhook concluídas ou falhas há mais de **30 dias** são apagadas; janelas do limite de chamadas com mais de 1 dia, também. Tokens revogados ou expirados há mais de 365 dias são apagados.

### 5.8 Autorização (complementa as SPECs anteriores)

| Operação | Quem pode |
|---|---|
| Criar e revogar o próprio token | Solicitante, atendente e gestor ativos |
| Ver e revogar todos os tokens | Administrador |
| Usar a API | Dono ativo de token válido, com as regras da tela do seu perfil |
| Cadastrar, alterar e desativar webhooks; ver entregas | Administrador |

## 6. Dados

Migration **aditiva**:

- `ApiToken` (`userId`, `name`, `scope`, `tokenHash` único, `lastFour`, `createdAt`, `expiresAt`, `lastUsedAt`, `revokedAt`, `revokedById`), índice por pessoa.
- `ApiRateWindow` (`tokenId`, `windowStart`, `count`), chave única por token e janela.
- `WebhookEndpoint` (`name`, `url`, `eventTypes`, `isActive`, `encryptedSecret`, `createdAt`, `updatedAt`).
- `WebhookDelivery` (`endpointId`, `eventId`, `eventType`, `body`, `status`, `attempts`, `availableAt`, `createdAt`, `deliveredAt`, `lastErrorCode`), única por evento e webhook, índice para buscar pendentes.
- Valores novos `API_TOKEN` e `WEBHOOK` em `AuditEntityType` e, se preciso, `REVOKED` em `AuditAction`.

Nenhuma tabela existente muda.

## 7. Critérios de aceitação

- [ ] **CA-API-01** — Sem tokens e sem webhooks, nada muda: telas e suítes anteriores passam sem alteração de asserções; a sessão do navegador não autentica `/api/v1`.
- [ ] **CA-API-02** — Solicitante, atendente e gestor criam o próprio token com nome, escopo e validade; o valor aparece uma única vez; o banco guarda só o hash; acima de 10 tokens ativos, a criação é recusada; o administrador não cria token.
- [ ] **CA-API-03** — Token revogado (pela pessoa ou pelo administrador), expirado, de pessoa desativada ou anonimizada, ou inexistente é recusado com `401 invalid_token` e a mesma mensagem; mudança de perfil ou de setor vale na chamada seguinte.
- [ ] **CA-API-04** — Token `read` não executa `POST` (`403 insufficient_scope`).
- [ ] **CA-API-05** — `GET /me`, `/services`, `/requests` e `/requests/{id}` devolvem exatamente o que a pessoa vê na tela, com o recorte do perfil e da permissão; o que ela não pode ler responde `404`.
- [ ] **CA-API-06** — `POST /requests` abre a solicitação com as mesmas validações e efeitos da tela (snapshot, SLA, aprovação, evento); serviço com documento obrigatório responde `422 documents_required`; `POST /requests/{id}/comments` segue as regras de comentário e de nota interna.
- [ ] **CA-API-07** — Erros seguem o formato de 5.4, sem pilha nem dados de terceiros; todas as respostas têm `no-store` e `nosniff`.
- [ ] **CA-API-08** — Acima de 60 chamadas por minuto, o token recebe `429` com `Retry-After`; outro token não é afetado.
- [ ] **CA-API-09** — O OpenAPI descreve todas as rotas e só elas (teste de correspondência).
- [ ] **CA-API-10** — O administrador cadastra webhook só com URL permitida e só com a chave de cifragem configurada; o segredo aparece uma única vez e fica cifrado no banco; sem a chave, a seção avisa e nada é enviado.
- [ ] **CA-API-11** — Cada evento assinado gera uma entrega por webhook ativo, sem duplicar no reprocessamento; o corpo traz só identificadores e códigos; a assinatura confere com o segredo; redirecionamento e endereço privado são recusados; falhas têm novas tentativas com espera crescente até 6 tentativas.
- [ ] **CA-API-12** — Criação e revogação de token e mudanças de webhook aparecem na auditoria sem valor, hash ou segredo; "Meus dados" lista os tokens sem valor; anonimizar revoga os tokens; o job diário aplica a retenção de 5.7.
- [ ] **CA-API-13** — Nenhuma dependência nova; uma migration aditiva.

## 8. Estratégia de testes

- **Unitários:** geração e hash do token, validade e escopo; regra de URL do webhook; cifragem e decifragem do segredo; assinatura; montagem do corpo (só chaves permitidas); espera entre tentativas; janela do limite; mapeamento de erros para o formato da API; correspondência do OpenAPI com as rotas.
- **Integração:** autenticação por token sobre o banco (revogado, expirado, pessoa desativada, perfil mudado); cada rota com cada perfil, inclusive leitura negada como `404`; abertura e comentário pela API com evento na outbox; limite de chamadas; consumidor de webhooks sem duplicar; envio para um servidor HTTP local de teste (sucesso, erro, tempo esgotado, redirecionamento); retenção; anonimização.
- **E2E:** o solicitante cria um token na tela, o teste chama `POST /api/v1/requests` com ele e a solicitação aparece na tela e na fila do atendente; o administrador cadastra um webhook para um receptor local do teste e o receptor recebe o evento de abertura com assinatura válida; o solicitante revoga o token e a chamada seguinte recebe `401`.

## 9. Riscos

- **Vazamento de token:** mitigação: valor mostrado uma vez, só o hash no banco, validade obrigatória, revogação imediata, escopo somente leitura disponível, limite de chamadas.
- **SSRF pelos webhooks:** mitigação: só `https`, verificação dos endereços resolvidos antes de cada envio, sem redirecionamentos, tempo-limite. **Risco residual:** a resolução pode mudar entre a verificação e a conexão (*DNS rebinding*); registrado e aceito, porque só o administrador cadastra URLs.
- **Vazamento de dados pelos webhooks:** mitigação: corpo só com identificadores e códigos, igual à outbox; o receptor que quiser detalhes usa a API com token.
- **Segredo dos webhooks no banco:** mitigação: cifrado com chave fora do banco e do repositório.
- **Divergência entre API e tela:** mitigação: a API chama os mesmos casos de uso, e os testes de integração comparam o recorte.
- **Carga:** mitigação: limite por token, paginação de 20.

## 10. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-111 | Migration e domínio: tokens (geração, hash, validade, escopo), URL e segredo de webhook, assinatura, corpo, janela do limite |
| SF-112 | Tokens pessoais: casos de uso, autenticação por token com o contexto do servidor, limite de chamadas, páginas "Acesso à API" e lista do administrador, auditoria |
| SF-113 | Rotas `/api/v1`, formato de erros e OpenAPI |
| SF-114 | Webhooks: cadastro, consumidor, envio com novas tentativas, seção "Webhooks", retenção, "Meus dados" e anonimização |
| SF-115 | E2E e revisão (inclui o README com a verificação da assinatura) |

**Ordem:** SF-111 → SF-112 → SF-113 → SF-114 → SF-115.

## 11. Decisões tomadas (2026-11-02)

Decisões da responsável pelo projeto: **todas as propostas aceitas**.

| # | Questão | Decisão | Alternativas descartadas |
|---|---|---|---|
| A1 | Quem tem token | Cada solicitante, atendente e gestor cria os próprios tokens e age com as próprias permissões; o administrador vê e revoga todos, mas não cria | Só o administrador cria "contas de integração"; também o administrador com token |
| A2 | Escopos | Dois: "Somente leitura" e "Leitura e escrita" | Um escopo por rota; sem escopos |
| A3 | Guarda e validade | Valor mostrado uma vez, só o SHA-256 no banco, validade obrigatória de 30, 90 ou 365 dias, até 10 ativos por pessoa | Sem validade; validade livre |
| A4 | Rotas da v1 | Leitura do catálogo e das solicitações, abertura sem anexos e comentários (5.4) | Também mudança de status, atribuição e cancelamento; só leitura |
| A5 | Webhooks | Cadastrados pelo administrador, para a organização inteira, com HMAC-SHA256, segredo cifrado por chave em variável de ambiente, só `https` e endereços públicos, 6 tentativas | Segredo sem cifragem no banco; webhooks por setor cadastrados pelo gestor |
| A6 | Limite de chamadas | 60 por minuto por token, janela fixa no banco | Sem limite nesta SPEC; limite por pessoa em vez de por token |
