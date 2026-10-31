# Sessão — SF-034: abertura de solicitação com documentos (2026-10-31)

**Ferramenta:** Claude Code (Claude Opus 5.5)

## Prompts

> gere em palavras tudo o que mudado e responda a esta pergunta?A gente vai implementar tudo o que der pra implementar no software pra chegar as 100mil linhas ou vai ter algo que não iremos implementar?

> me diga quais os proximos passos?

> pode começar pela SF-034

## Execução

1. Leitura do resumo de 30/10, das SPECs do plano de 100 mil linhas e da seção 21 da SPEC principal.
2. Leitura dos módulos `requests`, `attachments`, `document-requirements`, do adaptador `src/server/storage` e da migration de documentos.
3. Implementação em camadas (domínio, caso de uso, repositório Prisma, composição em `index.ts`, Server Action e tela).
4. Testes unitários e de integração novos; ajuste dos dublês existentes.
5. Lint, typecheck, unitários, integração, build e E2E; verificação com `git stash` de que o aviso do servidor no E2E é anterior à mudança.
6. Registro em SPEC (critérios), `TASKS.md`, `NOTES.md` e diário.

## Resultado

Ver `NOTES.md`, seção SF-034.

## Continuação — SF-035

> faça um push e siga para a SF-035

1. Push de `051621b` e `d487b03`.
2. Leitura da política de autorização, das páginas de detalhe e do callback de sessão do Auth.js.
3. Casos de uso de listagem e download, repositório Prisma, rota de download e componente de listagem.
4. Testes unitários e de integração; todas as suítes; correção de lint num teste novo.
5. Registro em SPEC, `TASKS.md`, `NOTES.md` e diário. Resultado: `NOTES.md`, seção SF-035.
