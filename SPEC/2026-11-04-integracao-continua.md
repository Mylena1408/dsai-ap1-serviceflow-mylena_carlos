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
