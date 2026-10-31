# Relatório da fase 1 — Refatoração e documentos

**Data:** 2026-10-31
**Exigido por:** `SPEC/2026-10-30-camadas-para-100k.md`, seção 6 (relatório ao fim de cada fase); `SPEC/2026-10-29-plano-escala-100k.md`, seção 6 (fase 1 = itens 1 e 2)
**Período:** da tag `baseline-ap2` (commit `410c07b`) ao commit `bbe064f` (31/10, 16:21), que fecha a SF-036

## 1. Escopo da fase

| Item do plano | Conteúdo | Tarefas | Situação |
|---|---|---|---|
| 1 | Refatoração em camadas | SF-037 a SF-043 | Concluída em 30/10 (SPEC de 2026-10-27, CA-ARQ-01 a 12) |
| 2 | Abertura com documentos, consulta e download | SF-034 a SF-036 | Concluída em 31/10 (SPEC principal, seção 21; CA-DOC-01 a 20 e 22) |

Também entraram na fase, com SPEC própria aprovada antes do código:

| Tarefa | Conteúdo | SPEC |
|---|---|---|
| SF-044 | Modo de demonstração sem senha | Seção 22 da SPEC principal |
| SF-045 | Catálogo e banco fictício (`npm run seed:demo`) | Seções 22.6 e 22.7 |
| SF-046 | Relógio do banco em todo o histórico | Seção 23 |

## 2. Medição (`sh scripts/cloc-diff.sh baseline-ap2 bbe064f`, TypeScript/JavaScript)

| Área | `added` | `removed` |
|---|---:|---:|
| `src` | 4.298 | 2.538 |
| `tests` | 2.974 | 9 |
| `scripts` | 344 | 0 |
| **Total** | **7.616** | **2.547** |

- **Saldo líquido:** 5.069.
- **Previsão do plano para a fase 1:** 7.000 a 12.000 linhas `added` (seção 6 do plano). O resultado ficou no **limite inferior** da faixa.
- **Por que tantas linhas `removed` em `src`:** a refatoração moveu código de dentro de arquivos antigos para as camadas. O cloc conta isso como `removed` + `added`, mas a função é a mesma. O saldo líquido mostra o que é realmente novo.

## 3. Suítes no fechamento da fase (commit `bbe064f`)

| Verificação | Linha de base (29/10) | Fim da fase 1 |
|---|---:|---:|
| Lint, typecheck, build | OK | OK |
| Unitários | 174 | 263 |
| Integração | não executava (sem banco de teste) | 120 |
| E2E | não executava | 4 |

A fase 0 (banco PostgreSQL de teste em `../pgtest`) foi o que permitiu passar a rodar integração e E2E a cada tarefa.

## 4. Critérios cumpridos

- **Refatoração (CA-ARQ-01 a 12):** todos verificados (SF-043). As fronteiras entre camadas e módulos são impostas pelo lint (11 imports proibidos bloqueados na verificação manual).
- **Documentos (CA-DOC-01 a 22):** 21 verificados. **CA-DOC-21 parcial:**
  - verificado: a credencial fica fora do repositório e os testes não usam armazenamento de produção;
  - não verificado: o bucket privado real e a negação de leitura anônima, que dependem do provisionamento da SF-030 (sem credenciais do Supabase nesta máquina).
  - O comando `npm run storage:provision` e o teste de integração do bucket real já estão prontos para quando a chave existir.
- **Demonstração e horário (CA-DEMO-01 a 08, CA-HOR-01 a 04):** verificados.
- **Garantias do plano (seção 7):**
  - asserções dos testes existentes inalteradas;
  - migrations só aditivas;
  - comportamento novo desligado por padrão (serviço sem documento funciona como antes);
  - fronteiras no lint;
  - medição registrada em `NOTES.md` a cada tarefa;
  - nenhuma duplicação ou código gerado em massa.

## 5. Regressões e defeitos

| Quando | O que | Tratamento |
|---|---|---|
| SF-045 (30/10) | Diferença de 9 a 11 ms entre os relógios do Node e do PostgreSQL quebrava 2 testes de `requests-transitions` e revelou que o histórico misturava duas fontes de horário | Nova SPEC (seção 23) e SF-046; teste com relógio deslocado em ±1 h prova a correção |
| SF-045 (30/10) | `prepare-e2e.ts` não limpava as tabelas de documentos | Corrigido |
| SF-034 (31/10) | Um teste antigo de schema falhou com `attachments: []` como valor padrão | Corrigido no código (campo opcional), sem mudar o teste |
| Durante toda a fase | Aviso "The destination stream closed early" no servidor do E2E | Já existia antes (confirmado com `git stash`); não investigado |

Nenhuma regressão chegou a um commit: as suítes completas passaram antes de cada um.

## 6. Tempo gasto

`diario/tempo-do-projeto.md` registra **23h06** até 29/10 às 17:32 (antes da fase 1). Pela regra do próprio arquivo (do primeiro ao último registro do dia), a fase 1 levou:

| Período | Início | Fim | Duração | Precisão |
|---|---|---|---:|---|
| 29/10 (noite) a 30/10 (madrugada) | 17:33 | 01:35 | até 8h02 | Estimado por commits, sem descontar pausas |
| 31/10 (até o fim da SF-036) | antes de 16:00 | 16:21 | ≥ 0h21 | Parcial: a sessão começou antes do primeiro commit |

O ritmo da fase não é comparável ao do plano (470 linhas por hora): a fase 1 teve muito código movido (refatoração) e a sessão de 31/10 não tem início registrado. A partir da fase 2, o início de cada sessão deve ser anotado.

## 7. Situação depois da fase 1 (31/10, 19:19)

- **Fase 2 começou:** SPEC de atribuição, cancelamento e reabertura (item 3 do plano) concluída no mesmo dia (SF-047 a SF-052, CA-ATR-01 a 14).
- **Medição em `9cd8aca`:** 10.109 linhas `added` (10,1% da meta).
- **Suítes:** unitários 315, integração 142 + 1 pulado, E2E 5.
- **Site publicado na Vercel** com banco Neon: https://serviceflow-sand.vercel.app

## 8. Recalibração do plano

| Fase | Previsão do plano (acumulado) | Situação |
|---|---:|---|
| 1 | 7.000 – 12.000 | 7.616 (limite inferior) |
| 2 | 26.000 – 39.000 | Em andamento: 10.109; faltam comentários (4), SLA (5) e busca (13) |

O item 3 (atribuição) rendeu cerca de 1.800 linhas `added`, contra a previsão de 5.000 a 7.000. O plano estimou o item com aplicação e testes completos, e isso foi entregue. A diferença sugere que **as estimativas do plano estão infladas em cerca de 3 vezes** para funcionalidades desse porte. Se a proporção se mantiver, implementar **todos** os 16 itens do plano pode ficar bem abaixo de 100.000 linhas. Isso reforça o alerta da seção 5 do plano: a meta depende do roadmap inteiro e não pode ser compensada com código artificial (SF-026). O próximo relatório de fase deve confirmar ou corrigir essa tendência.

## 9. Pendências que passam para a fase 2

1. SF-030: provisionar o armazenamento real (depende de credenciais do Supabase) e fechar o CA-DOC-21.
2. Banco Neon: trocar a senha se o banco receber dado real.
3. Registrar o início de cada sessão em `diario/tempo-do-projeto.md`.
