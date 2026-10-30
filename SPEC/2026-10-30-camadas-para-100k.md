# SPEC — Camadas para chegar a 100.000 linhas executáveis

**Data:** 2026-10-30  
**Status:** Proposta de organização (complementa o plano aprovado)  
**Projeto:** ServiceFlow  
**Referências:** `SPEC/2026-10-29-plano-escala-100k.md` (itens 1 a 16 e fases aprovadas), `SPEC/2026-10-27-refatoracao-arquitetural.md`, `scripts/cloc-diff.sh`

## 1. Objetivo

Organizar, por **camadas** da arquitetura em camadas, as funcionalidades já aprovadas no plano de escala, indicando a ordem de execução e os relatórios obrigatórios até a meta de 100.000 linhas `added` medidas com `cloc --diff` contra a tag `baseline-ap2`.

Este documento não autoriza implementação: cada camada e cada módulo exige SPEC própria antes do código (`AGENTS.md`, regras 2 e 7).

## 2. Situação em 2026-10-30

- Medição (`sh scripts/cloc-diff.sh`, commit `658c7da`): **4.813 linhas `added`**; saldo líquido 2.790.
- Faltam aproximadamente **95.200 linhas `added`**.
- Refatoração: SF-037 a SF-041 concluídas; SF-042 e SF-043 pendentes.
- Modo de demonstração (SF-044) e banco fictício (SF-045) concluídos.

## 3. Camadas transversais (infraestrutura nova usada por vários módulos)

| Camada | Conteúdo | Itens do plano atendidos | Estimativa (código + testes) |
|---|---|---|---:|
| Eventos de domínio + outbox | Publicação de eventos ("solicitação aberta", "concluída"…) na mesma transação e consumo posterior | 5, 10, 12 | 2.000–3.000 |
| Jobs agendados | Rotas de cron (Vercel Cron), fila simples, reprocessamento | 5, 10 | 2.000–3.000 |
| Autorização configurável | Papéis e permissões por escopo, motor de políticas | 9 | 7.000–10.000 |
| Adaptadores externos | E-mail, armazenamento (Supabase Storage), webhooks de saída | 2, 10, 14 | 3.000–5.000 |
| Leitura e relatórios | Consultas agregadas, indicadores, exportação CSV | 11 | 6.000–9.000 |
| API HTTP pública | Rotas `/api/v1`, objetos de transferência, tokens, documentação OpenAPI | 14 | 6.000–9.000 |
| Auditoria e observabilidade | Trilha de auditoria, logs estruturados, retenção e anonimização (LGPD) | 12 | 5.000–7.000 |
| Componentes de interface compartilhados | Tabela, filtros, paginação, formulário dinâmico | 6, 11, 13 | 4.000–6.000 |

## 4. Módulos novos (cada um com `domain`, `application`, `infrastructure`, `ui` e testes)

| Módulo | Item do plano | Estimativa |
|---|---|---:|
| Documentos na solicitação (SF-034 a SF-036) | 2 | 3.000–5.000 |
| Atribuição, transferência, reabertura e cancelamento | 3 | 5.000–7.000 |
| Comentários e conversas | 4 | 5.000–7.000 |
| SLA e prioridades | 5 | 6.000–9.000 |
| Campos personalizados por serviço | 6 | 8.000–12.000 |
| Fluxos configuráveis | 7 | 10.000–14.000 |
| Aprovações (perfil Gestor) | 8 | 7.000–10.000 |
| Notificações | 10 | 7.000–10.000 |
| Ferramentas MCP de consulta a documentos | 15 | 3.000–5.000 |
| Múltiplas organizações | 16 | 8.000–12.000 |

**Total estimado das seções 3 e 4:** cerca de 100.000 a 140.000 linhas, **desde que cada funcionalidade tenha testes reais** nas três suítes (unitária, integração e E2E). Hoje os testes são cerca de metade das linhas do projeto e contam para a meta (decisão da seção 9 do plano). As estimativas são aproximações e devem ser recalibradas a cada relatório de fase.

## 5. Ordem de execução

| Passo | Conteúdo | Motivo da ordem |
|---|---|---|
| 0 | Corrigir o defeito do relógio no histórico (nova SPEC); concluir SF-042 e SF-043 | Sem isso a integração mantém falhas e a garantia "todas as suítes passando" não se cumpre (ver `NOTES.md`, SF-045) |
| 1 | Eventos + outbox; jobs agendados; adaptadores de e-mail e armazenamento | Base para SLA, notificações e documentos |
| 2 | Documentos na solicitação (SF-034 a SF-036) | Já especificados (seção 21 da SPEC principal) |
| 3 | Atribuição, comentários, SLA (usa jobs), busca e paginação | Núcleo do atendimento |
| 4 | Campos personalizados → fluxos → aprovações | Cada um depende do anterior |
| 5 | Autorização configurável → notificações (usa eventos) → auditoria → relatórios | Governança sobre o que já existe |
| 6 | API pública → MCP → múltiplas organizações | Múltiplas organizações por último: altera todas as consultas |

**Ciclo obrigatório de cada item** (o mesmo das SF-037 a SF-045):

1. SPEC com critérios de aceitação, aprovada antes do código.
2. Tarefa registrada em `TASKS.md`.
3. Implementação em camadas, respeitando as fronteiras verificadas no lint.
4. Todas as suítes executadas: lint, typecheck, build, unitária, integração e E2E.
5. Medição com `sh scripts/cloc-diff.sh`.
6. Registro em `NOTES.md`, `diario/` e `prompts/sessoes/`.
7. Commit e push.

## 6. Relatórios obrigatórios

| Quando | Documento | Conteúdo mínimo |
|---|---|---|
| Antes de cada funcionalidade | `SPEC/AAAA-MM-DD-<funcionalidade>.md` | Objetivo, escopo, fora de escopo, regras, critérios de aceitação verificáveis, riscos |
| Ao criar uma camada transversal | Registro de decisão em `NOTES.md` | Por que a camada existe, alternativas consideradas, dependências |
| Ao adicionar um pacote | Justificativa em `NOTES.md` | Necessidade e alternativa sem dependência (`AGENTS.md`, regra 11) |
| A cada tarefa | `TASKS.md`, `NOTES.md`, `diario/`, `prompts/sessoes/` | Estado, decisões, testes executados e resultado real (inclusive falhas) |
| Ao fim de cada fase | `SPEC/AAAA-MM-DD-relatorio-fase-N.md` | Linhas `added` por área (`src`, `tests`, `scripts`), saldo líquido, suítes, critérios cumpridos, regressões, tempo gasto |
| Contínuo | `diario/tempo-do-projeto.md` | Horas por sessão, para estimar o ritmo |
| Ao atingir a meta | `SPEC/AAAA-MM-DD-relatorio-final-100k.md` | Total `added` ≥ 100.000 com o comando reproduzível, distribuição por módulo e camada, resultado das suítes e declaração de ausência de código artificial (SF-026) |

## 7. Esforço estimado

O ritmo registrado em `diario/tempo-do-projeto.md` é de cerca de 470 linhas por hora. Nesse ritmo, as aproximadamente 95.200 linhas restantes equivalem a cerca de **200 horas de trabalho**. A estimativa deve ser revista em cada relatório de fase.

## 8. Critérios de verificação deste documento

- **CA-CAM-01:** Toda camada ou módulo implementado a partir deste documento tem SPEC própria registrada antes do código.
- **CA-CAM-02:** Cada fase termina com o relatório da seção 6, contendo a medição do `scripts/cloc-diff.sh`.
- **CA-CAM-03:** Nenhuma linha contabilizada provém de duplicação, geração em massa ou funcionalidade fora das SPECs.
