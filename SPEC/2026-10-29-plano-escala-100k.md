# SPEC — Plano para escalar o ServiceFlow a 100.000 linhas executáveis novas

**Data:** 2026-10-29  
**Status:** Aprovada em 2026-10-29, com as decisões da seção 9  
**Projeto:** ServiceFlow  
**Linha de base:** `SPEC/2026-10-29-estado-inicial.md` (código do commit `20cf0e4`)  
**Referências:** `SPEC/2026-09-30-visao-geral.md`, `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seção 19), `SPEC/2026-10-27-refatoracao-arquitetural.md`, `TASKS.md` (SF-026)

## 1. Objetivo

Apresentar possibilidades para que o projeto cresça **100.000 linhas executáveis novas**, medidas com `cloc --diff` em relação à linha de base (linhas já existentes não contam), sem quebrar as funcionalidades atuais.

Este documento aprova a direção, as fases e as regras de medição, mas **não substitui as SPECs de funcionalidade**. Cada item da seção 5 exige SPEC própria, com critérios de aceitação, antes de ser implementado (`AGENTS.md`, regras 2 e 7). A exceção é o item 1, já especificado em `SPEC/2026-10-27-refatoracao-arquitetural.md`, e o item 2, especificado na seção 21 da SPEC principal.

## 2. Dimensão do desafio

- Hoje: **10.852** linhas executáveis (TypeScript + JavaScript), sendo 5.058 de aplicação e 5.794 de testes.
- Meta: **100.000 linhas novas**, cerca de 10 vezes o produto atual.
- Nenhuma técnica isolada gera esse volume com código legítimo. A única forma compatível com o `AGENTS.md` e com a SF-026 (que proíbe duplicação, geração em massa e código sem função) é implementar praticamente todo o roadmap já previsto nas SPECs.

## 3. Protocolo de medição

### 3.1 Comportamento verificado do `cloc --diff`

Teste realizado com cloc 2.10: um arquivo apenas movido de pasta é contado como **`same`**, não como `added`. Mover código na refatoração, portanto, não infla a contagem.

### 3.2 Procedimento proposto

1. Criar a tag `baseline-ap2` no commit atual (código idêntico ao `20cf0e4`).
2. Medir sempre com o script `scripts/cloc-diff.sh` (revisado em 2026-10-29):

   ```
   sh scripts/cloc-diff.sh            # baseline-ap2 → HEAD
   ```

   O script extrai as duas versões com `git archive` e roda `cloc --diff` entre as pastas, separando `src`, `tests` e `scripts`. O comando `cloc --git --diff` foi descartado: neste ambiente Windows ele contou 58 linhas `added` onde a comparação por pastas mostrou 897.

3. **Métrica:** linhas `added` em TypeScript/JavaScript, cobrindo `src/`, `tests/` e `scripts/`.
4. Reportar `modified`, `removed` e o **saldo líquido** (`added` − `removed`). O cloc reconhece arquivos inteiros movidos (`same`), mas código movido de dentro de um arquivo para outro aparece como `removed` + `added`; o saldo mostra quanto é realmente novo.
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

## 9. Decisões tomadas (2026-10-29)

Decisões da responsável pelo projeto:

| # | Questão | Decisão |
|---|---|---|
| 1 | Arquitetura | **Opção A — monólito modular em camadas** (seção 4). |
| 2 | Momento da refatoração | **Agora**: SF-037 a SF-043 são executadas em sequência, antes das SF-034 a SF-036. Substitui a ordem de 2026-10-27 (ver 9.1). |
| 3 | Funcionalidades | **Itens 1 a 16 aceitos** (seção 5). Cada um ainda exige SPEC própria antes do código. |
| 4 | Fases | **Fases 0 a 5 aceitas** (seção 6). |
| 5 | Garantias | **Todas as garantias da seção 7 são obrigatórias.** |
| 6 | Testes na meta | **Os testes contam** e devem ser documentados: cada SPEC registra em `NOTES.md` as linhas novas de aplicação e de testes separadamente, e quais suítes foram executadas. |
| 7 | Métrica | **Somente `added`** do `cloc --diff`, entendido como as linhas novas de código. `modified` e `removed` são reportados, mas não somam. |
| 8 | Dependências | **Permitidas quando necessárias**, conforme o `AGENTS.md` (regra 11): sem adicionar por conveniência, com justificativa registrada em `NOTES.md` antes ou junto da inclusão. |
| 9 | Linha de base | **Tag `baseline-ap2` criada** no commit `410c07b` (código idêntico ao `20cf0e4`) e publicada no GitHub. |

### 9.1 Nova ordem de execução

```
Fase 0 → SF-037 → SF-038 → SF-039 → SF-040 → SF-041 → SF-042 → SF-043 → SF-034 → SF-035 → SF-036 → fases 2 a 5
```

- A refatoração completa vem primeiro, para que as SF-034 a SF-036 e todas as funcionalidades novas já nasçam na estrutura em camadas.
- Consequência: `attachments` e `services` são refatorados antes da funcionalidade de documentos. O risco apontado na seção 14 da SPEC de refatoração deixa de existir, porque as tarefas não correm em paralelo.
- A seção 15.1 de `SPEC/2026-10-27-refatoracao-arquitetural.md` e as dependências em `TASKS.md` foram atualizadas para refletir esta ordem.

### 9.2 Fase 0 — itens obrigatórios antes da SF-037

1. Tag `baseline-ap2` (concluído).
2. Banco PostgreSQL de teste funcionando, para que integração e E2E rodem a cada tarefa. A forma escolhida é registrada em `NOTES.md`.
3. Todas as suítes executadas sobre a linha de base, para comparação.
4. Comando de medição da seção 3.2 executado sobre a linha de base (resultado esperado: 0 linhas `added`).

## 10. Critérios de aceitação deste plano

- **CA-ESC-01:** Toda funcionalidade implementada a partir deste plano tem SPEC própria registrada antes do código.
- **CA-ESC-02:** Ao fim de cada fase, lint, typecheck, build e todas as suítes de teste existentes passam sem alteração de asserções.
- **CA-ESC-03:** A medição usa o comando da seção 3.2 contra a tag `baseline-ap2` e é registrada em `NOTES.md`.
- **CA-ESC-04:** Nenhuma linha contabilizada provém de duplicação, geração em massa ou funcionalidade fora das SPECs.
