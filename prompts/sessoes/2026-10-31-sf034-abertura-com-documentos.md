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

## Continuação — SF-036

> faça o push da sf-035 e siga para a sf-036

1. Push de `84fae73` e `23e4c9b`.
2. Leitura dos E2E existentes, do editor de requisitos e dos dados de demonstração.
3. Armazenamento em memória protegido para o servidor do E2E; E2E do percurso de documentos.
4. Revisão dos critérios CA-DOC-01 a 22, de segredos, logs e fixtures; README.
5. Todas as suítes; registro em SPEC, `TASKS.md`, `NOTES.md` e diário. Resultado: `NOTES.md`, seção SF-036.

## Continuação — SQLite e publicação

> é possivel construir um banco de dados com SQlite e rodar no projeto?

> é para resolver o problema de banco de dados e conseguir coloca-lo em um servidor para que seja rodado via um link ou qr code

Resposta sem alteração de código: o SQLite não resolve na Vercel (disco temporário) e exigiria reescrever recursos exclusivos do PostgreSQL (`citext`, listas de enum, CHECKs com expressão regular, transações Serializable). Recomendado manter o PostgreSQL (Supabase ou Neon), aplicar as migrations no banco principal e configurar as variáveis na Vercel.

## Continuação — SF-030

> faça a configuração de arquivos na sf-030 de acordo com o recomendado para o sistema e teste as modificações, inclua isso no MUDANCAS_NO_PROJETO_DIA e faça um commit sobre os resultados, independente se deu certo ou errado,documente. Ao final retorne com um relatorio para mim e me indique quantas linhas de códigos foram adicionados hoje (usando o cloc --diff) e quantos temos ao todo.

1. Conferência das variáveis de ambiente (só nomes) e dos CLIs: sem credenciais do Supabase.
2. Consulta à documentação do Supabase (API de buckets e envio da chave secreta).
3. Script de provisionamento, testes com Supabase simulado e teste de integração do bucket real (pulado sem credenciais).
4. Todas as suítes, registros e `MUDANCAS_NO_PROJETO_DIA/2026-10-31_mudancas.txt`. Resultado: `NOTES.md`, seção SF-030 (2026-10-31).

## Continuação — SPEC de atribuição

> podemos prosseuir construindo outro ponto de função que não se envolva com a questão do banco de dados?

Escolha da responsável: atribuição (passo 3 do plano). SPEC escrita como proposta e aprovada com D1 a D5 conforme propostos; tarefas SF-047 a SF-052 registradas.
