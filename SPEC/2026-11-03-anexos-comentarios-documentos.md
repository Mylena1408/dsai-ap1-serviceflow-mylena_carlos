# SPEC — Anexos em comentários e documentos depois da abertura

**Data:** 2026-11-03
**Status:** Aprovada em 2026-11-03: a responsável aprovou a funcionalidade 6 ("anexos em comentários e documentos depois da abertura") da lista de pendências; as decisões X1 a X7 da seção 11 foram adotadas como recomendadas, e podem ser revistas por ela.
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seção 21: documentos exigidos, limites, detecção de formato, armazenamento privado e download), `SPEC/2026-10-31-comentarios.md` (comentários e notas internas; anexos ficaram fora de escopo), `SPEC/2026-10-31-eventos-outbox-jobs.md` (eventos e notificações), `SPEC/2026-11-02-auditoria-lgpd.md` (anonimização e "Meus dados"), `SPEC/2026-11-02-api-externa-webhooks.md` (webhooks)

## 1. Objetivo

1. Permitir **anexar arquivos a um comentário** (ou nota interna), para que solicitante e equipe troquem um documento no meio do atendimento sem abrir outra solicitação.
2. Permitir que o solicitante **envie depois da abertura** um documento do serviço que ainda não enviou (opcional deixado para depois, ou exigência acrescentada ao serviço depois da abertura).

## 2. Registro da mudança de escopo

A SPEC de comentários deixou "anexos em comentários" fora de escopo, e a seção 21 da SPEC principal só aceita documentos na abertura. Esta SPEC amplia as duas, com as mesmas regras de arquivo da seção 21 (formatos detectados pelo conteúdo, nome saneado, hash, armazenamento privado, download só por quem lê).

**Dependência conhecida:** o armazenamento real de produção ainda depende da SF-030 (projetos e chaves do Supabase). Como na SF-034, a funcionalidade é desenvolvida e verificada com o armazenamento de teste; em produção, enquanto o armazenamento não estiver configurado, o envio de arquivo é recusado com a mesma mensagem dos documentos de abertura, e comentários sem arquivo continuam funcionando.

## 3. Escopo

1. Até 3 arquivos por comentário, na tela de detalhe do solicitante e na da fila.
2. Lista e download dos arquivos de cada comentário, com a mesma visibilidade do comentário.
3. Envio, pelo solicitante, de um documento ainda não enviado de um requisito ativo do serviço, enquanto a solicitação está aberta ou em atendimento.
4. Linha no histórico, evento `request.document_added`, notificação ao responsável e rótulo de webhook para o documento enviado depois.
5. Anonimização e "Meus dados" incluem os arquivos de comentários.

## 4. Fora de escopo

- Novos formatos (imagens etc.) **(decisão X2)**.
- Substituir ou apagar um documento ou um arquivo de comentário já enviado **(decisão X5)**.
- Atendente enviar documento de requisito **(decisão X4)**.
- Arquivos pela API (`/api/v1`): continua só JSON; o detalhe pela API passa a listar os metadados dos arquivos de comentários (nome, formato, tamanho), sem download **(decisão X6)**.
- Pré-visualização de arquivos.

## 5. Regras

### 5.1 Arquivos de comentário **(decisões X1 e X2)**

1. Quem pode comentar continua o mesmo (SPEC de comentários): o solicitante dono e os atendentes do setor; solicitação cancelada não recebe comentário.
2. Até **3 arquivos** por comentário, cada um até **2 MiB**, no máximo **4 MiB** somados; formatos **PDF, DOCX e TXT**, detectados pelo conteúdo, como na seção 21. Nome saneado e limitado a 255 caracteres; hash SHA-256 guardado.
3. Até **30 arquivos de comentário** por solicitação; acima disso o envio é recusado.
4. O texto do comentário continua obrigatório (1 a 5.000 caracteres) **(decisão X3)**.
5. O arquivo herda a visibilidade do comentário: arquivo de nota interna só a equipe do setor vê e baixa.
6. Comentário e arquivos são gravados juntos: se um arquivo for recusado, nada é gravado; se a gravação no banco falhar depois do envio ao armazenamento, os objetos enviados são removidos (compensação da seção 21).
7. Chave no armazenamento: `requests/<id da solicitação>/<id do arquivo>`, a mesma estrutura dos documentos, de modo que a limpeza de órfãos continua valendo.

### 5.2 Download

1. `GET /api/requests/{id}/comments/{commentId}/files/{fileId}`: só para quem lê o comentário; senão `404`. Mesmos cabeçalhos dos documentos (`Content-Disposition: attachment` com o nome saneado, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`).
2. Arquivo removido por anonimização: `404` no download; na tela, "Arquivo removido na anonimização".

### 5.3 Documento depois da abertura **(decisões X4 e X5)**

1. Só o **solicitante dono**, com a solicitação **aberta** ou **em atendimento**.
2. Só para requisito **ativo** do serviço da solicitação **sem documento enviado**. Requisito já atendido, inativo ou de outro serviço: `400` no campo do arquivo.
3. Formatos aceitos pelo requisito, 2 MiB por arquivo e 4 MiB somando todos os documentos da solicitação (abertura + depois), como na seção 21.
4. O documento entra na lista de documentos da solicitação como os da abertura, com a data de envio.
5. Histórico: "Documento enviado: *nome do requisito*", com quem e quando.
6. Evento `request.document_added` com `attachmentId` e `actorId`; notificação "Novo documento em *serviço*" ao **responsável efetivo** (tipo `document.added`, categoria de e-mail "comentários e notas internas"); sem responsável, ninguém é notificado, como nos comentários **(decisão X7)**.
7. Webhook: rótulo "Documento enviado"; corpo só com identificadores.

### 5.4 Anonimização e "Meus dados"

1. A anonimização remove do armazenamento os arquivos de comentários enviados pela pessoa e marca as linhas como removidas, como os documentos.
2. "Meus dados" lista, em cada comentário do arquivo, os nomes dos arquivos anexados (sem o conteúdo).

## 6. Dados

Migration aditiva:

- Tabela `RequestCommentFile`: `id`, `requestId`, `commentId`, `originalFilename`, `detectedFormat`, `contentType`, `sizeBytes`, `sha256`, `storageKey` (único), `uploadedById`, `createdAt`, `removedAt`; índices por comentário e por solicitação; restrições iguais às de `RequestAttachment` (tamanho 1 a 2 MiB, hash de 64 caracteres, chave no formato da seção 21).
- Restrições de tipo de `OutboxEvent.type` e `WebhookEndpoint.eventTypes` passam a aceitar `request.document_added`.

Nenhuma dependência nova.

## 7. Critérios de aceitação

- [ ] **CA-ANX-01** — Sem anexar, nada muda: suítes anteriores passam; comentários sem arquivo e documentos de abertura funcionam como antes.
- [x] **CA-ANX-02** — Solicitante e atendente anexam até 3 arquivos válidos a um comentário; os arquivos aparecem no comentário e são baixados com o mesmo conteúdo. *Verificado em 2026-11-03 (SF-125): metadados derivados no servidor, chave na pasta da solicitação, lista no comentário e download com o mesmo conteúdo (unitários e integração); o envio pela tela fica para o E2E da SF-127.*
- [x] **CA-ANX-03** — São recusados, sem gravar comentário nem arquivo: mais de 3 arquivos, arquivo acima de 2 MiB, soma acima de 4 MiB, formato não detectado (mesmo com extensão aceita), mais de 30 arquivos na solicitação, solicitação cancelada. *Verificado em 2026-11-03 (SF-124 e SF-125): cada recusa sem objeto no armazenamento nem linha no banco; o 31º arquivo da solicitação é recusado (unitários e integração).*
- [x] **CA-ANX-04** — Arquivo de nota interna não aparece nem é baixado pelo solicitante (`404`); quem não lê a solicitação recebe `404`. *Verificado em 2026-11-03 (SF-125): o solicitante não recebe a nota nem baixa o arquivo; arquivo pedido com o comentário errado, atendente de outro setor e identificador inválido dão "não encontrado" (unitários e integração).*
- [x] **CA-ANX-05** — O solicitante envia depois da abertura um documento ainda não enviado; ele aparece na lista de documentos e no histórico; o responsável é notificado; o webhook "Documento enviado" recebe o evento. *Verificado em 2026-11-03 (SF-126): o requisito sai da lista do que falta, o documento entra na lista com a data do banco e vira linha "Documento enviado: …" no histórico (só os enviados depois da abertura); o responsável recebe `document.added` e o webhook do evento recebe uma entrega (unitários e integração); a tela fica para o E2E da SF-127.*
- [x] **CA-ANX-06** — São recusados: documento de requisito já atendido, inativo ou de outro serviço; formato não aceito pelo requisito; soma acima de 4 MiB; solicitação concluída ou cancelada; quem não é o solicitante dono. *Verificado em 2026-11-03 (SF-124 e SF-126): cada recusa sem objeto nem linha; o atendente recebe `404` e a lista do que falta fica vazia para ele e para solicitação concluída (unitários e integração).*
- [x] **CA-ANX-07** — Falha do armazenamento ou do banco não deixa linha sem objeto nem objeto sem linha. *Verificado em 2026-11-03 (SF-125 e SF-126): com a transação falhando depois do envio ao armazenamento, o objeto do comentário e o do documento são removidos; recusas acontecem antes de gravar qualquer objeto (unitários).*
- [x] **CA-ANX-08** — A anonimização remove os arquivos de comentários da pessoa; "Meus dados" lista os nomes. *Verificado em 2026-11-03 (SF-125): "Meus dados" traz `arquivos` no comentário; a anonimização apaga o objeto, troca o nome por "Arquivo removido na anonimização" e o download passa a `404` (integração).*
- [ ] **CA-ANX-09** — Nenhuma dependência nova; uma migration aditiva; README explica os anexos. *Parcial em 2026-11-03 (SF-124): migration `20261103300000_request_comment_files` cria a tabela e um índice único em `RequestComment(id, requestId)` (alvo da chave composta) e recria as restrições de tipo só para aceitar `request.document_added`; conferência final na SF-127.*

## 8. Estratégia de testes

- **Unitários:** limites e regras de arquivos de comentário; regra do documento depois da abertura; casos de uso com portas simuladas (inclusive compensação); notificações e histórico.
- **Integração:** gravação com armazenamento em memória; recusas sem gravar nada; download com cada perfil; anonimização e "Meus dados".
- **E2E:** o solicitante comenta com um PDF e o atendente o baixa; uma nota interna com arquivo não aparece ao solicitante; o solicitante envia depois da abertura um documento opcional e o atendente o vê.

## 9. Riscos

- **Armazenamento de produção ausente (SF-030):** mitigação descrita na seção 2.
- **Uso do espaço gratuito do armazenamento:** limites por comentário e por solicitação (5.1.2 e 5.1.3).
- **Corpo da requisição na Vercel:** 4 MiB de arquivos cabem no limite de 4,25 MiB das Server Actions já configurado, com o texto do comentário (até 5.000 caracteres).

## 10. Tarefas (registradas em `TASKS.md`)

| ID | Tarefa |
|---|---|
| SF-124 | Migration e regras dos arquivos de comentário e do documento depois da abertura |
| SF-125 | Arquivos em comentários (envio, lista, download, anonimização, "Meus dados") |
| SF-126 | Documento depois da abertura (envio, histórico, evento, notificação, webhook) |
| SF-127 | E2E, README e revisão |

**Ordem:** SF-124 → SF-125 → SF-126 → SF-127.

## 11. Decisões tomadas (2026-11-03)

Funcionalidade aprovada pela responsável; decisões adotadas como recomendadas.

| # | Questão | Decisão | Alternativas |
|---|---|---|---|
| X1 | Limites por comentário | 3 arquivos, 2 MiB cada, 4 MiB somados; 30 por solicitação | Limites maiores, com risco ao espaço gratuito e ao corpo da requisição |
| X2 | Formatos | Os mesmos da seção 21 (PDF, DOCX, TXT) | Acrescentar PNG e JPEG (exige nova detecção e ajuste do bucket) |
| X3 | Comentário só com arquivo | Não: o texto continua obrigatório | Texto opcional quando há arquivo |
| X4 | Quem envia documento depois | Só o solicitante dono | Também o atendente do setor |
| X5 | Substituir documento | Não: só o que falta | Substituir o enviado, guardando o anterior |
| X6 | Arquivos pela API | Só metadados no detalhe; envio e download fora | Upload em base64 ou multipart pela API |
| X7 | Notificação do documento | Ao responsável efetivo; sem responsável, ninguém | Ao setor inteiro quando não há responsável |
