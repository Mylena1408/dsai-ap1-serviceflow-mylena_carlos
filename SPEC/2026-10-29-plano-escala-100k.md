# SPEC — Plano para escalar o ServiceFlow a 100.000 linhas executáveis novas

**Data:** 2026-10-29  
**Status:** Proposta — aguardando as decisões da seção 9  
**Projeto:** ServiceFlow  
**Linha de base:** `SPEC/2026-10-29-estado-inicial.md` (código do commit `20cf0e4`)  
**Referências:** `SPEC/2026-09-30-visao-geral.md`, `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seção 19), `SPEC/2026-10-27-refatoracao-arquitetural.md`, `TASKS.md` (SF-026)

## 1. Objetivo

Apresentar possibilidades para que o projeto cresça **100.000 linhas executáveis novas**, medidas com `cloc --diff` em relação à linha de base (linhas já existentes não contam), sem quebrar as funcionalidades atuais.

Este documento **não autoriza implementação**. Cada funcionalidade listada exige SPEC própria, com critérios de aceitação, antes de ser implementada (`AGENTS.md`, regras 2 e 7).

## 2. Dimensão do desafio

- Hoje: **10.852** linhas executáveis (TypeScript + JavaScript), sendo 5.058 de aplicação e 5.794 de testes.
- Meta: **100.000 linhas novas**, cerca de 10 vezes o produto atual.
- Nenhuma técnica isolada gera esse volume com código legítimo. A única forma compatível com o `AGENTS.md` e com a SF-026 (que proíbe duplicação, geração em massa e código sem função) é implementar praticamente todo o roadmap já previsto nas SPECs.

## 3. Protocolo de medição

### 3.1 Comportamento verificado do `cloc --diff`

Teste realizado com cloc 2.10: um arquivo apenas movido de pasta é contado como **`same`**, não como `added`. Mover código na refatoração, portanto, não infla a contagem.

### 3.2 Procedimento proposto

1. Criar a tag `baseline-ap2` no commit atual (código idêntico ao `20cf0e4`).
2. Medir sempre com o mesmo comando:

   ```
   cloc --git --diff baseline-ap2 HEAD --include-lang=TypeScript,JavaScript --exclude-dir=node_modules,.next,prompts --not-match-f="(lock|\.min\.|\.d\.ts$)"
   ```

3. **Métrica:** linhas `added` em TypeScript/JavaScript, cobrindo `src/`, `tests/` e `scripts/`.
4. Reportar `modified` e `removed` separadamente, para demonstrar que não houve rotatividade artificial.
5. Excluídos: CSS, SQL, schema Prisma, Markdown, JSON e arquivos `.d.ts` (não executáveis).
6. Trabalhar em um clone com caminho curto. No diretório temporário do Windows, `cloc --vcs=git` falhou ao abrir arquivos por limite de tamanho de caminho.
7. Registrar em `NOTES.md` a medição ao fim de cada SPEC implementada.

## 4. Opções de arquitetura

| Opção | Avaliação |
|---|---|
| **A. Monólito modular em camadas** (SPEC de 2026-10-27, aprovada) | **Recomendada.** Cada domínio cresce isolado em `domain/`, `application/`, `infrastructure/` e `ui/`; regras testáveis sem banco; fronteiras verificadas no lint. |
| B. Monorepo com pacotes (`core`, `web`, `worker`) | Possível no futuro, mas exige nova SPEC e mudança de ferramental. Desnecessária para a meta. |
| C. Microsserviços | Não recomendada: complexidade de deploy na Vercel sem ganho para o produto. |

A refatoração SF-037 a SF-043 é pré-requisito. Sem ela, arquivos concentradores como `src/app/(admin)/admin/page.tsx` e `actions.ts` absorveriam todo o crescimento.

## 5. Funcionalidades possíveis (todas previstas nas SPECs)

Estimativas incluem aplicação e testes (unitário, integração e E2E); hoje o projeto tem cerca de 1,1 linha de teste por linha de aplicação. Os valores são aproximações por analogia com os módulos atuais.

| # | Funcionalidade | Origem | Linhas novas (estimativa) |
|---|---|---|---:|
| 1 | Refatoração em camadas (repositórios, mapeadores, testes de casos de uso) | SPEC 2026-10-27 | 4.000–7.000 |
| 2 | Abertura com documentos e download de anexos (SF-034 a SF-036) | SPEC principal, seção 21 | 3.000–5.000 |
| 3 | Atribuição individual, transferência, reabertura e cancelamento | SPEC principal, seção 19 | 5.000–7.000 |
| 4 | Comentários e conversas, com anexos em comentários | Seção 19; visão geral §6 | 5.000–7.000 |
| 5 | Prioridades, SLA (dentro do prazo, próximo do vencimento, vencido) e alertas | Visão geral §9 | 6.000–9.000 |
| 6 | Campos personalizados por serviço (construtor de formulário e validação dinâmica) | Visão geral §4 | 8.000–12.000 |
| 7 | Fluxos configuráveis por serviço (etapas, transições e editor) | Visão geral §7 | 10.000–14.000 |
| 8 | Aprovações com perfil Gestor (decisão, observação, níveis) | Visão geral §3.3 e §8 | 7.000–10.000 |
| 9 | Permissões configuráveis (papéis e permissões por escopo) | Visão geral §12 | 7.000–10.000 |
| 10 | Notificações (na aplicação e por e-mail, com preferências) | Visão geral §11 | 7.000–10.000 |
| 11 | Painel, indicadores, relatórios e exportação CSV | Seção 19 | 6.000–9.000 |
| 12 | Auditoria geral; retenção, exportação e anonimização (LGPD) | Visão geral §10; seção 19 | 5.000–7.000 |
| 13 | Busca, filtros e paginação nas listas | Apoio aos itens acima | 3.000–4.000 |
| 14 | API externa com tokens e webhooks | Seção 19 | 6.000–9.000 |
| 15 | Ferramentas MCP de consulta a documentos | Seção 21.11 | 3.000–5.000 |
| 16 | Múltiplas organizações com isolamento | Seção 19 | 8.000–12.000 |
| | **Total** | | **93.000–137.000** |

**Conclusão:** a meta só é alcançada com quase todo o roadmap, incluindo os itens de maior porte (7, 8, 9, 10 e 16). Implementando apenas parte dele, a projeção fica entre 40.000 e 60.000 linhas.

## 6. Fases sugeridas

| Fase | Conteúdo | Acumulado estimado |
|---|---|---:|
| 0 | Tag de base, script de medição e banco de teste funcionando (integração e E2E hoje não executam) | ~0 |
| 1 | Itens 1 e 2: refatoração e documentos | 7.000–12.000 |
| 2 | Itens 3, 4, 5 e 13: núcleo de atendimento | 26.000–39.000 |
| 3 | Itens 6, 7 e 8: configurabilidade | 51.000–75.000 |
| 4 | Itens 9, 10, 11 e 12: transversais | 76.000–111.000 |
| 5 | Itens 14, 15 e 16: apenas se ainda faltar | até 137.000 |

## 7. Garantias para não quebrar o que funciona

1. **Uma SPEC por funcionalidade**, com critérios de aceitação, antes de qualquer código.
2. **Testes atuais preservados:** as asserções dos 174 testes unitários e dos fluxos de integração e E2E não mudam e rodam a cada tarefa. Requer PostgreSQL de teste e `TEST_DATABASE_URL` (fase 0).
3. **Migrations apenas aditivas:** colunas novas com valor padrão; nada é apagado ou renomeado no mesmo passo (expandir e depois contrair).
4. **Novo comportamento desligado por padrão:** um serviço sem fluxo, aprovação ou SLA configurado se comporta exatamente como hoje.
5. **Fronteiras verificadas no lint (SF-037):** módulos só importam a API pública de outros módulos.
6. **Medição a cada SPEC** com o comando da seção 3.2, registrada em `NOTES.md`.
7. **Proibido:** duplicação, geração em massa, testes sem asserção real e código cujo objetivo seja apenas aumentar a contagem.

## 8. Riscos

- **Tempo:** pelo registro em `diario/tempo-do-projeto.md`, a média foi de cerca de 470 linhas por hora (10.852 em 23h06). Nesse ritmo, 100.000 linhas exigiriam aproximadamente 200 horas.
- **Dependências novas:** e-mail (item 10) e gráficos (item 11) podem exigir pacotes. O `AGENTS.md` (regra 11) exige justificativa.
- **Multi-organização (item 16)** altera todas as consultas e é o maior risco de regressão; por isso fica na última fase.
- **Estimativas:** são aproximações; a medição real ao fim de cada fase deve recalibrar o plano.

## 9. Decisões pendentes

1. Os testes contam para a meta? (Recomendado: sim, como na medição oficial da SF-026. Sem eles, a meta fica cerca de duas vezes mais distante.)
2. Contar apenas `added` ou `added + modified`?
3. Quais fases e itens são aprovados, em especial os itens 14 a 16?
4. É permitido adicionar dependências quando necessário, com justificativa em `NOTES.md`?
5. Criar a tag `baseline-ap2` no commit atual?

## 10. Critérios de aceitação deste plano

- **CA-ESC-01:** Toda funcionalidade implementada a partir deste plano tem SPEC própria registrada antes do código.
- **CA-ESC-02:** Ao fim de cada fase, lint, typecheck, build e todas as suítes de teste existentes passam sem alteração de asserções.
- **CA-ESC-03:** A medição usa o comando da seção 3.2 contra a tag `baseline-ap2` e é registrada em `NOTES.md`.
- **CA-ESC-04:** Nenhuma linha contabilizada provém de duplicação, geração em massa ou funcionalidade fora das SPECs.
