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
