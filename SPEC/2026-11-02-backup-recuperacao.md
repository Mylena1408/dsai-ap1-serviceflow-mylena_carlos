# SPEC — Política de backup e recuperação do banco

**Data:** 2026-11-02
**Status:** Aprovada em 2026-11-02 pela responsável (opção "Semanal + antes de deploy"). Teste de restauração executado em 2026-11-02 (seção 6).
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seção 18, "Política de backup e recuperação do banco definida para o ambiente de execução antes de uso com dados reais"; seção 21, objetos do bucket), `SPEC/2026-11-02-auditoria-lgpd.md` (dados pessoais), tarefa SF-028

## 1. Objetivo

Definir como o banco de produção (PostgreSQL no Neon) é copiado, por quanto tempo as cópias são guardadas, quanto se aceita perder, quanto tempo leva para voltar e como a restauração é testada. Não muda nenhuma funcionalidade.

## 2. Situação do ambiente

- O banco de produção está no Neon, plano gratuito. A recuperação nativa do Neon (histórico de alterações) cobre no máximo cerca de **6 horas** e 1 GB de alterações nesse plano, e o plano inclui **1 snapshot manual**. A documentação do Neon se contradiz sobre a restauração instantânea estar disponível no plano gratuito ([planos](https://neon.com/docs/introduction/plans), [janela de histórico](https://neon.com/docs/postgres/backup-restore/history-window); consultado em 2026-11-02). Por isso, o Neon não é a política de backup: é só uma camada extra para erros recentes.
- O armazenamento de documentos (Supabase Storage) ainda não foi provisionado (SF-030). Sem ele, não há arquivos de anexo em produção.

## 3. Política aprovada

| Item | Regra |
|---|---|
| Tipo de cópia | Cópia lógica completa com `pg_dump --format=custom --no-owner`, pela **conexão direta** do Neon (sem `-pooler`) |
| Frequência | **Toda semana** e **antes de cada migration ou deploy** |
| Retenção | As **4 últimas semanais** e as de antes de deploy por **30 dias**; cópias mais antigas são apagadas |
| Onde guardar | Fora do repositório e fora da máquina de trabalho (por exemplo, um armazenamento pessoal com acesso só da responsável), **cifradas** com senha forte, porque contêm dados pessoais (nomes, e-mails, textos das solicitações) |
| Perda máxima aceita (RPO) | **7 dias** (o histórico do Neon pode reduzir isso para erros das últimas horas) |
| Tempo de recuperação (RTO) | **Até 2 horas** |
| Teste de restauração | **A cada 3 meses** e depois de cada migration que mude dados, num banco isolado, com o resultado registrado no `NOTES.md` |
| Documentos (quando a SF-030 for feita) | Os objetos do bucket entram na mesma frequência e retenção; a restauração precisa trazer banco e arquivos do mesmo momento |

Regras de segurança:

- Uma cópia **nunca** entra no Git (`*.dump` está no `.gitignore`) nem em chat, e-mail ou ferramenta de IA.
- A URL do banco com a senha nunca é gravada em arquivo do projeto: é passada só na linha de comando.
- Uma restauração nunca é feita por cima do banco em uso: restaura-se num banco novo, confere-se e só então a aplicação é apontada para ele.
- A anonimização (LGPD) também vale para as cópias: quem foi anonimizado continua nas cópias antigas até elas vencerem pela retenção; por isso a retenção é curta (30 dias).

## 4. Procedimentos

Ferramentas: `pg_dump`, `pg_restore` e `psql` do **PostgreSQL 18**, a mesma versão principal do Neon (18.6 em 2026-11-03). O `pg_dump` se recusa a copiar um servidor de versão mais nova que a dele. *Corrigido em 2026-11-03: a primeira versão desta SPEC dizia PostgreSQL 17 para o Neon; os bancos locais é que são 17.*

**Cópia (semanal ou antes de deploy):**

```bash
pg_dump --format=custom --no-owner --file="serviceflow-AAAA-MM-DD.dump" "<URL direta do Neon>"
```

Depois, cifrar o arquivo (por exemplo, `7z a -p -mhe=on serviceflow-AAAA-MM-DD.7z serviceflow-AAAA-MM-DD.dump`, ou guardar numa pasta cifrada pelo EFS do Windows com `cipher /e`), guardar uma cópia fora da máquina e apagar o `.dump` sem cifra. O EFS vincula o arquivo à conta do Windows: copiá-lo para um pendrive FAT ou para a nuvem pode tirar a cifra, então a cópia externa precisa de cifra própria.

Se o banco restaurado não tiver as extensões do original, criar antes `CREATE EXTENSION IF NOT EXISTS citext` (as tabelas usam o tipo `citext`); restaurar com `--schema=public` deixa a extensão de fora.

**Restauração (em caso de perda):**

1. Criar um banco novo vazio (no Neon, um novo banco ou branch).
2. `pg_restore --no-owner --exit-on-error --dbname="<URL do banco novo>" serviceflow-AAAA-MM-DD.dump`
3. Conferir com `prisma migrate status` (deve dizer "Database schema is up to date") e com a contagem de linhas das tabelas principais.
4. Trocar a `DATABASE_URL` da Vercel para o banco novo e publicar de novo.
5. Registrar no `NOTES.md` o que aconteceu, a cópia usada e o que se perdeu.

**Teste de restauração (a cada 3 meses):** os mesmos passos 1 a 3 num banco isolado, comparando com a origem a contagem de linhas de cada tabela, as restrições, os índices e as funções; depois, apagar o banco de teste e a cópia sem cifra.

## 5. Critérios de aceitação

- [x] **CA-BKP-01** — A política define frequência, retenção, local, perda máxima aceita e tempo de recuperação. *Verificado em 2026-11-02: seção 3.*
- [x] **CA-BKP-02** — Uma cópia feita com o procedimento é restaurada num banco isolado, com as mesmas linhas em cada tabela, a mesma estrutura e as migrations em dia. *Verificado em 2026-11-02: seção 6.*
- [x] **CA-BKP-03** — Nenhuma cópia nem credencial entra no repositório. *Verificado em 2026-11-02: `*.dump` no `.gitignore`; a cópia do teste ficou fora do projeto e foi apagada; a URL foi lida do `.env.local` sem aparecer.*

## 6. Teste de restauração de 2026-11-02

- **Origem:** banco local de desenvolvimento (`serviceflow_dev`, dados fictícios), PostgreSQL 17.10. Não foi usado o banco de produção: copiar o Neon exige a conexão de produção, que é da responsável (procedimento da seção 4).
- **Ferramentas:** binários oficiais do PostgreSQL 17.11 (zip da EnterpriseDB, extraído fora do projeto; SHA-256 igual ao registrado no `NOTES.md` em 2026-10).
- **Passos:** `pg_dump` em formato custom (103 KB) → banco novo `serviceflow_restore_drill` → `pg_restore --exit-on-error`. Cópia e restauração em 3 segundos.
- **Resultado:** as 28 tabelas com a mesma contagem de linhas na origem e no destino (por exemplo, 7 usuários, 12 solicitações, 23 eventos de status, 21 migrations); estrutura igual (118 restrições, 73 índices, 50 funções e 1 trigger); `prisma migrate status` no banco restaurado: "Database schema is up to date". O banco de teste e a cópia foram apagados em seguida.
- **Primeiro teste na produção:** ver seção 7.

## 7. Primeira cópia de produção (2026-11-03)

- A pedido da responsável, feita pelo agente com a conexão direta do Neon (passada só na linha de comando).
- A primeira tentativa com o `pg_dump` 17 parou: o Neon roda PostgreSQL 18.6. Foram baixados os binários oficiais do PostgreSQL 18.6 (zip da EnterpriseDB, revisão 18.6-3, 344.414.106 bytes, igual ao tamanho anunciado; SHA-256 `59F8CE701C63C2ED623C665A5E51B3EF6F2E37CCF837B68FFEED0742D0AE6ABD`), extraídos fora do projeto.
- Cópia `serviceflow-2026-11-03.dump` (124 KB) em `C:\Users\Mylena Reis\serviceflow-backups\`, pasta e arquivo cifrados pelo EFS do Windows.
- Verificação: restaurada num banco local isolado (criando antes a extensão `citext`), com as 28 tabelas e a mesma contagem de linhas da produção (por exemplo, 10 pessoas, 26 solicitações, 21 migrations) e `prisma migrate status` em dia; o banco de verificação foi apagado.
- Falta, pela política, guardar uma cópia fora da máquina, com cifra própria.

## 8. Cópia antes do deploy de 2026-11-05

- Feita pelo agente antes de aplicar 6 migrations no Neon (SF-030), com a URL direta lida de um arquivo da responsável fora do projeto, sem aparecer na saída.
- Cópia `serviceflow-2026-11-05-pre-deploy.dump` (124.778 bytes) em `C:\Users\Mylena Reis\serviceflow-backups\`, cifrada pelo EFS.
- Verificação: restaurada num banco local isolado; as 28 tabelas com a mesma contagem de linhas da produção (10 pessoas, 26 solicitações, 21 migrations); o banco de verificação foi apagado.
- Continua faltando a cópia fora da máquina, com cifra própria.

## 9. Cópia antes do deploy de 2026-11-06

- Feita pelo agente, a pedido da responsável ("pode fazer o backup"), antes de aplicar 4 migrations no Neon (satisfação, respostas prontas, escalonamento e base de conhecimento). URL lida do arquivo da responsável fora do projeto, sem aparecer na saída.
- Cópia `serviceflow-2026-11-06-pre-deploy.dump` (153.272 bytes) em `C:\Users\Mylena Reis\serviceflow-backups\`, com o atributo cifrado do EFS conferido.
- Verificação: restaurada num banco local isolado; as 34 tabelas com a mesma contagem de linhas da produção (10 pessoas, 38 solicitações, 27 migrations); o banco de verificação foi apagado.
- Continua faltando a cópia fora da máquina, com cifra própria.

## 10. Cópia antes do deploy de 2026-11-07

- Feita pelo agente, a pedido da responsável ("arquivo salvo, pode seguir"), antes de aplicar 6 migrations no Neon (SF-160, SF-161, SF-164, SF-165 e SF-166). URL direta lida de um arquivo da responsável fora do projeto, sem aparecer na saída. Antes, uma leitura conferiu que era a produção: PostgreSQL 18.6, 10 pessoas, 38 solicitações, 31 migrations.
- Cópia `serviceflow-2026-11-07-pre-deploy.dump` (171.131 bytes) em `C:\Users\Mylena Reis\serviceflow-backups\`, com o atributo cifrado do EFS conferido.
- Verificação: restaurada num banco local isolado; as 39 tabelas com a mesma contagem de linhas da produção; o banco de verificação foi apagado.
- **Ajustes na restauração de verificação:** a URL do banco local tem o parâmetro `schema` do Prisma, que o `pg_restore` não aceita (removido só para ele); e a cópia do Neon traz permissões padrão para papéis do próprio Neon (`neon_superuser`), que não existem no banco local, por isso a restauração usa `--no-acl`. A cópia em si continua completa, com as permissões.
- Continua faltando a cópia fora da máquina, com cifra própria.

## 11. Cópia antes do segundo deploy de 2026-11-07

- Feita pelo agente, a pedido da responsável ("siga com backup, migrations e push nesta ordem"), antes de aplicar 6 migrations no Neon (SF-168 a SF-174). URL direta lida do arquivo da responsável fora do projeto, sem aparecer na saída.
- Cópia `serviceflow-2026-11-07-pre-deploy-2.dump` (182.552 bytes) em `C:\Users\Mylena Reis\serviceflow-backups\`, com o atributo cifrado do EFS conferido.
- Verificação: restaurada num banco local isolado, com os mesmos ajustes da seção 10; as 40 tabelas com a mesma contagem de linhas da produção (10 pessoas, 38 solicitações, 37 migrations); o banco de verificação foi apagado.
- Continua faltando a cópia fora da máquina, com cifra própria.
