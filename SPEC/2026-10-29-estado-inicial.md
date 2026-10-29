# SPEC — Estado inicial do projeto (linha de base)

**Data:** 2026-10-29  
**Tipo:** Registro de linha de base (não adiciona nem altera funcionalidade)  
**Projeto:** ServiceFlow  
**Commit de referência do código:** `20cf0e4` (o código não mudou nos commits seguintes, que são só de documentação)  
**Referências:** `SPEC/2026-09-30-catalogo-e-solicitacoes.md`, `SPEC/2026-10-27-refatoracao-arquitetural.md`, `SPEC/2026-10-29-relatorio-triagem.md`

## 1. Objetivo

Registrar como o ServiceFlow está **antes** da refatoração arquitetural (SF-037 a SF-043) e da conclusão da funcionalidade de documentos (SF-034 a SF-036). Este documento serve de ponto de comparação: ao fim de cada etapa, comportamento, testes e métricas devem ser confrontados com o que está aqui.

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16.3.8 (App Router, Turbopack), React 19.2.8 |
| Linguagem | TypeScript 5 |
| Banco | PostgreSQL via Prisma 6.16.0 |
| Autenticação | Auth.js v5 (credenciais, sessão JWT em cookie `HttpOnly`), senhas com Argon2id |
| Validação | Zod 4 |
| Testes | Vitest 4 (unitário e integração), Playwright (E2E) |
| Deploy | Vercel; banco no Supabase |
| Runtime | Node.js ≥ 20.9 (validações anteriores usaram 24.21.0) |

## 3. Funcionalidades existentes

| Perfil | O que pode fazer | Rotas |
|---|---|---|
| Todos | Entrar com e-mail e senha, sair, alterar a própria senha | `/login`, `/account/password` |
| `ADMIN` | Cadastrar e editar setores, categorias, serviços e usuários; configurar documentos exigidos por serviço | `/admin` |
| `REQUESTER` | Navegar no catálogo, abrir solicitação, acompanhar status e histórico das próprias solicitações | `/catalog`, `/catalog/[serviceId]`, `/requests`, `/requests/[requestId]` |
| `ATTENDANT` | Ver a fila do seu setor e mudar o status das solicitações | `/queue`, `/queue/[requestId]` |

- O primeiro administrador é criado por `npm run bootstrap:admin` (interativo, uma única vez). Não há cadastro público nem recuperação de senha.
- A autorização é verificada no servidor a cada operação; perfil e setor vêm do banco, não do cliente.
- Status de solicitação: `OPEN`, `IN_PROGRESS`, `COMPLETED` (não há cancelamento). Cada mudança gera um `RequestStatusEvent`.
- **Ainda não existem:** anexos na abertura da solicitação (SF-034), download de anexos (SF-035), permissões configuráveis, fluxos, aprovações, SLA, notificações e relatórios (seção 19 da SPEC principal).

## 4. Modelo de dados

`prisma/schema.prisma` com 3 enums (`Role`, `RequestStatus`, `DocumentFormat`) e 8 modelos:

`Sector`, `Category`, `User`, `Service`, `Request`, `RequestStatusEvent`, `ServiceDocumentRequirement`, `RequestAttachment`.

Migrations (5):

1. `20261005141624_init`
2. `20261005163800_active_catalog_names`
3. `20261005164000_active_category_names`
4. `20261005195400_add_request_indexes_and_user_sector_check`
5. `20261016120000_document_requirements_and_attachments` (aplicada só no banco de teste; ainda não no banco principal)

## 5. Organização do código

```
src/
  app/                 rotas por perfil: (admin), (attendant), (requester), account, login, api/auth
  modules/<domínio>/   index.ts = casos de uso com Prisma embutido; policy.ts = regras puras
  server/              infraestrutura: auth, authorization, config, db, errors, storage, validation
  shared/validation/   schemas Zod de todos os domínios em um único arquivo
  types/               declaração de tipos do next-auth
scripts/               bootstrap-admin.ts, prepare-e2e.ts
tests/                 unit/, integration/, e2e/
```

Módulos: `attachments`, `auth`, `categories`, `document-requirements`, `requests`, `sectors`, `services`, `users`.

### 5.1 Maiores arquivos (linhas de código, cloc)

| Arquivo | Linhas |
|---|---:|
| `src/app/(admin)/admin/actions.ts` | 349 |
| `src/app/(admin)/admin/page.tsx` | 343 |
| `src/modules/users/index.ts` | 272 |
| `src/app/(admin)/admin/record-editor.tsx` | 267 |
| `src/modules/requests/index.ts` | 254 |
| `src/app/(admin)/admin/document-requirements-editor.tsx` | 240 |
| `src/modules/attachments/file-type.ts` | 209 |
| `src/modules/document-requirements/index.ts` | 184 |
| `src/modules/services/index.ts` | 169 |
| `src/server/storage/index.ts` | 164 |

### 5.2 Pontos que a refatoração vai mudar

Conforme `SPEC/2026-10-27-refatoracao-arquitetural.md`, seção 2.2:

1. Casos de uso acoplados ao Prisma (tipos `Prisma.*` na API pública).
2. Área administrativa concentrada em `admin/page.tsx` e `admin/actions.ts`.
3. Imports internos entre módulos sem verificação (`requests → services/policy`, `users → auth/password`).
4. Tradução de erros do Prisma (`P2002`, `P2025`, `P2003`) repetida nos casos de uso.

## 6. Métricas da linha de base

| Métrica | Valor |
|---|---:|
| Linhas executáveis TS/JS (cloc) | 10.852 |
| — em `src/` | 4.823 |
| — em `tests/` | 5.794 |
| — em `scripts/` e configs da raiz | 235 |
| Critério oficial da SF-026 (TS, JS, CSS, SQL, Prisma) | 12.041 |
| Meta acadêmica | 100.000 |
| Arquivos de teste unitário / testes | 26 / 174 |
| Arquivos de teste de integração / casos declarados | 24 / ~83 |
| Cenários E2E | 1 |
| Rotas geradas no build | 12 |

Detalhamento e linhas não executáveis em `SPEC/2026-10-29-relatorio-triagem.md`.

## 7. Qualidade verificada em 2026-10-29

| Verificação | Resultado |
|---|---|
| `npm run lint` | OK |
| `npm run typecheck` | OK |
| `npm run test:unit` | OK — 174/174 |
| `npm run build` | OK |
| Integração | Não executada (sem PostgreSQL). Última aprovação registrada: 2026-10-20 |
| E2E | Não executado (sem PostgreSQL). Última aprovação registrada: 2026-10-05 |

## 8. Status das tarefas

28 concluídas (SF-001 a SF-025, SF-027, SF-031, SF-032), 5 parciais (SF-026, SF-028, SF-029, SF-030, SF-033) e 10 não iniciadas (SF-034 a SF-043). Próxima tarefa pela ordem aprovada: **SF-037**.

## 9. Critérios para comparação futura

- **CA-BASE-01:** Ao fim de cada tarefa SF-037 a SF-043, lint, typecheck, build e os 174 testes unitários existentes continuam passando, com as mesmas asserções.
- **CA-BASE-02:** As 12 rotas da seção 3 continuam existindo com o mesmo comportamento.
- **CA-BASE-03:** `prisma/schema.prisma` e as 5 migrations permanecem iguais durante a refatoração.
- **CA-BASE-04:** A variação de linhas é medida com o mesmo comando cloc e comparada com a seção 6.
