# SPEC — Integração contínua (CI) no GitHub Actions

**Data:** 2026-11-04  
**Status:** Aprovada  
**Projeto:** ServiceFlow  

## 1. Objetivo

Adicionar um pipeline de integração contínua que execute, em cada push e pull request na `main`, as verificações de qualidade e as suítes de testes do projeto, com um banco PostgreSQL dedicado.

## 2. Escopo

- Workflow `.github/workflows/ci.yml` com serviço PostgreSQL 17.
- Etapas: instalação, geração do Prisma Client, typecheck, lint, build, testes unitários, testes de integração, instalação do Chromium e testes E2E.
- Variáveis de ambiente não secretas para o banco de teste e `AUTH_SECRET` de CI.

## 3. Fora de escopo

- Gitleaks (SPEC separada).
- Deploy automático (já existe via Vercel).
- Testes de storage real (dependem de credenciais).

## 4. Critérios de aceitação

- CA-CI-01: o YAML é válido e o workflow dispara em `push`/`pull_request` para `main`.
- CA-CI-02: o job usa serviço PostgreSQL com healthcheck.
- CA-CI-03: todas as etapas do README (typecheck, lint, build, unit, integration, e2e) são executadas.
- CA-CI-04: nenhuma credencial real é versionada.

## 5. Correção (2026-11-05)

As primeiras execuções falharam nos testes de integração porque `DATABASE_URL` e `TEST_DATABASE_URL` apontavam para o mesmo banco, o que a proteção dos testes recusa. O CI passa a usar um banco de desenvolvimento separado (`serviceflow_dev`), criado no próprio job. Detalhes em `NOTES.md`.

## 6. Correções e varredura de segredos (2026-11-06)

A responsável aprovou em 2026-11-06 ("comece pelo item 1"; opção "Binário oficial fixado" para o gitleaks). As falhas foram lidas nas anotações públicas da API do GitHub, sem precisar do log completo:

1. **Teste instável (5 de 6 execuções falhas):** `tests/integration/attendance-fields.test.ts` ordenava as respostas só por `positionSnapshot`. As respostas do solicitante e as do atendimento são numeradas separadamente, ambas a partir de 0, e o empate deixava a ordem por conta do banco. Reproduzido localmente (1 falha em 6 com o teste antigo; 8 de 8 com o corrigido). A consulta do teste passou a ordenar como a tela: primeiro as respostas do solicitante, depois a posição. A aplicação não tinha o defeito.
2. **Ubuntu fixado:** desde 2026-10-19 o rótulo `ubuntu-latest` aponta para o Ubuntu 26, e o Playwright em uso (1.56) só conhece até o 24.04. Numa execução, o passo `playwright install --with-deps` falhou. O job passa a usar `ubuntu-24.04`. Atualizar o Playwright fica para quando for preciso, pela regra de não mexer em dependências sem necessidade.
3. **Varredura de segredos:** um novo passo, logo após o checkout com o histórico completo (`fetch-depth: 0`), baixa o gitleaks **8.30.1** oficial, confere o SHA-256 publicado pelo projeto (`551f6fc8…70eb`, linux x64) e varre todos os commits. O passo falha se encontrar segredo. Os dois achados do histórico eram o texto sintético `CRON_SECRET` de dois testes unitários; foram revisados e listados em `.gitleaksignore`. Sem Action de terceiros e sem dependência npm.

Novos critérios:

- [x] CA-CI-05: o CI varre o histórico completo com gitleaks em versão e SHA-256 fixos, e falha se encontrar segredo. *Verificado em 2026-11-06: a mesma versão rodou localmente sobre os 202 commits, com 0 achados depois da revisão dos 2 falsos positivos; checksum e extração simulados.*
- [ ] CA-CI-06: o workflow passa inteiro no GitHub. *A verificar na primeira execução depois do push.*

**Atualização 2026-11-06 (depois do push de `30c2a4e`):** a execução `42157711665` passou pelo gitleaks, pela integração e pela instalação do Playwright, o que confirma as correções 1 a 3. A falha foi no passo de E2E, sem anotação que dissesse qual teste. O Playwright passa a usar também o reporter `github` quando `CI` está definido, para que a próxima execução mostre o teste que falhou nas anotações públicas.

**Atualização 2026-11-06 (execução `42168361870`):** as anotações mostraram 5 E2E falhando porque, no Node 24 do CI, um campo de arquivo vazio chega à Server Action com o nome `"blob"`. Era um defeito real da aplicação, que também afetava a produção (Node 26), e não do CI. Corrigido em `comment-form-data.ts`; a suíte E2E inteira passou localmente com o Node 24. CA-CI-06 continua a verificar na próxima execução.

**Atualização 2026-11-06 (execução `42205142445`):** os 5 E2E do campo de arquivo vazio não chegaram a rodar, porque a integração falhou antes num teste que dependia da hora do dia (`business-hours-sla.test.ts`, só entre 10:00 e 11:00 UTC). Corrigido o teste; com o Node 24 fixado também na máquina, todas as suítes passaram localmente.

## 7. Novas tentativas no download do gitleaks (2026-11-08)

A responsável aprovou em 2026-11-08 ("pode fazer a opção 2"). Duas execuções seguidas (`42470836259` e `42472307287`) falharam no passo da varredura de segredos sem achado nenhum: o `curl` que baixa o binário oficial terminou com o código 22 (o GitHub respondeu 504) e depois com o 56 (a conexão caiu). A varredura local com o mesmo binário não encontrou segredos.

- O download passou a tentar de novo até 5 vezes, com 10 segundos entre as tentativas, também nos erros de rede e de servidor (`--retry 5 --retry-all-errors --retry-delay 10`). A versão (8.30.1), a conferência do SHA-256 e a varredura do histórico completo não mudaram.
- Conferido localmente: o comando novo baixou o arquivo e o SHA-256 bateu com o fixado no CI.

- Resultado: a execução `42472539280` passou em todos os passos, inclusive a varredura de segredos.
