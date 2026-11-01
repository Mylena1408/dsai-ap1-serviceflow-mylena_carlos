# Relatório da fase 2 — Núcleo de atendimento

**Data:** 2026-11-01
**Exigido por:** `SPEC/2026-10-30-camadas-para-100k.md`, seção 6 (relatório ao fim de cada fase); `SPEC/2026-10-29-plano-escala-100k.md`, seção 6 (fase 2 = itens 3, 4, 5 e 13)
**Período:** do commit `bbe064f` (31/10, 16:21), que fechou a fase 1, ao commit `0038b7e` (01/11, 02:37), que fecha a SF-070

## 1. Escopo da fase

| Item do plano | Conteúdo | Tarefas | SPEC | Situação |
|---|---|---|---|---|
| 3 | Atribuição, transferência no setor, cancelamento e reabertura | SF-047 a SF-052 | `2026-10-31-atribuicao-cancelamento-reabertura.md` | Concluída em 31/10 (CA-ATR-01 a 14) |
| 4 | Comentários e notas internas | SF-053 a SF-056 | `2026-10-31-comentarios.md` | Concluída em 31/10 (CA-COM-01 a 09) |
| 13 | Busca, filtros e paginação | SF-057 a SF-060 | `2026-10-31-busca-filtros-paginacao.md` | Concluída em 31/10 (CA-BUS-01 a 10) |
| 5 | Prioridades, SLA e alertas | SF-065 a SF-070 | `2026-11-01-sla-prioridades.md` | Concluída em 01/11 (CA-SLA-01 a 10) |

Também entrou na fase, como base para os alertas do SLA (passo 1 da ordem de execução, `camadas-para-100k`, seção 5):

| Camada | Tarefas | SPEC | Situação |
|---|---|---|---|
| Eventos de domínio, outbox, jobs agendados e notificações na aplicação | SF-061 a SF-064 | `2026-10-31-eventos-outbox-jobs.md` | Concluída em 01/11 (CA-EVT-01 a 09) |

E, ainda do item 2 (fase 1), o preparo do provisionamento do bucket privado (SF-030, commit `df68e1f`), que continua parcial por falta de credenciais do Supabase.

**Partes dos itens que ficaram fora, registradas como fora de escopo nas SPECs:**

- Item 3: transferência para outro setor e atribuição automática.
- Item 4: anexos em comentários (o plano incluía; a SPEC de comentários deixou de fora). O item 4 está **parcialmente** atendido.
- Item 5: calendário de feriados, pausa do prazo e alertas por e-mail.
- Item 13: busca nas listas administrativas, busca sem acento e busca por relevância.
- Item 10 (fase 4), adiantado em parte: só existem as notificações na aplicação. E-mail e preferências por usuário continuam pendentes.

## 2. Medição

### 2.1. Por área (`sh scripts/cloc-diff.sh`, TypeScript/JavaScript)

| Área | Acumulado (`baseline-ap2` → `0038b7e`) | Só a fase 2 (`bbe064f` → `0038b7e`) |
|---|---:|---:|
| `src` | 7.351 | 3.093 |
| `tests` | 7.418 | 4.448 |
| `scripts` | 490 | 146 |
| **Total `added`** | **15.259** | **7.687** |
| `removed` | 2.554 | 51 |
| **Saldo líquido** | **12.705** | **7.636** |

- **Quase nada foi removido na fase** (51 linhas): ao contrário da fase 1, não houve código movido, e o que foi contado é código novo.
- **Testes:** 1,44 linha de teste por linha de aplicação na fase (4.448 para 3.093).

### 2.2. Por SPEC (diferença entre medições acumuladas no último commit de cada uma)

| SPEC | Último commit | Acumulado | Linhas da SPEC | Estimativa do plano | Razão estimativa ÷ real |
|---|---|---:|---:|---:|---:|
| Fim da fase 1 | `bbe064f` | 7.616 | — | — | — |
| SF-030, preparo do provisionamento (item 2) | `568d752` | 7.897 | 281 | (incluída no item 2) | — |
| Atribuição (item 3) | `9cd8aca` | 10.109 | 2.212 | 5.000–7.000 | 2,3 a 3,2 |
| Comentários (item 4) | `797c2ba` | 10.955 | 846 | 5.000–7.000 | 5,9 a 8,3 |
| Busca e paginação (item 13) | `2cc83a6` | 11.831 | 876 | 3.000–4.000 | 3,4 a 4,6 |
| Eventos, outbox, jobs e notificações | `ff65f7e` | 13.479 | 1.648 | 4.000–6.000 (duas camadas da seção 3) | 2,4 a 3,6 |
| SLA e prioridades (item 5) | `0038b7e` | 15.259 | 1.780 | 6.000–9.000 | 3,4 a 5,1 |

- A soma das linhas por SPEC (7.643) difere em 44 linhas da medição direta da fase (7.687), porque o cloc compara arquivos inteiros em cada medição e as diferenças não somam exatamente.
- **Correção do relatório da fase 1:** a seção 8 daquele relatório disse que a atribuição rendeu "cerca de 1.800 linhas". Medindo a partir do fim da SF-030 (`568d752`), o valor é **2.212**. A conclusão daquele relatório (estimativas cerca de 3 vezes maiores que o real) continua válida.

## 3. Suítes

| Verificação | Fim da fase 1 (`bbe064f`) | Fim da fase 2 (`0038b7e`) |
|---|---:|---:|
| Lint, typecheck, build | OK | OK |
| Unitários | 263 | 398 (71 arquivos) |
| Integração | 120 | 186 + 1 pulado (42 arquivos) |
| E2E | 4 | 9 |

- O teste pulado é o do bucket real do Supabase (`tests/integration/document-storage-supabase.test.ts`), criado no preparo da SF-030 e que só roda com credenciais.
- As suítes completas passaram antes de cada commit da fase. Os números de cada tarefa estão em `NOTES.md`.
- **Situação do ambiente neste relatório:** o PostgreSQL de teste (`../pgtest`) foi encerrado por falta de memória da máquina depois da SF-070. As suítes não foram executadas de novo para este relatório, que só acrescenta documentação.

## 4. Critérios cumpridos

- **CA-ATR-01 a 14, CA-COM-01 a 09, CA-BUS-01 a 10, CA-EVT-01 a 09 e CA-SLA-01 a 10:** 52 critérios, todos verificados por testes (unitários, de integração e E2E), conforme o registro de cada SPEC.
- **Pendente de fases anteriores:** CA-DOC-21 continua parcial (SF-030, sem credenciais do Supabase).
- **Garantias do plano (seção 7):**
  - **Asserções dos testes existentes:** só duas mudanças, ambas exigidas por SPEC e registradas. A lista exata de tipos de evento do teste da SF-061 (`tests/unit/modules/events/domain-event.test.ts`) recebeu `request.priority_changed` (SF-067) e `request.sla_warning` e `request.sla_breached` (SF-069). Além disso, um dublê de `tests/unit/authorization/index.test.ts` ganhou o campo `dueSoonAt: null` (SF-068), sem mudar asserções.
  - **Migrations aditivas, com uma exceção registrada:** a migration do SLA (SF-065) apagou e recriou a restrição `OutboxEvent_type_check` para aceitar os três tipos novos de evento. É uma restrição mais ampla que a anterior e nenhum dado é perdido, mas não é uma operação só de acréscimo. Está registrada em `NOTES.md` (SF-065).
  - **Comportamento novo desligado por padrão:** serviço sem prazo continua sem SLA; solicitação sem responsável funciona como antes.
  - **Nenhuma dependência nova** na fase.
  - **Nenhuma duplicação ou código gerado em massa** (SF-026).

## 5. Regressões e defeitos

| Quando | O que | Tratamento |
|---|---|---|
| SF-050 (31/10) | O caminho `note` não estava na lista de erros públicos de validação: a mensagem "informe a justificativa" nunca apareceria na tela | Encontrado por teste; corrigido em `src/server/errors` |
| SF-057 (31/10) | Data fora do formato no filtro (`31/10/2026`) lançava `RangeError` em vez da mensagem de validação | Encontrado por teste; a data passou a ser validada antes do cálculo |
| SF-064 (01/11) | O redirecionamento da notificação usava o endereço absoluto da requisição (`localhost` × `127.0.0.1`): o cookie não valia e o usuário caía no login | Encontrado pelo E2E; `Location` relativo |
| SF-064 (01/11) | O contador de notificações no layout não atualizava depois de abrir a notificação | Encontrado pelo E2E; navegação completa e revalidação do layout. Limitação registrada: notificação nova só aparece numa navegação completa |
| SF-063, SF-065, SF-067, SF-069 | Erros meus em testes e dublês (uma verificação sem sentido; dublê que sobrescrevia campos calculados; `ValidationError` com `path` em texto; dublê com parâmetros a menos) | Encontrados pelo typecheck ou na revisão, antes do commit |
| Toda a fase | Aviso "The destination stream closed early" no servidor do E2E | Já existia na fase 1 (confirmado com `git stash`, relatório da fase 1). Continua sem investigação; não quebra testes |

Nenhuma regressão chegou a um commit.

## 6. Publicação

- O site https://serviceflow-sand.vercel.app foi publicado duas vezes na fase, a pedido da responsável: comentários e busca (`2cc83a6`) e eventos e notificações, com o cron diário (`ff65f7e`).
- **O SLA ainda não está publicado.** Antes do próximo deploy, é preciso aplicar no Neon as migrations `20261101100000_sla_and_priorities` e `20261101200000_sla_due_soon_at`.

## 7. Tempo gasto

Fonte: horários das transcrições do Claude Code, convertidos para UTC−3, com a regra de `diario/tempo-do-projeto.md` (um intervalo sem registro acima de 60 minutos separa os períodos).

| Período | Início | Fim | Duração | Trabalho |
|---|---|---|---:|---|
| 31/10 (tarde) | 16:21 | 19:25 | 3h04 | SF-030 (preparo), configuração da Vercel, atribuição, relatório da fase 1 |
| 31/10 (noite) | 20:38 | 21:03 | 0h25 | Comentários |
| 31/10 a 01/11 (madrugada) | 22:05 | 03:56 | 5h51 | Busca, eventos e notificações, SLA |
| **Total da fase** | | | **9h20** | |

- O início da fase (16:21) é o horário do commit `bbe064f`; antes disso, no mesmo período, a sessão tratava da fase 1 (desde 15:37).
- **Ritmo:** cerca de **820 linhas `added` por hora** (7.687 em 9h20), contra 470 por hora usado no plano. A duração inclui pausas e o tempo de espera do agente.

## 8. Recalibração do plano

| Fase | Previsão do plano (acumulado) | Real |
|---|---:|---:|
| 1 | 7.000 – 12.000 | 7.616 |
| 2 | 26.000 – 39.000 | **15.259** |

A fase 2 ficou **bem abaixo** da faixa prevista. Os quatro itens da fase (3, 4, 5 e 13) somaram 5.714 linhas, contra uma estimativa de 19.000 a 27.000: **as estimativas estão de 3,3 a 4,7 vezes acima do real**. Isso confirma a tendência apontada no relatório da fase 1 e indica que ela é ainda mais forte.

**Projeção para os itens que faltam (6, 7, 8, 9, 10, 11, 12, 14, 15 e 16):**

| Medida | Mínimo | Máximo |
|---|---:|---:|
| Estimativa do plano para esses itens | 67.000 | 98.000 |
| Corrigida pela razão observada (÷ 4,7 e ÷ 3,3) | ~14.000 | ~30.000 |
| **Total projetado ao fim do roadmap inteiro** | **~29.000** | **~45.000** |

**Conclusão:** se a proporção se mantiver, implementar **todos** os 16 itens do plano, com testes reais, deve levar o projeto a algo entre 30.000 e 45.000 linhas `added`, **menos da metade da meta de 100.000**. A seção 5 do plano e a SF-026 proíbem compensar a diferença com código artificial.

Os itens da fase 3 (campos personalizados, fluxos e aprovações) podem render mais do que os da fase 2, porque têm editor, validação dinâmica e regras com vários níveis. Mesmo assim, para chegar a 100.000 eles precisariam render cerca de 10 vezes o observado até aqui, o que não é provável.

**Decisão pendente da responsável** (não tomada neste relatório):

1. seguir o roadmap e aceitar que a meta provavelmente não será alcançada, registrando o motivo no relatório final;
2. ampliar o escopo com funcionalidades reais, cada uma com SPEC própria aprovada (por exemplo, as partes que as SPECs deixaram fora de escopo, como anexos em comentários, transferência entre setores, calendário de feriados e e-mail);
3. revisar a meta junto a quem a definiu.

**Decisão tomada em 2026-11-01:** a responsável escolheu a **opção 2**: acrescentar funcionalidades reais, cada uma com SPEC própria aprovada antes do código. Continuam valendo a SF-026 e a seção 5 do plano (nada de duplicação, geração em massa ou funcionalidade fictícia). O roadmap dos 16 itens segue na ordem do plano, e as funcionalidades novas entram como SPECs adicionais.

O relatório da fase 3 deve medir de novo a razão e atualizar a projeção.

## 9. Pendências que passam para a fase 3

1. SF-030: provisionar o armazenamento real (depende de credenciais do Supabase) e fechar o CA-DOC-21.
2. Aplicar no Neon as migrations do SLA antes da próxima publicação.
3. Banco Neon: trocar a senha se o banco receber dados reais.
4. Propor, ao longo das próximas fases, as funcionalidades adicionais da opção 2 (seção 8), cada uma com SPEC própria.
5. Próxima SPEC: campos personalizados por serviço (item 6), primeiro passo da fase 3.
