# Sessão SF-032 — Requisitos documentais por serviço — 2026-10-19

Agente: Claude Code (Claude Opus 5.5). Continuação de `2026-10-19-1210-diagnostico-e-sf033-validacao-arquivos.md`.

## Solicitação 1 — Preparação da próxima etapa (resumo)

> Confirmar no TASKS.md e na SPEC o que falta em SF-030 a SF-036; verificar o registro da SF-033; planejar SF-032, SF-034 e SF-035 com dependências e testes; separar o trabalho local do dependente de PostgreSQL ou Supabase Storage; não implementar nem executar comandos remotos; informar os documentos necessários para confirmar a tarefa acadêmica e a meta de 100.000 linhas.

Resultado: plano apresentado; nenhum arquivo alterado.

## Solicitação 2 — Decisões e plano específico

> 1. Armazenamento: recusar abertura com documentos exigidos enquanto armazenamento real não estiver configurado; permitir serviços sem requisitos
> 2. Ordenação: botões Subir e Descer com atualização transacional
> 3. Sequência: implementar SF-032, revisar, depois SF-034, revisar, depois SF-035 e revisar
> 4. E2E: propor modo de teste explícito com armazenamento em memória; não alterar a SPEC sem aprovação
>
> Comece somente pela SF-032. Preserve todas as alterações existentes. Não execute migrações nem operações remotas. Apresente o plano específico da SF-032 antes de codificar e aguarde aprovação.

Resultado: plano específico e quatro pontos de interpretação apresentados.

## Solicitação 3 — Aprovação e implementação

> Aprovo o plano da SF-032 e as quatro interpretações propostas.
>
> 1. Reativação: não implementar nesta tarefa, pois a SPEC não prevê essa operação.
> 2. Requisitos inativos: exibi-los abaixo dos ativos, apenas como histórico, sem permitir Editar, Subir ou Descer.
> 3. Serviços inativos: permitir configurar requisitos documentais, sem disponibilizá-los no catálogo enquanto o serviço estiver inativo.
> 4. Limites de ordenação: Subir no primeiro requisito e Descer no último devem ser operações sem efeito, sem erro. Os respectivos botões não devem aparecer na interface.
>
> Pode iniciar a implementação da SF-032 seguindo o plano aprovado, com estas condições: preserve todas as alterações locais existentes e os arquivos de backup; não faça commit ou push; não altere a SPEC, salvo se identificar uma contradição real (nesse caso, pare e apresente a divergência); não execute migrações nem altere qualquer banco remoto; implemente os testes unitários e de integração previstos e execute os de integração somente com banco de teste isolado e acessível; inspecione os arquivos e padrões existentes antes de modificá-los; ao final, execute lint, typecheck, testes unitários e build; atualize TASKS.md, NOTES.md, o diário e o registro da sessão; marque a SF-032 como implementada, mas não concluída, enquanto os testes de integração não forem executados com sucesso. Não inicie a SF-034 sem aprovação posterior.

## Resultado

- Novos: `src/modules/document-requirements/index.ts`, `src/modules/document-requirements/policy.ts`, `src/app/(admin)/admin/document-requirements-editor.tsx`, `tests/unit/modules/document-requirements/policy.test.ts`, `tests/integration/document-requirements.test.ts`.
- Alterados: `src/shared/validation/index.ts`, `src/server/errors/index.ts`, `src/app/(admin)/admin/actions.ts`, `src/app/(admin)/admin/page.tsx`, `src/app/(admin)/admin/record-editor.tsx`, `src/app/globals.css`, `tests/unit/admin-actions.test.ts`.
- Aprovados: lint, typecheck, 174 testes unitários (26 arquivos), build, `prisma validate`, `git diff --check`.
- Não executado: `tests/integration/document-requirements.test.ts` (16 casos), porque o `TEST_DATABASE_URL` continua inacessível (`ENOTFOUND`).
- SF-032 implementada, não concluída. SPEC não alterada. Nenhum banco alterado. Sem commit/push. SF-034 não iniciada.
