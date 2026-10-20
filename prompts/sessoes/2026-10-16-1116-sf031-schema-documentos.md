# Sessão SF-031 — Schema de requisitos documentais e anexos — 2026-10-16

## Solicitação

> Vamos executar agora SOMENTE a tarefa SF-031 do projeto ServiceFlow.
>
> Antes de editar: 1. Leia `AGENTS.md`, `TASKS.md`, `NOTES.md` e a seção 21 da SPEC principal. 2. Leia integralmente os critérios específicos da SF-031 e suas dependências. 3. Execute `git status --short` e preserve todas as alterações já existentes, especialmente a documentação da SF-030 e a seção 21 da SPEC. 4. Confirme a estrutura atual de `prisma/schema.prisma` e das migrations existentes.
>
> OBJETIVO: Implementar somente o schema Prisma e a migration necessários para suportar os requisitos documentais por serviço e os anexos vinculados às solicitações, conforme a SPEC aprovada.
>
> REQUISITOS: Cada serviço poderá ter requisitos documentais próprios, configuráveis pelo administrador. Os requisitos precisam registrar os metadados definidos na SPEC, incluindo nome, formatos aceitos, obrigatoriedade, ordem e estado ativo. Cada anexo deve ficar associado à solicitação e ao requisito documental correspondente, conforme o modelo aprovado. Persistir apenas os metadados do arquivo no PostgreSQL; o conteúdo binário ficará no Supabase Storage privado, em tarefa posterior. Representar as relações e restrições necessárias para evitar referências inválidas. Permitir preservar o histórico dos anexos de solicitações existentes mesmo após edição ou desativação do serviço. Não cadastrar serviços, setores ou requisitos específicos em migrations, seeds ou código de produção. Respeitar os limites e as regras de integridade registrados na SPEC. Evitar alterações desnecessárias nas entidades atuais.
>
> SEGURANÇA E CUIDADOS: Não alterar migrations já aplicadas; criar uma nova migration. Não executar `prisma migrate reset`, apagar dados, truncar tabelas ou recriar bancos. Não aplicar migrations em produção. Não criar buckets, tokens, chaves ou variáveis de armazenamento nesta tarefa. Não modificar autenticação nem os fluxos existentes de solicitação. Não iniciar a SF-032 ou tarefas posteriores.
>
> VALIDAÇÃO: Execute, conforme suportado pelo ambiente: `npx.cmd prisma validate`; `npm.cmd run typecheck`; `npm.cmd run lint`; testes unitários e de integração relacionados ao schema. Se a conexão ao banco de teste falhar, registre o erro real e a validação que ficou pendente. Não substitua o banco de teste pelo banco de desenvolvimento ou produção.
>
> DOCUMENTAÇÃO: Atualize `TASKS.md`, `NOTES.md`, o diário e o registro da sessão conforme as convenções do projeto. Marque a SF-031 como concluída somente se todos os critérios aplicáveis tiverem sido verificados.
>
> Não faça commit nem push.
>
> Ao terminar, informe os arquivos alterados, a estrutura criada, os comandos executados e os respectivos resultados.

## Resultado

- `prisma/schema.prisma`: enum `DocumentFormat`, modelos `ServiceDocumentRequirement` e `RequestAttachment` e relações reversas sem SQL nas tabelas existentes.
- Nova migration aditiva `prisma/migrations/20261016120000_document_requirements_and_attachments/migration.sql`, com FKs `RESTRICT`, unicidade `(requestId, requirementId)`, índice único parcial de nome entre requisitos ativos e CHECKs de integridade.
- Testes: `tests/integration/document-schema.test.ts` (11 casos), `tests/unit/prisma/migrations.test.ts` (2 casos); `tests/integration/fixtures.ts` limpa as novas tabelas.
- Aprovados: `prisma validate`, `prisma generate`, typecheck, lint, 81 testes unitários e build.
- Pendente: `npm.cmd run test:integration` falhou ao conectar no `TEST_DATABASE_URL` (`FATAL: (ENOTFOUND) tenant/user ... not found` no pooler do Supabase). A migration não foi aplicada em nenhum banco; o banco de desenvolvimento não foi usado.
- SF-031 implementada, não concluída. `TASKS.md`, `NOTES.md` e `diario/2026-10-16.md` atualizados. Sem commit/push.
