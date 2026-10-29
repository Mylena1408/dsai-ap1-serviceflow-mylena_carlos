# SPEC — Relatório de triagem: status, funcionamento e contagem de linhas

**Data:** 2026-10-29  
**Tipo:** Relatório de verificação (não adiciona nem altera funcionalidade)  
**Projeto:** ServiceFlow  
**Commit verificado:** `20cf0e4` (`origin/main`) — o código em `src/`, `tests/`, `scripts/` e `prisma/` da cópia local é idêntico a esse commit  
**Referências:** `SPEC/2026-09-30-catalogo-e-solicitacoes.md`, `SPEC/2026-09-30-visao-geral.md`, `TASKS.md`, `NOTES.md`

## 1. Objetivo

Registrar o estado do projeto em 2026-10-29:

1. status das tarefas SF registradas;
2. funcionamento verificado (instalação, lint, typecheck, testes e build);
3. número de linhas executáveis medidas com `cloc`;
4. quais linhas e arquivos **não** são executáveis.

## 2. Ambiente da verificação

| Item | Valor |
|---|---|
| Sistema | Windows 11 Pro, Git Bash |
| Node.js padrão da máquina | 18.20.8 (abaixo do exigido em `package.json`: `>=20.9.0`) |
| Node.js usado nos comandos | 22.23.4, via `volta run --node 22` |
| npm | 10.8.2 |
| cloc | 2.10 |
| PostgreSQL | **não disponível** (sem `psql`, Docker ou `TEST_DATABASE_URL`) |

## 3. Status das tarefas (fonte: `TASKS.md`)

Total: **43 tarefas** (SF-001 a SF-043).

| Situação | Qtd. | Tarefas |
|---|---|---|
| Concluídas | 28 | SF-001 a SF-025, SF-027, SF-031, SF-032 |
| Parciais / não concluídas | 5 | SF-026, SF-028, SF-029, SF-030, SF-033 |
| Não iniciadas | 10 | SF-034 a SF-043 |

Detalhe das pendências:

- **SF-026** — meta acadêmica de 100.000 linhas com `cloc` não atingida (ver seção 5).
- **SF-028** — revisão final executada, mas bloqueada pela SF-026; política de backup/recuperação ainda sem teste de restauração.
- **SF-029** — autogerenciamento de senha implementado e testado manualmente; suíte de integração ainda não executada com sucesso.
- **SF-030** — decisão técnica de armazenamento concluída; buckets privados, chaves e variáveis na Vercel ainda não provisionados.
- **SF-033** — validação de arquivos e adaptador implementados com testes unitários; falta teste contra bucket `-test` real e uso pelas SF-034/SF-035.
- **SF-034 a SF-036** — abertura com documentos, download de anexos e E2E de documentos: não iniciadas.
- **SF-037 a SF-043** — refatoração arquitetural: não iniciadas. A SPEC `2026-10-27-refatoracao-arquitetural.md` e as tarefas SF-037 a SF-043 existem na cópia local, mas **ainda não estão no repositório remoto** (ver seção 7).

## 4. Funcionamento verificado

| Verificação | Comando | Resultado |
|---|---|---|
| Instalação | `npm ci` | OK — 425 pacotes (com Node 18 há avisos `EBADENGINE` de `next` e `vitest`) |
| Prisma Client | `npx prisma generate` | OK |
| Lint | `npm run lint` | OK — sem erros ou avisos |
| Tipos | `npm run typecheck` | OK — sem erros |
| Testes unitários | `npm run test:unit` | **OK — 26 arquivos, 174 testes aprovados** (8,7 s) |
| Build de produção | `npm run build` | OK — 12 rotas geradas (`/`, `/login`, `/admin`, `/catalog`, `/catalog/[serviceId]`, `/requests`, `/requests/[requestId]`, `/queue`, `/queue/[requestId]`, `/account/password`, `/api/auth/[...nextauth]`, `/_not-found`) |
| Testes de integração | `vitest run --config vitest.integration.config.ts` | **Não executados** — o setup aborta: `PostgreSQL integration tests require TEST_DATABASE_URL`. 24 arquivos, cerca de 83 casos declarados |
| Testes E2E | `npm run test:e2e` | **Não executados** — dependem de PostgreSQL. 1 cenário declarado |
| Aplicação em execução | `npm run dev` | **Não verificado** — exige banco configurado |

Observações:

- O build foi executado com `AUTH_SECRET` e `DATABASE_URL` fictícios, apenas para compilar; nenhum banco foi acessado.
- Com o Node 18 padrão da máquina o projeto não atende ao `engines`; usar Node ≥ 20.9.
- Sem PostgreSQL, este relatório **não comprova** os critérios de aceitação que dependem de banco (persistência, transações, autorização com dados reais). A última aprovação registrada da integração é de 2026-10-20 (SF-031 e SF-032).

## 5. Contagem de linhas com cloc

### 5.1 Linhas executáveis (TypeScript + JavaScript)

Comando: `cloc <pasta>` em cada diretório, excluindo `node_modules` e `.next`.

| Área | Arquivos | Código | Branco | Comentário |
|---|---:|---:|---:|---:|
| `src/app` (rotas, páginas, Server Actions) | 23 | 1.917 | — | — |
| `src/modules` (domínios) | 25 | 2.150 | 346 | 22 |
| `src/server` (infraestrutura) | 8 | 595 | 114 | 11 |
| `src/shared` (validação) | 1 | 140 | 19 | 2 |
| `src/types` (declaração `.d.ts`) | 1 | 21 | 2 | 0 |
| **Subtotal `src/`** | **58** | **4.823** | | |
| `scripts/` | 2 | 147 | 26 | 0 |
| Configs da raiz (`auth.ts`, `next.config.ts`, `playwright.config.ts`, `vitest.*.config.ts`, `eslint.config.mjs`) | 6 | 88 | — | — |
| **Subtotal aplicação** | **66** | **5.058** | 665 | 39 |
| `tests/unit` | 27 | 2.328 | 276 | 2 |
| `tests/integration` | 24 | 3.261 | 347 | 0 |
| `tests/e2e` | 2 | 205 | 22 | 0 |
| **Subtotal testes** | **53** | **5.794** | 645 | 2 |
| **Total executável** | **119** | **10.852** | **1.310** | **41** |

O `.d.ts` de `src/types` (21 linhas) só declara tipos e não gera código em tempo de execução; sem ele, o código efetivamente executável é **10.831** linhas.

### 5.2 Medição no critério oficial da SF-026

Mesmo critério da medição de 2026-10-06 (código e testes; sem documentação, prompts, JSON, TOML, `lock` e `.min.`):

| Linguagem | Arquivos | Código |
|---|---:|---:|
| TypeScript | 118 | 10.844 |
| CSS | 1 | 877 |
| SQL | 5 | 175 |
| Prisma Schema | 1 | 137 |
| JavaScript | 1 | 8 |
| **Total** | **126** | **12.041** |

- Medição anterior (2026-10-06): 8.903 → aumento de **3.138** linhas.
- Meta da AP1: 100.000 → faltam **87.959** linhas. A SF-026 continua incompleta; conforme `TASKS.md`, a meta não autoriza inflar código.
- `next-env.d.ts`, gerado pelo `next build` e ignorado pelo Git, foi excluído da contagem.
- O modo `cloc --vcs=git` em um clone no diretório temporário falhou ao abrir arquivos por limite de tamanho de caminho no Windows (SQL apareceu com 79 linhas em vez de 175). Por isso a contagem foi feita na cópia local, cujo código é idêntico ao commit `20cf0e4`.

### 5.3 Linhas e arquivos não executáveis

| Categoria | Arquivos | Linhas (code do cloc) | Por que não é executável |
|---|---:|---:|---|
| Linhas em branco em TS/JS | — | 1.310 | Formatação |
| Comentários em TS/JS | — | 41 | Documentação no código |
| Declaração de tipos (`src/types/next-auth.d.ts`) | 1 | 21 | Apagado na compilação |
| CSS (`src/app/globals.css`) | 1 | 877 | Estilo |
| SQL das migrations | 5 | 175 | Declarativo; executado pelo PostgreSQL, não pela aplicação |
| Schema Prisma | 1 | 137 | Declarativo; gera o client |
| TOML (`migration_lock.toml`) | 1 | 1 | Configuração |
| JSON de configuração (`package.json`, `tsconfig.json`) | 2 | 77 | Configuração |
| `package-lock.json` | 1 | 8.326 | Gerado pelo npm |
| Markdown (SPEC, TASKS, NOTES, README, diário, sessões) | 31 | 2.233 | Documentação |
| Logs de sessão do Copilot (`prompts/sessoes/*.json`) | 5 (4 únicos) | 358.869 | Registro de prompts |

### 5.4 Total bruto do repositório

`cloc .` (excluindo `node_modules` e `.next`): **165 arquivos, 381.547 linhas de código**, mais 2.307 em branco e 86 comentários. Desse total, **94 %** vem dos logs JSON de sessão, que não são código. Esse número não deve ser usado como medida do projeto.

## 6. Outras verificações

- **Segredos:** busca por chaves `sb_secret_`, `AUTH_SECRET` preenchido, chaves privadas e URLs de banco com senha nos arquivos do projeto (exceto `node_modules`, `.next` e `prompts/`). Só foram encontrados valores fictícios: `sb_secret_synthetic-value-for-tests` em `tests/unit/server/storage/storage.test.ts` e o marcador `<segredo gerado localmente>` no `README.md`. `.env*` está no `.gitignore`, exceto os dois `.example`.
- **Arquivo duplicado:** `prompts/sessoes/2026-10-01-1215-github-copilot.json` e `2026-10-01-1215-github-copilot-sf001.json` são idênticos (3,9 MB cada). Fica registrado, sem remoção, porque `AGENTS.md` manda preservar os registros de sessão.

## 7. Divergência entre a cópia local e o remoto

A pasta local verificada não é um repositório Git. Comparada com `origin/main` (`20cf0e4`), ignorando finais de linha, ela tem estes arquivos de documentação que **não estão no remoto**:

- `SPEC/2026-10-27-refatoracao-arquitetural.md` (nova)
- `diario/2026-10-27.md` (novo)
- `prompts/sessoes/2026-10-27-spec-refatoracao-arquitetural.md` (novo)
- `NOTES.md` e `TASKS.md` (alterados: contagem de 2026-10-27 e tarefas SF-037 a SF-043)

O commit deste relatório não inclui esses arquivos. Para que o repositório reflita o status descrito na seção 3, eles precisam ser commitados separadamente.

## 8. Critérios de verificação deste relatório

- **CA-TRI-01:** `npm run lint`, `npm run typecheck`, `npm run test:unit` e `npm run build` terminam sem erro com Node ≥ 20.9.
- **CA-TRI-02:** `cloc` em `src`, `scripts`, configs da raiz e `tests`, restrito a TypeScript/JavaScript, totaliza 10.852 linhas de código no commit `20cf0e4`.
- **CA-TRI-03:** A medição no critério da SF-026 (seção 5.2) totaliza 12.041 linhas.
- **CA-TRI-04:** Os itens não verificados (integração, E2E e execução da aplicação) estão declarados como não executados, com o motivo.

## 9. Recomendações

1. Instalar ou fixar Node ≥ 20.9 no ambiente (`volta pin node@22`, se o grupo concordar em versionar a configuração).
2. Configurar um PostgreSQL de teste (`TEST_DATABASE_URL` terminando em `_test`) e executar a integração e o E2E. Com isso a SF-029 pode ser fechada.
3. Commitar a documentação local de 2026-10-27 (seção 7) antes de iniciar a SF-037.
4. Excluir `prompts/` das medições de linhas, como já faz o critério oficial.
