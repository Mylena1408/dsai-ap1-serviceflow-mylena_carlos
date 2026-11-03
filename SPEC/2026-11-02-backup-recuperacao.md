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

Ferramentas: `pg_dump`, `pg_restore` e `psql` do PostgreSQL 17 (a mesma versão principal do Neon e dos bancos locais).

**Cópia (semanal ou antes de deploy):**

```bash
pg_dump --format=custom --no-owner --file="serviceflow-AAAA-MM-DD.dump" "<URL direta do Neon>"
```

Depois, cifrar o arquivo (por exemplo, `7z a -p -mhe=on serviceflow-AAAA-MM-DD.7z serviceflow-AAAA-MM-DD.dump`), guardar fora da máquina e apagar o `.dump` sem cifra.

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
- **Primeiro teste na produção:** fica para a primeira cópia semanal do Neon feita pela responsável, seguindo a seção 4.
