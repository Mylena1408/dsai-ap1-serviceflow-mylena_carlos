# SPEC — Desempenho das análises com volume alto

**Data:** 2026-11-06
**Status:** Aprovada em 2026-11-06, dentro da "manutenção curta" (verificar o desempenho com volume alto) aprovada pela responsável. **Concluída em 2026-11-06 para as análises** (SF-160; CA-DVO-02 e 03 verificados). O CA-DVO-01 **não foi atingido** em "Aprovações": a causa é outra (seção 7) e depende de decisão da responsável.
**Projeto:** ServiceFlow
**Referências:**
- `SPEC/2026-11-06-analises-operacionais.md`: seção 5.4 ("pendentes" no fim de cada ponto da tendência) e seção 5.8 (tudo é agregado pelo banco a cada visita).

## 1. Medição

Ambiente:
- banco local separado (`serviceflow_perf`), que não é o banco de teste nem o de produção;
- dados de demonstração clonados 7.000 vezes, espalhados pelos últimos 12 meses: **98.014 solicitações**, 196.028 eventos de status, 56.008 de atribuição e 28.004 comentários;
- aplicação em modo produção (`next start`); cada página foi aberta duas vezes e vale a segunda.

Resultados:
- **Normais:** catálogo, listas, busca, detalhe, painéis, auditoria e usuários, todos entre 110 e 310 ms.
- **"Análises"** (gestor e administrador): **nenhuma resposta em 120 s**. As consultas continuavam rodando no banco depois de 5 minutos, mesmo com o navegador já desistido.

## 2. Causas

1. **`RequestStatusEvent` não tem índice em `requestId`.** As subconsultas "último status antes do instante" e "início do atendimento" percorrem a tabela inteira de eventos para cada solicitação, e o custo cresce com o quadrado do volume. Com o índice criado à mão no banco de medição, as análises caem para 6 a 15 s.
2. **"Pendentes ao fim de cada ponto" (`pendingAt`)** examina, para cada ponto da tendência, **todas as solicitações já criadas** e busca o último evento de cada uma. São cerca de 3 milhões de buscas para 30 pontos. A consulta sozinha leva de 5 a 15 s, mesmo com o índice, e piora conforme o histórico cresce, ainda que o período seja curto.

## 3. Escopo

1. **Migration aditiva:** índice `RequestStatusEvent("requestId", "occurredAt", "id")`. Ele também atende à leitura do histórico de uma solicitação.
2. **Reescrita de `pendingAt`, com o mesmo resultado:**
   - lê uma vez só os eventos do escopo anteriores ao último ponto;
   - transforma cada evento num intervalo, do momento em que aconteceu até o próximo evento da mesma solicitação (`lead`, na ordem `occurredAt`, `id`);
   - descarta os intervalos que não são pendentes ou que terminaram antes do primeiro ponto;
   - conta, para cada ponto, os intervalos que o contêm.

   É exatamente a regra de 5.4: o último evento antes do instante decide.
3. Medir de novo e registrar. Se outra consulta passar de 1 s, ela entra aqui antes de qualquer mudança.
4. **Acrescentado na medição (2026-11-06):** "primeira resposta" (`firstResponse`) levava 2,1 s em 90 dias. O plano mostrou que o PostgreSQL embutia a CTE `opened` e calculava as duas subconsultas de `answeredAt` três vezes por solicitação, uma para cada agregado (6 subplanos de 22.505 execuções). `WITH opened AS MATERIALIZED` calcula uma vez, com o mesmo resultado: de 773 ms para 265 ms isolada.

## 4. Fora de escopo

- **Cache ou tabelas de resumo:** a SPEC de análises decidiu agregar a cada visita.
- **Índices nas chaves de "quem fez"** (`actorId` e semelhantes): só são conferidas quando um usuário é excluído, e o sistema não exclui usuários.
- **Mudança nas regras, nos números ou nas telas.**

## 5. Critérios de aceitação

- [ ] **CA-DVO-01** — Com as 98.014 solicitações, todas as páginas medidas, incluindo as análises de 30 e 90 dias, respondem em menos de 2 s no ambiente local. *Medido em 2026-11-06: **atingido para as análises** (gestor 1,15 s e 0,95 s; administrador 1,00 s e 0,91 s, para 30 e 90 dias; antes, sem resposta em 120 s) e para as demais telas (110 a 450 ms). **Não atingido em "Aprovações"**: 4,3 s (pendentes) e 13,8 s (todas). Ver seção 7.*
- [x] **CA-DVO-02** — `pendingAt` devolve os mesmos números da consulta antiga: no teste de integração existente e, no banco de medição, em pelo menos 3 conjuntos de pontos, para um setor e para todos. *Verificado em 2026-11-06: integração `analytics-reader.test.ts` (dois setores, reabertura e cancelamento) passa; no banco de medição, 8 comparações iguais (30 pontos diários, 13 semanais, 6 aleatórios no ano e 1 ponto, para um setor e para todos). A nova consulta leva de 0,5 a 0,85 s, contra até 12,7 s da antiga. Limite: os dados clonados ficam todos num setor, então ali "um setor" e "todos" coincidem.*
- [x] **CA-DVO-03** — A migration é aditiva e só cria o índice; nenhuma dependência nova; todas as suítes passam. *Verificado em 2026-11-06: migration `20261106500000_status_event_request_index` só com `CREATE INDEX`, gerada por diff de schemas; `package.json` sem mudança; lint, typecheck e build OK; unitários 1193/1193; integração 445/445; E2E 31/31.*

## 6. Tarefas

- **SF-160** — Índice, reescrita de `pendingAt`, nova medição e registros.

## 7. Achado fora do escopo: "Aprovações" sem paginação

A página do gestor (`/approvals`) não tem paginação. Ela carrega **todas** as solicitações do filtro, cada uma com o histórico completo (`listForApproval` e `listBySector` devolvem `RequestWithHistory[]`):
- "Pendentes": 7.001 solicitações no banco de medição, 4,3 s;
- "Todas": 21.003 solicitações, 13,8 s;
- "Todas do setor": pode chegar a todas as solicitações do setor. Não foi medida, porque o gestor de demonstração não tem a permissão.

Nenhuma consulta isolada passou de 150 ms: o custo é o volume de linhas e a montagem da página. Resolver exige paginação, ou seja, mudar a tela. Isso fica para uma SPEC própria, depois da decisão da responsável.
