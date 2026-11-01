# SPEC — Busca, filtros e paginação nas listas de solicitações

**Data:** 2026-10-31
**Status:** Aprovada em 2026-10-31, com as decisões B1 a B4 da seção 12 conforme propostas (nenhum código implementado)
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-10-29-plano-escala-100k.md` (item 13), `SPEC/2026-10-30-camadas-para-100k.md` (passo 3), `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md`, `SPEC/2026-10-31-comentarios.md`

## 1. Objetivo

Hoje "Minhas solicitações" e a "Fila do meu setor" carregam **todas** as solicitações de uma vez, sem busca nem filtro. Com o uso, essas listas crescem sem limite: ficam lentas e difíceis de ler. Esta SPEC acrescenta busca por texto, filtros e paginação a essas duas listas, mantendo as regras de acesso atuais.

## 2. Registro da mudança de escopo

O item 13 do plano de escala ("busca, filtros e paginação nas listas") foi aceito em 2026-10-29, condicionado a esta SPEC. Não altera nenhuma regra de autorização: a busca só procura dentro do que o leitor já pode ver.

## 3. Escopo

1. "Minhas solicitações" (`/requests`) e "Fila do meu setor" (`/queue`): busca, filtros, ordenação e paginação.
2. Estado da busca na URL (parâmetros de consulta), para recarregar, voltar e compartilhar o link.
3. Índices de banco que sustentem as consultas.

## 4. Fora de escopo

- Listas da área administrativa (usuários, setores, categorias e serviços) **(decisão B4)**.
- Busca dentro de comentários e anexos; busca em todo o sistema.
- Busca sem acento (exigiria a extensão `unaccent`) e busca por relevância.
- Filtros salvos, exportação e relatórios (item 11).

## 5. Regras

### 5.1 Escopo da consulta (inalterado)

- O solicitante só busca nas próprias solicitações.
- O atendente só busca nas solicitações do seu setor atual.
- Administrador continua sem acesso. Toda consulta é montada no servidor a partir da sessão; o cliente não informa solicitante nem setor.

### 5.2 Busca por texto **(decisão B2)**

- Um campo "Buscar" procura o termo, **sem distinção de maiúsculas**, na descrição da solicitação e no nome do serviço (o snapshot gravado na abertura).
- Termo de 2 a 100 caracteres, sem espaços periféricos. Termo vazio = sem busca. Termo com 1 caractere ou acima de 100 é rejeitado com mensagem fixa.
- Os caracteres `%` e `_` do termo são tratados como texto, não como curinga.

### 5.3 Filtros **(decisão B3)**

| Filtro | Solicitante | Atendente | Valores |
|---|---|---|---|
| Status | Sim | Sim | Um ou mais entre Aberta, Em atendimento, Concluída, Cancelada; nenhum marcado = todos |
| Responsável | Não | Sim | Todos, "Atribuídas a mim", "Sem responsável" |
| Período de abertura | Sim | Sim | Data inicial e final (inclusivas), no fuso America/Sao_Paulo |

Valores fora da lista, datas inválidas ou data inicial maior que a final são rejeitados com mensagem fixa e a lista não é exibida filtrada de forma incorreta.

"Sem responsável" considera o responsável **efetivo** (regra 5.1 da SPEC de atribuição): uma solicitação cujo responsável saiu do setor conta como sem responsável.

### 5.4 Ordenação

- Opções: "Mais recentes primeiro" e "Mais antigas primeiro", sempre por data de abertura, com o identificador como desempate (ordem estável).
- Padrão de cada lista igual ao de hoje: solicitante "Mais recentes primeiro"; atendente "Mais antigas primeiro" (fila).

### 5.5 Paginação **(decisão B1)**

- **20 solicitações por página**, número fixo.
- Navegação "Anterior" / "Próxima" e o texto "Página X de Y — N solicitações".
- Página fora do intervalo mostra a última página válida; página inválida (não numérica) é tratada como 1.
- Mudar busca, filtro ou ordenação volta para a página 1.

### 5.6 URL

- Exemplo: `/queue?q=cadeira&status=OPEN&status=IN_PROGRESS&assignee=mine&from=2026-10-01&to=2026-10-31&order=oldest&page=2`.
- Parâmetros desconhecidos são ignorados; valores inválidos dos parâmetros conhecidos seguem a regra 5.3.

### 5.7 Contagens

- A contagem de comentários (SPEC de comentários) e o responsável continuam aparecendo em cada item, calculados só para os itens da página.

## 6. Dados (migration somente aditiva)

- Índices em `Request(requesterId, createdAt, id)` e `Request(sectorId, createdAt, id)` para ordenar e paginar por leitor.
- O índice existente `(sectorId, assigneeId)` atende o filtro de responsável.
- Nenhuma coluna nova; nenhum dado alterado. A busca usa `ILIKE` sobre dois campos já limitados pelo escopo do leitor, sem índice de texto nesta versão (ver risco 10).

## 7. Arquitetura

- `requests/domain`: critérios de busca (termo, status, responsável, período, ordem, página), validação e normalização, cálculo de página.
- `requests/application`: `searchRequesterRequests` e `searchAttendantQueue`, que validam os parâmetros brutos da URL e devolvem `{ items, total, page, pageCount }`.
- `requests/infrastructure`: consulta Prisma com `where`, `orderBy`, `skip` e `take`, e `count` com o mesmo filtro.
- Telas: formulário de busca e filtros (GET, sem JavaScript obrigatório) e navegação de páginas, num componente compartilhado.
- As funções atuais `listRequesterRequests` e `listAttendantQueue` continuam existindo (usadas por testes e pela contagem), sem mudança de comportamento.

## 8. Critérios de aceitação

- [x] **CA-BUS-01** — O solicitante só encontra as próprias solicitações e o atendente só as do seu setor atual, com qualquer combinação de busca e filtros; administrador continua negado. *Verificado em 2026-10-31 (SF-058): escopo vindo só da sessão (`search-queries.test.ts`, inclusive com parâmetros forjados) e na integração (`request-search.test.ts`).*
- [x] **CA-BUS-02** — A busca encontra o termo na descrição e no nome do serviço sem distinção de maiúsculas; `%` e `_` são tratados como texto. *Verificado em 2026-10-31 (SF-058): descrição e nome do serviço sem distinção de maiúsculas; `%` e `_` como texto (integração).*
- [x] **CA-BUS-03** — Termo com 1 caractere ou acima de 100 é rejeitado com mensagem fixa. *Verificado em 2026-10-31 (SF-057): `search-criteria.test.ts`.*
- [x] **CA-BUS-04** — O filtro de status aceita um ou mais valores; nenhum marcado mostra todos; valor desconhecido é rejeitado. *Verificado em 2026-10-31 (SF-057) nas regras: um ou mais status, repetidos e vazios descartados, desconhecido rejeitado. A aplicação na consulta é verificada na SF-058.* *Verificado em 2026-10-31 (SF-057 nas regras; SF-058 na consulta).*
- [x] **CA-BUS-05** — O atendente filtra por "Atribuídas a mim" e "Sem responsável", este considerando o responsável efetivo. *Verificado em 2026-10-31 (SF-058): "Atribuídas a mim" e "Sem responsável" com responsável efetivo (mudança de setor e de perfil).*
- [x] **CA-BUS-06** — O período de abertura é inclusivo nas duas datas, no fuso America/Sao_Paulo; data inválida ou início depois do fim é rejeitado. *Verificado em 2026-10-31 (SF-057) nas regras: dias de São Paulo convertidos para instantes (01/10 00:00 = 03:00 UTC), período inclusivo, datas inválidas e período invertido rejeitados. A aplicação na consulta é verificada na SF-058.* *Verificado em 2026-10-31 (SF-057 nas regras; SF-058 na consulta, com horários nas bordas do dia em São Paulo).*
- [x] **CA-BUS-07** — A ordenação "mais recentes" e "mais antigas" é estável; o padrão de cada lista é o atual. *Verificado em 2026-10-31 (SF-058): padrão de cada lista e desempate por identificador estável entre consultas.*
- [x] **CA-BUS-08** — A paginação mostra 20 itens por página, total e número de páginas corretos; página fora do intervalo vai para a última; mudar critérios volta à página 1. *Verificado em 2026-10-31 (SF-058): 25 solicitações em 2 páginas de 20 e 5, sem repetição; página além da última vai para a última. A volta à página 1 ao mudar critérios é da tela (SF-059).*
- [ ] **CA-BUS-09** — O estado da busca fica na URL e é restaurado ao recarregar a página.
- [x] **CA-BUS-10** — Migration aditiva; suítes anteriores passam sem alteração de asserções. *Verificado em 2026-10-31 (SF-057): migration só com dois índices, aplicada no banco de teste; `request-list-indexes.test.ts`; suítes anteriores sem alteração.*

## 9. Estratégia de testes

- **Unitários:** validação e normalização dos parâmetros; escape de `%` e `_`; limites de data no fuso; cálculo de página e de deslocamento.
- **Integração (PostgreSQL de teste):** mais de 20 solicitações para paginar; busca, filtros e ordem combinados; escopo por leitor; responsável efetivo; datas nas bordas do dia.
- **E2E:** atendente busca por um termo, filtra "Atribuídas a mim", troca de página e recarrega mantendo os critérios; solicitante filtra por status.

## 10. Riscos

- **`ILIKE` sem índice de texto:** aceitável porque a consulta já é restrita ao solicitante ou ao setor. Se um setor acumular dezenas de milhares de solicitações, será preciso um índice trigram (`pg_trgm`), em nova SPEC.
- **Fuso horário:** o servidor e o banco trabalham em UTC; as datas do filtro precisam ser convertidas a partir de America/Sao_Paulo, senão solicitações abertas à noite caem no dia errado.

## 11. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-057 | Domínio dos critérios (validação, escape, datas, páginas) e índices |
| SF-058 | Consultas paginadas e casos de uso de busca |
| SF-059 | Telas: formulário de busca e filtros, navegação de páginas |
| SF-060 | E2E e revisão |

## 12. Decisões tomadas (2026-10-31)

Decisões da responsável pelo projeto: **todas as propostas aceitas**.

| # | Questão | Decisão | Alternativa descartada |
|---|---|---|---|
| B1 | Itens por página | 20, fixo | Escolha do usuário entre 10, 20 e 50 |
| B2 | Onde a busca procura | Descrição e nome do serviço | Também nos comentários |
| B3 | Filtros | Status, responsável (atendente) e período de abertura | Também categoria e serviço |
| B4 | Listas da administração | Fora desta SPEC | Incluir busca e paginação nas listas de usuários, setores, categorias e serviços |
