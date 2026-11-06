# SPEC — Ferramentas MCP de consulta a documentos

**Data:** 2026-11-05
**Status:** Aprovada. A funcionalidade 2 ("ferramentas MCP de documentos") foi aprovada pela responsável em 2026-11-03, com a lista de pendências 1 a 8. Em 2026-11-05 ela pediu: "faça a ferramentas MCP de documentos". Como nas SPECs anteriores, as decisões M1 a M9 da seção 11 foram adotadas como recomendadas; a responsável pode rever qualquer uma. **Concluída em 2026-11-06** (SF-138 a SF-141; CA-MCP-01 a 12 verificados).
**Projeto:** ServiceFlow
**Referências:**
- `SPEC/2026-09-30-catalogo-e-solicitacoes.md`: seção 21, em especial 21.11 (requisito MCP) e 21.5 (download).
- `SPEC/2026-11-02-api-externa-webhooks.md`: tokens, escopos e limite de chamadas.
- `SPEC/2026-11-03-anexos-comentarios-documentos.md`: arquivos de comentário e documentos enviados depois.
- Especificação MCP, revisão `2026-07-28` (consultada em 2026-11-05): transporte Streamable HTTP, ferramentas, `server/discover`, versionamento e compatibilidade com as revisões `2025-03-26` a `2025-11-25`.

## 1. Objetivo

Permitir que um assistente de IA compatível com MCP, como o Claude Code ou o Claude Desktop, **consulte as solicitações e leia os documentos** que a pessoa dona do token já pode ver na tela. Exemplos de uso: "liste os documentos da minha solicitação de férias", "leia o comprovante anexado e diga a data".

## 2. Registro da mudança de escopo

A seção 21.11 da SPEC principal registrou o MCP como requisito futuro. Ela exige que as ferramentas usem as mesmas operações e verificações do servidor que a tela usa:
- usuário autenticado e ativo;
- perfil;
- propriedade pelo solicitante;
- setor atual do atendente.

A seção 21.11 também proíbe:
- credencial de serviço do armazenamento;
- acesso direto ao banco que contorne a autorização;
- ampliar o acesso de um perfil.

Esta SPEC implementa o requisito só para **leitura**. As SPECs da API externa deixaram o download de arquivos fora da `/api/v1` (decisão X6). Isso continua igual: o download por máquina passa a existir **só pelo MCP**, com as mesmas regras do download pela tela.

## 3. Escopo

1. Endpoint MCP em `POST /api/mcp`, no transporte Streamable HTTP, só com respostas JSON (sem SSE).
2. Autenticação pelo **mesmo token Bearer da API externa** (`sf_…`), sempre agindo como a pessoa dona do token.
3. Quatro ferramentas, todas de leitura:
   - `find_requests`: lista as solicitações que a pessoa pode ver, com busca e filtros.
   - `list_request_documents`: documentos de uma solicitação (de abertura e enviados depois) e arquivos dos comentários visíveis.
   - `read_request_document`: conteúdo de um documento da solicitação.
   - `read_comment_file`: conteúdo de um arquivo de comentário.
4. Compatibilidade com clientes da revisão moderna (`2026-07-28`) e das revisões com `initialize` (`2025-03-26`, `2025-06-18`, `2025-11-25`).
5. Instruções de conexão no README e na tela de tokens da API.

## 4. Fora de escopo

- Ferramentas que alteram dados, como abrir solicitação, comentar ou enviar documento **(decisão M2)**.
- Extração de texto de PDF ou DOCX no servidor: o arquivo vai inteiro, e o cliente decide como ler **(decisão M5)**.
- `resources`, `prompts`, `subscriptions/listen`, SSE, sessões (`Mcp-Session-Id`) e autorização OAuth do MCP **(decisões M3 e M4)**.
- Transporte stdio e o transporte HTTP+SSE antigo (`2024-11-05`).
- Registro de auditoria por chamada: a API e o download pela tela também não registram **(decisão M8)**.
- Administrador: continua sem token e sem acesso operacional.

## 5. Regras

### 5.1 Autenticação e limite **(decisão M1)**

1. Todo POST precisa do cabeçalho `Authorization: Bearer sf_…`. Isso inclui `initialize`, `server/discover`, `tools/list` e as notificações. Cookies nunca são lidos.
2. A validação é a mesma da API externa:
   - token existente, não revogado e não expirado;
   - dona ativa e não anonimizada;
   - perfil de solicitante, atendente ou gestor.
   Perfil, setor e situação são lidos de novo no banco a cada chamada.
3. Como as ferramentas só leem, basta o escopo **READ**. Um token WRITE também serve.
4. O limite é o mesmo da API: **60 chamadas por minuto por token**, contadas junto com as chamadas à `/api/v1`.
5. Recusas, antes de ler o corpo da requisição:
   - token ausente ou inválido: HTTP 401, `WWW-Authenticate: Bearer` e erro JSON-RPC sem `id`;
   - limite excedido: HTTP 429 com `Retry-After`.
6. Cada ferramenta roda como a dona do token (`runAsApiUser`). As verificações de perfil, propriedade e setor são as dos casos de uso existentes, que não mudam.

### 5.2 Transporte HTTP

1. Só `POST` é aceito. `GET` e `DELETE` recebem 405, com `Allow: POST`.
2. `Content-Type` diferente de `application/json` recebe 415. Corpo acima de 64 KiB recebe 413.
3. Se o cabeçalho `Accept` vier e não aceitar `application/json` nem `*/*`, a resposta é 406.
4. Se o cabeçalho `Origin` vier e for diferente da origem do próprio servidor, a resposta é 403. Isso protege contra DNS rebinding, como a especificação MCP exige; clientes de servidor não enviam `Origin`.
5. O corpo deve ser **uma** mensagem JSON-RPC 2.0. Os casos de erro:
   - JSON inválido: 400, código `-32700`;
   - lote (array), estrutura inválida ou resposta JSON-RPC enviada pelo cliente: 400, código `-32600`.
6. Notificação (mensagem sem `id`) aceita: 202, sem corpo.
7. Toda resposta tem `Cache-Control: no-store` e `X-Content-Type-Options: nosniff`, sem CORS. O servidor nunca cria nem devolve `Mcp-Session-Id`, e ignora esse cabeçalho e o `Last-Event-ID`.

### 5.3 Versões do protocolo **(decisão M3)**

1. Versões aceitas:
   - moderna: `2026-07-28`;
   - com `initialize`: `2025-11-25`, `2025-06-18` e `2025-03-26`.
2. **Requisição moderna** é a que traz `params._meta["io.modelcontextprotocol/protocolVersion"]`. Regras:
   - O cabeçalho `MCP-Protocol-Version` precisa ser igual à versão do corpo, e `Mcp-Method` igual ao `method`.
   - Em `tools/call`, `Mcp-Name` precisa ser igual a `params.name`; se vier no formato `=?base64?…?=`, é decodificado antes de comparar.
   - Cabeçalho ausente ou diferente: 400, código `-32020` (HeaderMismatch).
   - Versão moderna desconhecida: 400, código `-32022`, com `data: { supported, requested }`.
3. **Cliente com `initialize`:**
   - A resposta traz a versão pedida, se for uma das três aceitas; senão, a mais nova delas (`2025-11-25`).
   - Junto vão `capabilities: { tools: { listChanged: false } }`, `serverInfo` e `instructions`.
   - Nas requisições seguintes:
     - sem `MCP-Protocol-Version`, vale `2025-03-26`;
     - com uma das versões com `initialize`, a requisição é aceita;
     - com outro valor, a resposta é 400 com código `-32022`.
4. `initialize` com o `_meta` moderno é recusado com `-32020`, porque mistura as duas eras.
5. Métodos atendidos:

   | Método | Resposta |
   |---|---|
   | `server/discover` | versões aceitas, capacidades, `serverInfo` e `instructions` |
   | `initialize` | negociação descrita no item 3 |
   | `ping` | `{}` |
   | `tools/list` | as 4 ferramentas, sempre na mesma ordem |
   | `tools/call` | execução da ferramenta |

   Qualquer outro método recebe 404, código `-32601`. As respostas modernas trazem `resultType: "complete"`.

### 5.4 Ferramentas **(decisões M2, M5, M6 e M7)**

Os argumentos são validados com esquema estrito: campo desconhecido é recusado. Nome de ferramenta desconhecido é erro de protocolo, código `-32602`. Argumento inválido é **erro de execução da ferramenta** (`isError: true`), com uma mensagem que indica o campo, para o modelo corrigir.

1. **`find_requests`**: argumentos opcionais `q` (texto), `status` (lista de status), `page` (≥ 1) e, para gestor, `filter` (`pending`, `all` ou `sector`). Usa a mesma operação da `GET /api/v1/requests`:
   - solicitante: só as próprias;
   - atendente: a fila do setor;
   - gestor: as aprovações.

   Devolve a página no mesmo formato da API.
2. **`list_request_documents`** (`requestId`):
   - Documentos da solicitação: id, requisito, nome do arquivo, formato, tamanho, data e se foi removido. Leitura autorizada pelas mesmas regras do download pela tela.
   - Arquivos dos comentários que a pessoa pode ver: id do comentário, id do arquivo, nome, formato, tamanho e se foi removido. As notas internas continuam escondidas do solicitante. O gestor não vê comentários na tela; por isso recebe a lista vazia, e a resposta diz o motivo.
3. **`read_request_document`** (`requestId`, `attachmentId`): usa a mesma operação do download pela tela, com a conferência de tamanho e SHA-256.
4. **`read_comment_file`** (`requestId`, `commentId`, `fileId`): usa a mesma operação do download de arquivo de comentário pela tela.
5. Conteúdo devolvido pelas duas ferramentas de leitura:
   - **TXT:** bloco `text` com o conteúdo. O formato TXT já é validado como UTF-8 no envio.
   - **PDF e DOCX:** bloco `resource` com o arquivo em base64 (`blob`), o `mimeType` detectado e a URI `serviceflow://requests/{requestId}/documents/{id}` ou `serviceflow://requests/{requestId}/comments/{commentId}/files/{fileId}`.
   - Nos dois casos vai antes um bloco `text` curto com nome, formato e tamanho.
   - O limite de 2 MiB por arquivo já vale no envio.
6. **Sem revelar existência:** solicitação, documento ou arquivo inexistente, de outra pessoa, de outro setor, removido ou com id malformado recebe a **mesma** resposta: erro de execução com a mensagem "Not found.". É a mesma regra do download pela tela.
7. Toda ferramenta é anunciada com `annotations: { readOnlyHint: true, openWorldHint: false }`.
8. Os registros do servidor não contêm conteúdo de arquivo, nomes de arquivo, argumentos nem o token. Um erro inesperado registra só o nome do erro e devolve `isError: true` com a mensagem "Internal error.".

### 5.5 Instruções de conexão **(decisão M9)**

O README e a tela "Tokens da API" mostram:
- o endereço `https://<domínio>/api/mcp`;
- o cabeçalho `Authorization` que deve ser configurado;
- um exemplo de configuração do Claude Code (`claude mcp add --transport http …`).

As instruções lembram que o token dá ao assistente o mesmo acesso de leitura que a pessoa tem.

## 6. Dados

Nenhuma tabela nova e nenhuma migration. Os tokens e as janelas de limite são os da API externa.

## 7. Critérios de aceitação

- [x] **CA-MCP-01** — Sem token, com token inválido, revogado, expirado ou de pessoa inativa, toda requisição recebe 401 com `WWW-Authenticate: Bearer`, e nenhum caso de uso roda. *Verificado em 2026-11-06: integração (6 tipos de token recusados) e E2E (revogação).*
- [x] **CA-MCP-02** — Um token READ executa as 4 ferramentas. As chamadas contam no mesmo limite de 60 por minuto da API, e a 61ª chamada no minuto recebe 429 com `Retry-After`. *Verificado em 2026-11-06: integração (tokens READ e WRITE; janela compartilhada com `/api/v1`; 429).*
- [x] **CA-MCP-03** — O solicitante lista e lê os documentos e arquivos de comentário das próprias solicitações. Para uma solicitação de outra pessoa, recebe "Not found.", igual à de um id inexistente. *Verificado em 2026-11-06: integração e E2E.*
- [x] **CA-MCP-04** — O atendente lê os documentos das solicitações do setor atual e recebe "Not found." para as de outro setor. Depois de uma transferência de setor, perde o acesso, como na tela. *Verificado em 2026-11-06: integração, com mudança de setor.*
- [x] **CA-MCP-05** — O gestor segue a regra da tela: lê os documentos das solicitações com aprovação do seu setor, ou de todas do setor se tiver a permissão de leitura do setor. Não vê arquivos de comentário. *Verificado em 2026-11-06: integração (sem e com a permissão; aprovação do setor).*
- [x] **CA-MCP-06** — Arquivos de nota interna não aparecem para o solicitante, nem na lista nem na leitura direta pelo id. Arquivos removidos recebem "Not found.". *Verificado em 2026-11-06: integração (nota interna) e unitário do despacho (removidos).*
- [x] **CA-MCP-07** — Na leitura, TXT volta como texto, e PDF e DOCX voltam em base64 com o tipo detectado. Os bytes são idênticos aos enviados, e um arquivo corrompido no armazenamento (tamanho ou SHA-256 diferente) dá "Internal error.". *Verificado em 2026-11-06: integração (bytes iguais; SHA-256 alterado) e E2E (hash do PDF).*
- [x] **CA-MCP-08** — Um cliente moderno (`2026-07-28`) usa `server/discover`, `tools/list` e `tools/call` sem `initialize`. Cabeçalho ausente ou diferente do corpo recebe 400 com `-32020`, e versão desconhecida recebe 400 com `-32022` e a lista de versões. *Verificado em 2026-11-06: unitários do protocolo, integração e E2E.*
- [x] **CA-MCP-09** — Um cliente com `initialize` (`2025-06-18` ou `2025-11-25`) negocia a versão, envia `notifications/initialized` (resposta 202) e usa as ferramentas. Nenhuma resposta traz `Mcp-Session-Id`. *Verificado em 2026-11-06: unitários, integração e E2E (`2025-06-18`).*
- [x] **CA-MCP-10** — `GET` e `DELETE` recebem 405. Corpo inválido, lote, `Content-Type` errado, `Origin` estranho e corpo grande demais recebem os códigos da seção 5.2. *Verificado em 2026-11-06: unitários do transporte e E2E (405).*
- [x] **CA-MCP-11** — Argumentos inválidos ou campos extras dão `isError: true` com a mensagem do campo, e ferramenta desconhecida dá `-32602`. Nenhuma ferramenta altera dados: o banco e o armazenamento ficam iguais depois de chamar as 4. *Verificado em 2026-11-06: unitários e integração (contagens de 7 tabelas e do armazenamento iguais).*
- [x] **CA-MCP-12** — Nenhuma dependência nova. Os registros do servidor não contêm token, argumento, nome nem conteúdo de arquivo. README e tela de tokens trazem as instruções da seção 5.5. *Verificado em 2026-11-06: nenhuma dependência nova em `package.json`; unitários dos registros; README e tela verificados (unitário e E2E).*

## 8. Estratégia de testes

- **Unitários:**
  - protocolo: leitura da mensagem, versões, cabeçalhos, base64 do `Mcp-Name` e códigos de erro;
  - esquemas dos argumentos;
  - montagem do conteúdo (texto e base64);
  - executor das ferramentas, com os módulos simulados;
  - rota HTTP, com a autenticação simulada.
- **Integração** (banco de teste real e armazenamento em memória): perfis, propriedade, setor, transferência, gestor, notas internas, removidos, arquivo corrompido, tokens recusados, limite e ausência de escrita.
- **E2E:** sessão completa por HTTP contra o servidor do Playwright, com um token criado no banco: `initialize` → `tools/list` → `find_requests` → `list_request_documents` → `read_request_document`, e também o fluxo moderno.

## 9. Riscos

- **Base64 no contexto do modelo:** um PDF de 2 MiB vira cerca de 2,7 MB de texto. Quem controla se o conteúdo vai inteiro ao modelo é o cliente MCP. A descrição da ferramenta avisa o tamanho, e `list_request_documents` mostra o tamanho antes da leitura.
- **Token com acesso amplo:** o assistente lê tudo o que a pessoa lê. A tela de tokens e o README avisam disso, e a pessoa pode revogar o token a qualquer momento.
- **Mudanças futuras do protocolo:** a implementação é própria, sem SDK (decisão M7). Os testes cobrem as regras da revisão `2026-07-28` e das revisões com `initialize`; uma revisão nova exige atualizar esta SPEC.

## 10. Tarefas (registradas em `TASKS.md`)

- **SF-138** — Protocolo MCP: mensagens, versões, cabeçalhos e erros (domínio puro, com testes unitários).
- **SF-139** — Ferramentas e endpoint `/api/mcp`: autenticação, executor, conteúdo e rota (testes unitários).
- **SF-140** — Integração com banco real: autorização por perfil, documentos e limites.
- **SF-141** — Instruções na tela de tokens e no README, E2E e revisão.

## 11. Decisões tomadas (2026-11-05)

- **M1 — Mesmo token da API externa, com escopo READ:** evita uma segunda credencial e reaproveita a revogação, a validade e o limite de chamadas. Alternativa descartada: OAuth do MCP, que exigiria servidor de autorização próprio.
- **M2 — Só leitura:** o requisito 21.11 trata de consulta. Escrita por assistente de IA pede confirmação humana e outra SPEC.
- **M3 — Servidor das duas eras, sem sessão:** a revisão `2026-07-28` não tem sessão; as revisões com `initialize` permitem servidor sem `Mcp-Session-Id`. Assim, um único caminho sem estado atende os clientes atuais e os antigos, e funciona nas funções da Vercel, que não guardam estado entre chamadas.
- **M4 — Só JSON, sem SSE:** as ferramentas respondem de uma vez, e não há notificações a enviar.
- **M5 — Arquivo inteiro, sem extração de texto:** extrair texto de PDF ou DOCX exigiria uma dependência nova e mais superfície de ataque. Os clientes atuais leem PDF em base64.
- **M6 — Mesma resposta para tudo que a pessoa não pode ver:** mantém a regra do download pela tela, que não revela se o documento existe.
- **M7 — Implementação própria, sem `@modelcontextprotocol/sdk`:** o subconjunto usado é pequeno (5 métodos, sem estado), e a regra 11 do `AGENTS.md` pede não adicionar dependência sem necessidade. O SDK também traz um transporte com sessões e SSE que não é usado aqui.
- **M8 — Sem auditoria por chamada:** é o mesmo comportamento da API e do download pela tela. Se a responsável quiser rastrear leituras feitas por assistentes, isso pede uma SPEC de auditoria de leitura que valha para todos os caminhos.
- **M9 — Instruções na tela de tokens:** é onde a pessoa cria o token, então ali ela também vê como usá-lo.
