# SPEC — Refatoração arquitetural: módulos em camadas

**Data:** 2026-10-27  
**Status:** Aprovada em 2026-10-27  
**Projeto:** ServiceFlow  
**Referências:** `SPEC/2026-09-30-visao-geral.md`, `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seção 17)

## 1. Objetivo

Reorganizar o código do ServiceFlow em um **monólito modular com camadas dentro de cada módulo**, de forma que as funcionalidades previstas na visão geral (permissões configuráveis, fluxos, aprovações, SLA, notificações, relatórios) possam ser adicionadas com fronteiras claras, regras de domínio testáveis sem banco e sem que poucos arquivos concentrem todo o crescimento.

Esta SPEC **não adiciona nem altera funcionalidade**. Todo comportamento observável — regras de negócio, autorização, mensagens, rotas, telas, esquema do banco e resultados dos testes — deve permanecer igual.

## 2. Contexto

### 2.1 Estado atual (medido em 2026-10-27)

- Next.js 16 (App Router), TypeScript, Prisma 6.16/PostgreSQL, Auth.js v5, Zod, Argon2.
- Código executável: 10.852 linhas (cloc), das quais 4.823 em `src/` e 5.794 em `tests/`.
- Organização:
  - `src/app/` — rotas por perfil (`(admin)`, `(attendant)`, `(requester)`), páginas e Server Actions;
  - `src/modules/<domínio>/index.ts` — casos de uso, com consultas Prisma embutidas;
  - `src/modules/<domínio>/policy.ts` — regras puras;
  - `src/server/` — infraestrutura transversal (db, auth, authorization, errors, storage, validation, config);
  - `src/shared/validation/` — schemas Zod de todos os domínios em um único arquivo.

### 2.2 Problemas que motivam a mudança

1. **Casos de uso acoplados ao ORM.** Os `index.ts` dos módulos misturam orquestração e acesso ao Prisma, e tipos como `Prisma.RequestGetPayload` aparecem como tipos públicos. Testar um caso de uso exige banco.
2. **Arquivos concentradores.** `src/app/(admin)/admin/page.tsx` (356 linhas) e `actions.ts` (384 linhas) atendem todas as entidades administrativas; `src/shared/validation/index.ts` reúne os schemas de todos os domínios. Cada novo domínio incharia esses mesmos arquivos.
3. **Fronteiras sem verificação.** Módulos importam partes internas de outros (por exemplo, `requests` importa `@/modules/services/policy` e `users` importa `@/modules/auth/password`). Nada impede que esse acoplamento cresça.
4. **Tradução de erros do Prisma espalhada.** O mapeamento de códigos como `P2002`, `P2025` e `P2003` para erros da aplicação é repetido dentro dos casos de uso.

### 2.3 Registro da mudança de escopo

A seção 17 da SPEC principal define a aplicação como "monólito modular". Esta SPEC **mantém** essa decisão e apenas detalha a organização interna dos módulos. Não há mudança de stack, de dependências nem de escopo funcional.

## 3. Escopo

- Definir a estrutura em camadas de cada módulo e as regras de dependência entre camadas e entre módulos.
- Migrar, de forma incremental, os módulos existentes: `requests`, `services`, `categories`, `sectors`, `users`, `document-requirements`, `attachments` e `auth`.
- Introduzir repositórios (ports na aplicação, implementações Prisma na infraestrutura) e centralizar a tradução de erros do Prisma na infraestrutura.
- Mover os schemas de validação específicos para cada módulo, deixando em `src/shared/validation` apenas schemas genéricos.
- Dividir o código da área administrativa por entidade, **mantendo a rota `/admin` e o comportamento atual da tela**.
- Verificar as fronteiras com regra de lint, usando apenas o ESLint já instalado.
- Adicionar testes unitários dos casos de uso com repositórios em memória.

## 4. Fora de escopo

- Qualquer funcionalidade nova, inclusive as previstas na seção 19 da SPEC principal.
- Alteração de `prisma/schema.prisma`, de migrations ou de dados.
- Inclusão, remoção ou atualização de dependências (inclusive dependency-cruiser ou eslint-plugin-boundaries).
- Alteração de rotas, URLs, textos, mensagens de erro ou layout das telas.
- Barramento de eventos, tabela *outbox* ou filas. Serão especificados junto com a primeira funcionalidade que precisar deles (fluxos ou notificações).
- Divisão em pacotes/workspaces, microsserviços ou mudança de forma de deploy.
- Schema do Prisma em múltiplos arquivos.
- Criação de código com o objetivo de aumentar a contagem de linhas. O aumento de linhas decorrente de interfaces e mapeamentos é consequência, não meta.

## 5. Arquitetura alvo

### 5.1 Estrutura de um módulo

```
src/modules/<módulo>/
├── domain/           tipos de domínio, regras puras (atuais policy.ts), erros de domínio
├── application/      casos de uso e ports (interfaces de repositório e de serviços externos)
├── infrastructure/   repositórios Prisma, mapeamento linha ↔ tipo de domínio, tradução de erros Prisma
├── ui/               componentes React e schemas de formulário específicos do módulo (quando houver)
└── index.ts          API pública do módulo
```

Pastas sem conteúdo não devem ser criadas. Um módulo sem persistência (por exemplo, `attachments` hoje) pode ter apenas `domain/` e `index.ts`.

### 5.2 Responsabilidades por camada

| Camada | Pode conter | Não pode conter |
|---|---|---|
| `domain` | tipos, regras puras, validações de invariantes, erros de domínio | imports de Prisma, Next.js, React, `@/server/db`, I/O |
| `application` | casos de uso, verificação de autorização, ports, schemas de entrada | imports de `@prisma/client` (inclusive tipos), React, Next.js |
| `infrastructure` | implementações Prisma dos ports, transações, tradução de erros Prisma | regras de negócio que não sejam restrição de banco |
| `ui` | componentes React do módulo | acesso a banco ou a repositórios |
| `src/app` | rotas, páginas, layouts, Server Actions finas (entrada → caso de uso → resposta) | consultas Prisma e regras de negócio |

### 5.3 Infraestrutura transversal

`src/server/` continua existindo para o que é comum a todos os módulos: `db`, `auth`, `authorization`, `errors`, `storage`, `validation` e `config`. `src/shared/` contém apenas código sem dependência de servidor e útil a mais de um módulo.

## 6. Regras de dependência

### 6.1 Entre camadas

A dependência aponta sempre para dentro:

```
src/app  →  módulo/index.ts  →  application  →  domain
                                     ↑
                              infrastructure (implementa os ports de application)
```

- `domain` não importa nenhuma outra camada.
- `application` importa `domain` e `src/server/{authorization,errors,validation}`.
- `infrastructure` importa `application`, `domain`, `src/server/db` e `@prisma/client`.
- `index.ts` é o ponto de composição: monta os casos de uso com as implementações de infraestrutura e exporta as funções públicas.

### 6.2 Entre módulos

- Um módulo só importa outro por meio de `@/modules/<outro>` (o `index.ts`), nunca de `@/modules/<outro>/<subpasta>`.
- `src/app` também importa módulos apenas por `@/modules/<módulo>`.
- Dependências circulares entre módulos são proibidas.
- Os acoplamentos existentes (`requests → services`, `users → auth`) passam a usar a API pública do módulo de destino.

### 6.3 Verificação

- As regras 6.1 e 6.2 são impostas por `no-restricted-imports` (e, se necessário, `overrides` por pasta) em `eslint.config.mjs`.
- `npm run lint` deve falhar quando uma regra é violada. A verificação é feita criando temporariamente um arquivo com import proibido, executando o lint e removendo o arquivo; o resultado é registrado em `NOTES.md`.
- **Exceção:** os testes (`tests/**`) podem importar partes internas dos módulos para testes unitários de `domain` e `application`.

## 7. Repositórios e transações

- Cada caso de uso recebe seus repositórios por parâmetro (injeção simples por função ou fábrica), sem contêiner de injeção de dependência.
- Os ports usam tipos de domínio, não tipos do Prisma.
- Operações hoje transacionais continuam transacionais, **com o mesmo nível de isolamento** (inclusive `Serializable` onde já é usado). A forma concreta de expor a transação aos casos de uso (por exemplo, um port de unidade de trabalho) é definida no módulo piloto e registrada em `NOTES.md` antes de ser replicada.
- A tradução de `P2002` → `ConflictError`, `P2025`/`P2003` → `NotFoundError` e demais códigos fica na infraestrutura, em um único utilitário reutilizado pelos repositórios.
- **Compatibilidade transitória:** as funções públicas que hoje aceitam `database: PrismaClient = prisma` como último parâmetro mantêm essa assinatura, porque os testes de integração a utilizam. O `index.ts` usa o cliente recebido para montar os repositórios. Remover esse parâmetro exige atualização desta SPEC.

## 8. Validação

- Schemas específicos de um domínio (por exemplo, criação de usuário, transição de solicitação) passam a ficar no `application/` do módulo e são exportados pela API pública quando a interface precisar deles.
- `src/shared/validation` mantém somente schemas genéricos (identificador, nome, estado ativo, e-mail e similares).
- As mensagens e os caminhos de erro produzidos pela validação não mudam.

## 9. Apresentação

- Server Actions continuam em `src/app/**/actions.ts`, apenas convertendo `FormData` em entrada, chamando a API pública do módulo e devolvendo o resultado.
- A área administrativa é dividida em arquivos por entidade (por exemplo, `admin/sectors/`, `admin/services/`, ou componentes por entidade sob `admin/`), **sem mudar a URL `/admin`, a ordem dos blocos, os textos ou o comportamento**. Os nomes exportados por `src/app/(admin)/admin/actions.ts` usados pelos testes continuam disponíveis no mesmo caminho.
- Antes de alterar arquivos do App Router, consultar a documentação da versão instalada em `node_modules/next/dist/docs/`, conforme `AGENTS.md`.

## 10. Estratégia de migração

1. **Fronteiras primeiro:** configurar a regra de lint em modo que aceite a estrutura atual e passe a bloquear novos imports internos entre módulos.
2. **Módulo piloto `requests`:** migrar para `domain/application/infrastructure`, definir o padrão de repositório e transação, registrar a decisão em `NOTES.md`.
3. **Demais módulos, um por tarefa:** `services`, `categories`, `sectors`, `users`, `document-requirements`, `attachments`, `auth`.
4. **Validação:** distribuir os schemas de `src/shared/validation` pelos módulos.
5. **Área administrativa:** dividir arquivos por entidade.
6. **Fechamento:** apertar a regra de lint para o estado final e remover reexportações transitórias.

Cada etapa termina com todas as suítes passando. Não há etapa que deixe o projeto sem compilar ou com testes falhando entre tarefas.

## 11. Regras para os testes existentes

- As asserções dos testes existentes **não podem ser alteradas**. Se um teste falhar, a refatoração está errada.
- É permitido alterar apenas caminhos de import e de `vi.mock` quando um arquivo mudar de lugar (por exemplo, `@/modules/requests/policy` → `@/modules/requests/domain/...`). Cada alteração desse tipo é listada no registro da tarefa.
- Os mocks de `@/server/db`, `@/server/auth` e `@/server/authorization` usados pelos testes continuam funcionando, pois esses caminhos não mudam.
- O E2E existente (`tests/e2e/service-request-flow.spec.ts`) deve passar sem alteração.

## 12. Critérios de aceitação verificáveis

- [ ] **CA-ARQ-01** — Todos os módulos de `src/modules/` seguem a estrutura da seção 5.1 (somente com as pastas necessárias).
- [ ] **CA-ARQ-02** — Nenhum arquivo em `src/modules/*/domain/**` ou `src/modules/*/application/**` importa `@prisma/client`, `@/server/db`, `next/*` ou `react` (verificado por lint e por busca no código).
- [ ] **CA-ARQ-03** — Nenhum arquivo fora de um módulo importa `@/modules/<módulo>/<subpasta>`, exceto em `tests/**` (verificado por lint).
- [ ] **CA-ARQ-04** — `npm run lint` falha quando um import proibido é introduzido, e o teste manual da seção 6.3 está registrado em `NOTES.md`.
- [ ] **CA-ARQ-05** — Não há consultas Prisma (`prisma.`, `database.`, `transaction.` com operações de modelo) em `src/app/**` nem em `application/` ou `domain/`.
- [ ] **CA-ARQ-06** — A tradução de códigos de erro do Prisma existe em um único utilitário de infraestrutura.
- [ ] **CA-ARQ-07** — Cada caso de uso migrado tem ao menos um teste unitário com repositório em memória cobrindo sucesso e um caminho de erro.
- [ ] **CA-ARQ-08** — `src/shared/validation` contém apenas schemas genéricos; os específicos estão nos módulos, com as mesmas mensagens e caminhos de erro.
- [ ] **CA-ARQ-09** — A área administrativa está dividida por entidade, a rota `/admin` permanece a mesma e o E2E passa sem alteração.
- [ ] **CA-ARQ-10** — `prisma/schema.prisma`, `prisma/migrations/`, `package.json` e `package-lock.json` estão sem alteração.
- [ ] **CA-ARQ-11** — As suítes unitária, de integração e E2E, `npm run typecheck`, `npm run lint` e `npm run build` passam, com resultados reais registrados. Nenhuma asserção existente foi alterada.
- [ ] **CA-ARQ-12** — A contagem do cloc por módulo (antes e depois) está registrada em `NOTES.md`.

## 13. Estratégia de testes

- **Regressão:** suítes existentes após cada tarefa (unitária sempre; integração e E2E ao final de cada módulo migrado, com o banco de teste local documentado em `NOTES.md`).
- **Novos unitários:** casos de uso com repositórios em memória; tradutor de erros Prisma.
- **Integração:** os testes atuais já cobrem os repositórios Prisma pela API pública; novos testes de integração só quando um repositório tiver comportamento não coberto.
- **Arquitetura:** verificação de lint descrita na seção 6.3.

## 14. Riscos

| Risco | Mitigação |
|---|---|
| Mudança sutil de comportamento transacional (isolamento, ordem de escrita) | Manter o mesmo nível de isolamento; os testes de integração de concorrência e de transição devem passar sem alteração |
| Refatoração simultânea a SF-034–SF-036, que mexem em `requests` e `attachments` | Decidir a ordem antes de iniciar (seção 15) |
| Mensagens ou caminhos de erro alterados ao mover schemas | Testes de `shared/validation` e de Server Actions com asserções inalteradas |
| Crescimento de abstrações sem uso | Port só existe se houver implementação e caso de uso que o utilizem |

## 15. Ordem de execução e pontos em aberto

### 15.1 Ordem em relação a SF-034–SF-036 (decidida em 2026-10-27)

Ordem aprovada pela responsável pelo projeto:

```
SF-037 → SF-038 → SF-034 → SF-035 → SF-036 → SF-039 → SF-040 → SF-041 → SF-042 → SF-043
```

- **SF-037 (fronteiras) e SF-038 (piloto `requests`) antes da SF-034**, para que a abertura de solicitação com documentos seja implementada já na estrutura em camadas.
- **SF-039 a SF-043 depois da SF-036**, para não refatorar `attachments`, `services` e a área administrativa enquanto a funcionalidade de documentos está em andamento.
- O código novo das SF-034 a SF-036 segue as seções 5 a 8 desta SPEC (camadas, fronteiras, repositórios e validação no módulo). Código existente de módulos ainda não migrados só é reorganizado nas tarefas desta SPEC.

### 15.2 Em aberto

- Forma concreta do port de transação: definida no piloto (seção 7).

## 16. Pontos para SPECs futuras

- Eventos de domínio entre módulos e *outbox* transacional (junto com fluxos/aprovações ou notificações).
- Schema do Prisma em múltiplos arquivos, após verificar o suporte na versão instalada.
- Divisão em workspaces quando o tempo de build ou de testes justificar.
- Remoção do parâmetro `database` das APIs públicas (seção 7).
