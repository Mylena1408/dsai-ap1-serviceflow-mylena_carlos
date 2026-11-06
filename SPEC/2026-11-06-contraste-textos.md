# SPEC — Contraste dos textos secundários

**Data:** 2026-11-06
**Status:** Aprovada em 2026-11-06, dentro da "manutenção curta" (revisão de acessibilidade das telas) aprovada pela responsável. **Concluída em 2026-11-06** (SF-159; CA-CTR-01 e 02 verificados).
**Projeto:** ServiceFlow
**Referências:**
- WCAG 2.2, critério 1.4.3 (Contraste mínimo, nível AA): pelo menos 4,5:1 para texto normal.

## 1. Problema

Uma varredura automática com `axe-core` (regras WCAG 2.x A e AA), feita em 28 páginas dos quatro perfis (todas as telas e um detalhe de cada lista), achou um único tipo de falha: **contraste insuficiente**.

| Cor (variável) | Onde aparece | Contraste |
|---|---|---|
| `--soft-muted` `#8494a0` | datas, textos de apoio (`.metadata`), página desabilitada | 3,12 no branco |
| `--muted` `#657887` | textos secundários, rótulos dos painéis | 4,45 em `#fbfcfc`, 4,21 no fundo da página, 4,06 em `--brand-soft` |

Todas ficam abaixo do mínimo de 4,5:1. Afetam 20 das 28 páginas, entre elas os painéis, as análises, a fila, as notificações e "Respostas prontas".

## 2. Escopo

Escurecer as duas variáveis em `src/app/globals.css`:
- `--muted` passa a `#596b79`: 5,52 no branco, 5,08 no fundo da página e 4,90 em `--brand-soft`;
- `--soft-muted` passa a `#5f7180`: 5,05 no branco e 4,65 no fundo da página.

Ela continua um pouco mais clara que `--muted`, e a hierarquia visual se mantém.

## 3. Fora de escopo

- Outras cores, a paleta dos gráficos (já validada) e o layout.
- Testes automáticos de acessibilidade no CI: exigiriam acrescentar `axe-core` ou `@axe-core/playwright` às dependências do projeto.
- Revisão manual com leitor de tela.

## 4. Critérios de aceitação

- [x] **CA-CTR-01** — A mesma varredura das 28 páginas não acusa nenhuma violação WCAG 2.x A/AA. *Verificado em 2026-11-06: antes, 59 ocorrências de `color-contrast` (só esse tipo) em 20 páginas; depois, 28 de 28 páginas sem violação. A varredura usou o `axe-core` já presente em `node_modules` (dependência de outro pacote), num teste temporário apagado em seguida.*
- [x] **CA-CTR-02** — Nenhuma dependência nova; build e E2E passam. *Verificado em 2026-11-06: `package.json` sem mudança; build OK; E2E 31/31.*

## 5. Tarefas

- **SF-159** — Ajuste das duas cores, nova varredura e registros.
