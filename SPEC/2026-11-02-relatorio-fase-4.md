# Relatório da fase 4 — Transversais

**Data:** 2026-11-02
**Exigido por:** `SPEC/2026-10-30-camadas-para-100k.md`, seção 6 (relatório ao fim de cada fase); `SPEC/2026-10-29-plano-escala-100k.md`, seção 6 (fase 4 = itens 9, 10, 11 e 12)
**Período:** do commit `97e05d0` (01/11, 19:00), que publicou o relatório da fase 3, ao commit `bc8fb85` (02/11, 11:29), que fecha a SF-108

## 1. Escopo da fase

| Item do plano | Conteúdo | Tarefas | SPEC | Situação |
|---|---|---|---|---|
| 9 | Permissões configuráveis | SF-087 a SF-091 | `2026-11-01-permissoes-configuraveis.md` | Concluída (CA-PER-01 a 10) |
| 10 (resto) | Notificações por e-mail e preferências | SF-092 a SF-096 | `2026-11-01-notificacoes-email-preferencias.md` | Concluída (CA-MAIL-01 a 10) |
| 11 | Painel, indicadores, relatórios e CSV | SF-097 a SF-101 | `2026-11-02-painel-relatorios.md` | Concluída (CA-DASH-01 a 10) |
| 12 | Auditoria administrativa; retenção, exportação e anonimização (LGPD) | SF-102 a SF-108 | `2026-11-02-auditoria-lgpd.md` | Concluída (CA-AUD-01 a 10) |

**Partes deixadas fora de escopo pelas SPECs** (candidatas a SPECs adicionais, seção 8):

- Permissões: papéis criados pelo administrador, permissões em outros setores, permissões temporárias ou com aprovação.
- E-mail: resumo diário ou agrupamento, e-mail em HTML, cancelamento em um clique, devoluções (*bounces*), verificação do endereço, outros canais.
- Painel: painel para atendentes, relatórios agendados ou por e-mail, painéis configuráveis, metas e alertas sobre indicadores.
- Auditoria e LGPD: registro de leituras e de tentativas de login, observabilidade, retenção configurável pela tela, anonimização automática por inatividade.

## 2. Medição

### 2.1. Por área (`sh scripts/cloc-diff.sh`, TypeScript/JavaScript)

| Área | Acumulado (`baseline-ap2` → `bc8fb85`) | Só a fase 4 (`97e05d0` → `bc8fb85`) |
|---|---:|---:|
| `src` | 14.162 | 4.038 |
| `tests` | 16.025 | 4.500 |
| `scripts` | 546 | 5 |
| **Total `added`** | **30.733** | **8.543** |
| `removed` | 2.528 | 145 |
| **Saldo líquido** | **28.205** | **8.398** |

- O `97e05d0` só mudou documentação em relação ao `334a890` (fim da fase 3): a medição acumulada nele é a mesma, 22.343.
- **Testes:** 1,11 linha de teste por linha de aplicação na fase (4.500 para 4.038), abaixo das 1,38 da fase 3.

### 2.2. Por SPEC (diferença entre medições acumuladas)

| SPEC | Último commit | Acumulado | Linhas da SPEC | Estimativa do plano | Razão estimativa ÷ real |
|---|---|---:|---:|---:|---:|
| Fim da fase 3 | `97e05d0` | 22.343 | — | — | — |
| Permissões (item 9) | `e9b7cef` | 23.707 | 1.364 | 7.000–10.000 | 5,1 a 7,3 |
| E-mail e preferências (resto do item 10) | `38b1b88` | 25.293 | 1.586 | 4.000–7.000 | 2,5 a 4,4 |
| Painel e relatórios (item 11) | `7c8b943` | 27.361 | 2.068 | 6.000–9.000 | 2,9 a 4,4 |
| Auditoria e LGPD (item 12) | `bc8fb85` | 30.733 | 3.372 | 5.000–7.000 | 1,5 a 2,1 |

- A soma por SPEC (8.390) difere em 153 linhas da medição direta da fase (8.543), pelo mesmo motivo dos relatórios anteriores: o cloc compara arquivos inteiros em cada medição.
- A estimativa do item 10 é a parte restante (e-mail e preferências), já descontada no relatório da fase 3.

## 3. Suítes

| Verificação | Fim da fase 3 (`334a890`) | Fim da fase 4 (`bc8fb85`) |
|---|---:|---:|
| Lint, typecheck, build | OK | OK |
| Unitários | 534 (91 arquivos) | 695 (114 arquivos) |
| Integração | 251 + 1 pulado (55 arquivos) | 314 + 1 pulado (71 arquivos) |
| E2E | 13 | 17 |

- As suítes completas passaram antes de cada commit da fase (registros em `diario/2026-11-01.md` e `diario/2026-11-02.md`).
- O teste pulado continua sendo o do bucket real do Supabase (SF-030, sem credenciais).
- Os quatro E2E novos: `permissions.spec.ts`, `email-notifications.spec.ts`, `dashboard.spec.ts` e `audit-lgpd.spec.ts`.
- **Suítes não executadas de novo para este relatório**, que só altera documentação; o banco de teste local estava desligado.

## 4. Critérios cumpridos

- **CA-PER-01 a 10, CA-MAIL-01 a 10, CA-DASH-01 a 10 e CA-AUD-01 a 10:** 40 critérios, todos verificados por testes unitários, de integração e E2E.
- **Pendente de fases anteriores:** CA-DOC-21 continua parcial (SF-030).
- **Garantias do plano (seção 7):**
  - **Nenhuma asserção de teste anterior às SPECs da fase foi alterada.** Os testes existentes mudaram só na configuração: `vi.mock` do módulo de permissões em arquivos que importam as ações da administração; `requireCatalogEditor` e `assertCatalogSector` nos mocks de autorização (SF-089); `permissions` e `findPermissions` no dublê em memória (SF-090); limpeza das tabelas novas em `tests/integration/fixtures.ts`; o método `audited` nos sete dublês de transação dos testes unitários e `anonymizedAt` nos dados de teste de usuários (SF-102 a SF-107).
  - **Migrations:** quatro aditivas (`20261101600000_user_permissions`, `20261101700000_email_notifications`, `20261102100000_audit_trail` e `20261102200000_audit_actor_reference`) e uma exceção registrada: a última muda a tabela `AuditEntry`, criada na própria SPEC e ainda vazia em todos os bancos, para guardar o autor sem chave estrangeira (seção 6 da SPEC de auditoria). Nenhum dado existente mudou.
  - **Comportamento novo desligado por padrão:** sem permissões concedidas, sem preferência de e-mail ligada e sem anonimização, o sistema funciona como antes. O painel e a auditoria são telas novas que só leem.
  - **Nenhuma dependência nova** na fase (`package.json` e `package-lock.json` sem diferença entre `97e05d0` e `bc8fb85`). O envio de e-mail usa `fetch` e as barras do painel usam HTML e CSS.
  - **Nenhuma duplicação ou código gerado em massa** (SF-026). O catálogo de permissões foi para `src/shared/permissions`, e os utilitários de dia e os rótulos foram para `src/shared`, sem cópias.

## 5. Regressões e defeitos

| Quando | O que | Tratamento |
|---|---|---|
| SF-089 | O script que trocou a autorização quebrou duas linhas de `import`; um link condicional montava JSX dentro de `try/catch`, o que o lint recusa | Encontrados pelo typecheck e pelo lint; corrigidos à mão |
| SF-092 | **Incidente:** gerei o SQL da migration com o banco de desenvolvimento local como banco sombra, e o Prisma apagou os dados dele | O banco de teste e o Neon não foram afetados. Recriei o schema, apliquei as migrations e rodei o seed. A regra passou a ser gerar o SQL comparando os arquivos de schema, sem banco sombra |
| SF-101 | O E2E novo criava uma solicitação em nome do solicitante de demonstração e fazia `demo-data.spec.ts` falhar na suíte completa | Encontrado na suíte completa; o teste novo passou a criar o próprio solicitante |
| SF-102 | A auditoria com chave estrangeira para o autor fez falhar 26 testes de integração anteriores, que simulam a sessão com identificadores inexistentes | Encontrado antes do commit; o autor passou a texto (migration `20261102200000_audit_actor_reference`), sem mudar os testes |
| SF-104 | "nome (perfil)" com parênteses duplos na linha da auditoria | Encontrado na captura do navegador; trocado por "nome · perfil" |
| SF-107 | O campo `removedAt` vinha em todos os anexos e mudava a lista de campos conferida por um teste antigo de integração | Encontrado pelo teste existente; corrigi o código (campo só no anexo removido), não o teste |
| SF-107 | A caixa de confirmação da anonimização saía esticada | Encontrado no navegador; estilo `checkbox-field` |
| Toda a fase | Aviso "The destination stream closed early" no servidor do E2E | Também aparece no download de "Meus dados"; vem do jeito como o navegador de teste recebe downloads, sem falha de teste |
| Depois da SF-108 | O Claude Code encerrou o PostgreSQL de teste por falta de memória da máquina, com a sessão parada | Não afetou nenhuma execução: as suítes da SF-108 já tinham passado. Fica desligado até ser pedido de novo |

Nenhuma regressão chegou a um commit.

## 6. Publicação

- O site publicado continua na versão anterior ao SLA. Antes do próximo deploy, é preciso aplicar no Neon dez migrations: as seis listadas no relatório da fase 3 e mais `20261101600000_user_permissions`, `20261101700000_email_notifications`, `20261102100000_audit_trail` e `20261102200000_audit_actor_reference`.
- **E-mail:** para enviar de verdade, criar a conta no provedor (Resend), verificar o domínio e cadastrar `EMAIL_API_KEY`, `EMAIL_FROM` e `APP_BASE_URL` na Vercel. Sem isso, os envios ficam como "não enviado — não configurado", e o resto funciona.
- **Job diário:** a retenção (SF-105) roda na rota de cron que já existe; não há configuração nova.

## 7. Tempo gasto

Fonte: horários das transcrições do Claude Code, em UTC−3, com a regra de `diario/tempo-do-projeto.md` (intervalos sem registro acima de 60 minutos dividem o período).

| Período | Início | Fim | Duração | Trabalho |
|---|---|---|---:|---|
| 01/11 a 02/11 | 18:59 | 03:12 | 8h13 | SPECs de permissões, e-mail, painel e auditoria; SF-087 a SF-106 |
| 02/11 | 10:07 | 11:47 | 1h40 | Estado do projeto, SF-107 e SF-108 |
| **Total** | | | **9h53** | |

- Depois das 11:47 houve só um aviso sobre o encerramento do banco de teste (12:41), que não conta como trabalho.
- **Ritmo:** cerca de **860 linhas `added` por hora** (8.543 em 9h53), entre as 820 da fase 2 e as 940 da fase 3.

## 8. Recalibração do plano

| Fase | Previsão do plano (acumulado) | Real |
|---|---:|---:|
| 1 | 7.000 – 12.000 | 7.616 |
| 2 | 26.000 – 39.000 | 15.259 |
| 3 | 51.000 – 75.000 | 22.343 |
| 4 | 76.000 – 111.000 | **30.733** |

Os itens 9 a 12 somaram 8.390 linhas, contra 22.000 a 33.000 estimadas: **as estimativas ficaram de 2,6 a 3,9 vezes acima do real**, um pouco abaixo da faixa das fases 2 (3,3 a 4,7) e 3 (3,5 a 5,1). A diferença vem da auditoria (1,5 a 2,1), que mexeu em todos os casos de uso administrativos e teve muitos testes de integração.

**Projeção para os itens que faltam (fase 5: 14, 15 e 16):**

| Medida | Mínimo | Máximo |
|---|---:|---:|
| Estimativa do plano (6.000–9.000 + 3.000–5.000 + 8.000–12.000) | 17.000 | 26.000 |
| Corrigida pela faixa observada nas fases 2 a 4 (÷ 5,1 e ÷ 2,6) | ~3.300 | ~10.000 |
| **Total projetado ao fim do roadmap** | **~34.000** | **~41.000** |

**Situação da meta:** a meta de 100.000 linhas não será alcançada só pelo roadmap. Com a decisão da fase 2 (opção 2: acrescentar funcionalidades reais, cada uma com SPEC aprovada), faltariam de 59.000 a 66.000 linhas além do roadmap. No ritmo medido (cerca de 2.100 linhas por SPEC nesta fase), isso equivale a cerca de 30 SPECs do porte das desta fase. Nenhuma linha pode vir de código artificial (SF-026).

**Observações sobre a fase 5:**

- O item 16 (múltiplas organizações com isolamento) muda todas as tabelas e todas as consultas. É o de maior risco para a garantia de não quebrar o que funciona e exige uma SPEC com plano de migração dos dados existentes.
- O item 15 (ferramentas MCP de consulta a documentos) depende do armazenamento real (SF-030) para ser útil fora dos testes.
- O item 14 (API externa com tokens e webhooks) pode reaproveitar os eventos da outbox e a auditoria.

## 9. Pendências que passam para a fase 5

1. SF-030: provisionar o armazenamento real (credenciais do Supabase) e fechar o CA-DOC-21.
2. Aplicar no Neon as dez migrations da seção 6 antes da próxima publicação.
3. Banco Neon: trocar a senha se receber dados reais.
4. E-mail: conta no provedor e as três variáveis na Vercel, se o envio for usado.
5. Fase 5 do plano: API externa (item 14), ferramentas MCP (item 15) e múltiplas organizações (item 16), cada um com SPEC própria, e a escolha das funcionalidades adicionais da opção 2 (seções 1 e 8 deste relatório e do relatório da fase 3).
6. Pendências antigas: SF-028 (política de backup e teste de restauração) e SF-029 (registro da validação de integração da troca de senha).
