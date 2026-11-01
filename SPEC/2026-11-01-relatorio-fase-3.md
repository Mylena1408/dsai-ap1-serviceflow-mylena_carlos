# Relatório da fase 3 — Configurabilidade

**Data:** 2026-11-01
**Exigido por:** `SPEC/2026-10-30-camadas-para-100k.md`, seção 6 (relatório ao fim de cada fase); `SPEC/2026-10-29-plano-escala-100k.md`, seção 6 (fase 3 = itens 6, 7 e 8)
**Período:** do commit `0038b7e` (01/11, 02:37), que fechou a fase 2, ao commit `334a890` (01/11, 18:56), que fecha a SF-086

## 1. Escopo da fase

| Item do plano | Conteúdo | Tarefas | SPEC | Situação |
|---|---|---|---|---|
| 6 | Campos personalizados por serviço | SF-071 a SF-075 | `2026-11-01-campos-personalizados.md` | Concluída (CA-FLD-01 a 10) |
| 7 | Fluxos configuráveis (etapas do atendimento) | SF-076 a SF-080 | `2026-11-01-fluxos-configuraveis.md` | Concluída (CA-FLX-01 a 11) |
| 8 | Aprovações com o perfil Gestor | SF-081 a SF-086 | `2026-11-01-aprovacoes.md` | Concluída (CA-APR-01 a 10) |

**Partes deixadas fora de escopo pelas SPECs** (candidatas a SPECs adicionais, seção 8):

- Campos: campos condicionais, seleção múltipla, número decimal, máscaras, campos preenchidos pelo atendente, busca pelas respostas.
- Fluxos: responsável e prazo por etapa, ramificações, filtro da fila por etapa.
- Aprovações: vários níveis, delegação e substituição de gestor ausente, prazo para aprovar, aprovação por condição.

## 2. Medição

### 2.1. Por área (`sh scripts/cloc-diff.sh`, TypeScript/JavaScript)

| Área | Acumulado (`baseline-ap2` → `334a890`) | Só a fase 3 (`0038b7e` → `334a890`) |
|---|---:|---:|
| `src` | 10.277 | 2.971 |
| `tests` | 11.525 | 4.107 |
| `scripts` | 541 | 51 |
| **Total `added`** | **22.343** | **7.129** |
| `removed` | 2.536 | 27 |
| **Saldo líquido** | **19.807** | **7.102** |

- **Testes:** 1,38 linha de teste por linha de aplicação na fase (4.107 para 2.971).

### 2.2. Por SPEC (diferença entre medições acumuladas)

| SPEC | Último commit | Acumulado | Linhas da SPEC | Estimativa do plano | Razão estimativa ÷ real |
|---|---|---:|---:|---:|---:|
| Fim da fase 2 | `0038b7e` | 15.259 | — | — | — |
| Campos personalizados (item 6) | `158336b` | 18.355 | 3.096 | 8.000–12.000 | 2,6 a 3,9 |
| Fluxos configuráveis (item 7) | `3c918b6` | 20.691 | 2.336 | 10.000–14.000 | 4,3 a 6,0 |
| Aprovações (item 8) | `334a890` | 22.343 | 1.652 | 7.000–10.000 | 4,2 a 6,1 |

- A soma por SPEC (7.084) difere em 45 linhas da medição direta da fase (7.129), pelo mesmo motivo do relatório da fase 2: o cloc compara arquivos inteiros em cada medição.
- **Correção de um número informado durante a fase:** ao fim da SF-075, informei que a SPEC de campos somou 2.275 linhas. O valor correto é **3.096** (de 15.259 para 18.355).

## 3. Suítes

| Verificação | Fim da fase 2 (`0038b7e`) | Fim da fase 3 (`334a890`) |
|---|---:|---:|
| Lint, typecheck, build | OK | OK |
| Unitários | 398 | 534 (91 arquivos) |
| Integração | 186 + 1 pulado | 251 + 1 pulado (55 arquivos) |
| E2E | 9 | 13 |

- As suítes completas passaram antes de cada commit da fase.
- O teste pulado continua sendo o do bucket real do Supabase (SF-030, sem credenciais).

## 4. Critérios cumpridos

- **CA-FLD-01 a 10, CA-FLX-01 a 11 e CA-APR-01 a 10:** 31 critérios, todos verificados por testes unitários, de integração e E2E.
- **Pendente de fases anteriores:** CA-DOC-21 continua parcial (SF-030).
- **Garantias do plano (seção 7):**
  - **Asserções de testes existentes alteradas, todas exigidas pelas SPECs e registradas:** a lista exata de tipos de evento (fluxos e aprovações) e a contagem de e-mails de demonstração (3 → 4, com a conta do gestor).
  - **Ajustes só de configuração em testes existentes:** `vi.mock` dos módulos novos em arquivos que importam as mesmas ações, colunas novas em objetos de teste tipados e no dublê em memória, listas vazias novas nos objetos da linha do tempo.
  - **Migrations aditivas, com restrições recriadas mais amplas e registradas:** tipos de evento da outbox (fluxos e aprovações), setor obrigatório também para o gestor e a regra de vencimento do SLA (aprovações). Nenhum dado existente mudou.
  - **Comportamento novo desligado por padrão:** serviço sem campos, sem etapas e sem aprovação funciona como antes.
  - **Nenhuma dependência nova** na fase.
  - **Nenhuma duplicação ou código gerado em massa** (SF-026). A ordenação "Subir/Descer" dos documentos foi movida para `src/shared/ordering` e passou a servir também aos campos e às etapas, em vez de ser copiada.

## 5. Regressões e defeitos

| Quando | O que | Tratamento |
|---|---|---|
| SF-072 | Depois de enviar o formulário de campo, a tela voltava o tipo para "Texto curto" mas continuava mostrando os campos do tipo anterior | Encontrado no navegador; o componente acompanha o `reset` do formulário |
| SF-076 | Um comentário SQL com a palavra "copy" violava o teste que proíbe `COPY` nas migrations | Encontrado por teste existente; comentário reescrito |
| SF-078 | Dois cliques em "Avançar" (de uma ou de duas pessoas) avançavam duas etapas | Encontrado pelo teste de integração; o pedido passou a levar a etapa vista na tela (esclarecimento na SPEC) |
| SF-081 | A restrição recriada do vencimento do SLA usava `IN` sem tratar o nulo e afrouxava a regra para todas as solicitações sem aprovação | Encontrado pelo teste de schema antes do commit; `COALESCE` e a restrição substituída nos bancos locais; nada publicado |
| SF-085 | A observação da rejeição aparecia duas vezes no histórico | Encontrado no navegador; mostrada só na decisão |
| Toda a fase | Aviso "The destination stream closed early" no servidor do E2E | Já existia na fase 1; continua sem investigação e sem falha de teste |
| Toda a fase | Comportamento antigo: um envio recusado nos formulários de criação da administração apaga o que foi digitado | Registrado na SF-072, não alterado (fora de escopo) |

Nenhuma regressão chegou a um commit.

## 6. Publicação

- O site publicado continua na versão anterior ao SLA. Antes do próximo deploy, é preciso aplicar no Neon seis migrations: `20261101100000_sla_and_priorities`, `20261101200000_sla_due_soon_at`, `20261101300000_service_fields`, `20261101400000_service_stages`, `20261101500000_manager_role` e `20261101500100_approvals`.

## 7. Tempo gasto

Fonte: horários das transcrições do Claude Code, em UTC−3, com a regra de `diario/tempo-do-projeto.md`.

| Período | Início | Fim | Duração | Trabalho |
|---|---|---|---:|---|
| 01/11 | 11:25 | 18:59 | 7h34 | SPECs de campos, fluxos e aprovações e as tarefas SF-071 a SF-086 |

- A sessão começou às 11:06; até 11:25 ela tratou do relatório da fase 2.
- O PostgreSQL de teste foi encerrado três vezes por falta de memória da máquina e religado a pedido da responsável; o tempo parado está incluído.
- **Ritmo:** cerca de **940 linhas `added` por hora** (7.129 em 7h34), acima das 820 da fase 2.

## 8. Recalibração do plano

| Fase | Previsão do plano (acumulado) | Real |
|---|---:|---:|
| 1 | 7.000 – 12.000 | 7.616 |
| 2 | 26.000 – 39.000 | 15.259 |
| 3 | 51.000 – 75.000 | **22.343** |

Os itens 6, 7 e 8 somaram 7.084 linhas, contra 25.000 a 36.000 estimadas: **as estimativas ficaram de 3,5 a 5,1 vezes acima do real**, a mesma faixa da fase 2 (3,3 a 4,7). A tendência está confirmada.

**Projeção para os itens que faltam (9, 10, 11, 12, 14, 15 e 16):**

| Medida | Mínimo | Máximo |
|---|---:|---:|
| Estimativa do plano (o item 10 já tem as notificações na aplicação; restam e-mail e preferências, contados como 4.000 a 7.000) | 39.000 | 59.000 |
| Corrigida pela razão observada (÷ 5,1 e ÷ 3,5) | ~7.600 | ~16.900 |
| **Total projetado ao fim do roadmap** | **~30.000** | **~39.000** |

**Situação da meta:** com a decisão da fase 2 (opção 2: acrescentar funcionalidades reais, cada uma com SPEC aprovada), faltariam de 61.000 a 70.000 linhas além do roadmap. No ritmo observado, isso equivale a dezenas de SPECs do porte das desta fase. As partes que as próprias SPECs deixaram fora de escopo (seção 1) e as das fases anteriores (anexos em comentários, transferência entre setores, calendário e pausa do SLA, e-mail) são as primeiras candidatas; cada uma ainda precisa de SPEC aprovada. Nenhuma linha pode vir de código artificial (SF-026).

O relatório da fase 4 deve medir de novo a razão e atualizar a projeção.

## 9. Pendências que passam para a fase 4

1. SF-030: provisionar o armazenamento real (credenciais do Supabase) e fechar o CA-DOC-21.
2. Aplicar no Neon as seis migrations da seção 6 antes da próxima publicação.
3. Banco Neon: trocar a senha se receber dados reais.
4. Fase 4 do plano: permissões configuráveis (item 9), notificações por e-mail e preferências (resto do item 10), painel e relatórios (item 11), auditoria e LGPD (item 12), cada um com SPEC própria.
5. Escolher, entre as candidatas da seção 8, as funcionalidades adicionais da opção 2.
