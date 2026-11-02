# SPEC — Auditoria administrativa e dados pessoais (LGPD)

**Data:** 2026-11-02
**Status:** Aprovada em 2026-11-02, com as decisões D1 a D5 da seção 11 conforme propostas.
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-visao-geral.md` (§10 Histórico e auditoria), `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seção 19, "políticas mais detalhadas de retenção, exportação e anonimização de dados"; seção 21.15), `SPEC/2026-10-31-eventos-outbox-jobs.md` (job diário e limpezas), `SPEC/2026-11-01-permissoes-configuraveis.md` (histórico de permissões), `SPEC/2026-11-01-notificacoes-email-preferencias.md` (envios), `SPEC/2026-10-29-plano-escala-100k.md` (item 12 e garantia 7.4), `SPEC/2026-10-30-camadas-para-100k.md` (camada "Auditoria e observabilidade")

## 1. Objetivo

O histórico de cada solicitação já mostra mudanças de status, atribuições, prioridade, etapas e aprovações, e as permissões têm histórico próprio. Ficam sem registro as **alterações administrativas** — quem criou, mudou, desativou ou reativou usuários, setores, categorias, serviços, documentos exigidos, campos e etapas — e não há regras escritas sobre **por quanto tempo** cada dado fica guardado, nem forma de uma pessoa **obter os próprios dados** ou de o administrador **anonimizar** quem saiu da organização. Esta SPEC cobre esses quatro pontos, que a SPEC principal (seção 19) deixou para depois.

## 2. Registro da mudança de escopo

A SPEC principal (seção 19) deixou "políticas mais detalhadas de retenção, exportação e anonimização de dados" para uma SPEC futura; o plano de escala (item 12) previu "auditoria geral; retenção, exportação e anonimização (LGPD)". Pela garantia 7.4, **as telas e regras existentes não mudam**: a auditoria só acrescenta registros, a retenção só apaga dados já descartáveis, e a exportação e a anonimização são ações novas e explícitas.

Esta SPEC organiza o tratamento de dados no sistema; ela **não substitui** a orientação jurídica da organização sobre bases legais, prazos e pedidos dos titulares.

## 3. Escopo

1. Trilha de auditoria das alterações administrativas **(decisão D1)**, gravada na mesma transação da alteração **(decisão D5)**.
2. Seção "Auditoria" na administração, só para o administrador.
3. Política de retenção escrita e aplicada pelo job diário **(decisão D2)**.
4. "Meus dados": cada pessoa baixa os próprios dados **(decisão D3)**.
5. Anonimização de uma pessoa desativada pelo administrador **(decisão D4)**.

## 4. Fora de escopo

- Registro de leituras (quem abriu qual solicitação) e de navegação.
- Registro de tentativas de login.
- Logs estruturados de aplicação e observabilidade (métricas, rastreamento).
- Exclusão completa de solicitações ou do histórico delas.
- Pedidos de titulares feitos fora do sistema (atendimento jurídico, prazos legais de resposta).
- Retenção configurável pela tela; os prazos ficam no código e nesta SPEC.
- Anonimização automática por inatividade.

## 5. Regras

### 5.1 O que entra na auditoria **(decisão D1)**

| Entidade | Ações registradas |
|---|---|
| Usuário | criação; alteração de nome, e-mail, perfil ou setor; desativação; reativação; anonimização |
| Setor, categoria | criação; renomeação; desativação; reativação |
| Serviço | criação; alteração de qualquer campo da configuração (inclusive SLA, prioridade padrão e exigência de aprovação); desativação; reativação |
| Documento exigido, campo personalizado, etapa | criação; alteração; reordenação; desativação; reativação |
| Dados pessoais | exportação de "Meus dados" (quem e quando) |

Concessões e revogações de permissões **continuam** no histórico próprio da SPEC de permissões; a seção "Auditoria" as mostra junto, lidas daquele histórico, sem duplicar o registro.

Cada registro guarda: quando, quem fez (pessoa e perfil naquele momento), ação, tipo e identificador da entidade, o nome da entidade naquele momento e **os campos alterados**, com valor anterior e novo. Para campos pessoais (nome e e-mail de usuário) o registro guarda só **que** o campo mudou, nunca os valores; senhas e hashes nunca entram.

Ações feitas por quem tem a permissão "Gerir serviços do setor" também são registradas, com o perfil da pessoa.

### 5.2 Seção "Auditoria"

- Só o administrador vê. Lista do mais recente ao mais antigo, 50 por página, com filtros por período (as mesmas opções do painel), tipo de entidade e pessoa que fez.
- Cada linha: data e hora, pessoa, ação em português, entidade e os campos alterados ("SLA: 24 h → 12 h"; "E-mail: alterado").
- Os registros não podem ser editados nem apagados pela aplicação; só a retenção (5.3) os remove.

### 5.3 Retenção **(decisão D2)**

| Dado | Prazo | O que acontece |
|---|---|---|
| Eventos processados | 30 dias (já existe) | apagados |
| Notificações lidas | 90 dias (já existe) | apagadas |
| Notificações não lidas | 365 dias | apagadas |
| Registros de envio de e-mail | 180 dias | apagados |
| Registros de auditoria | 5 anos | apagados |
| Solicitações, histórico, comentários e anexos | sem prazo automático | ficam como registro da organização; os dados pessoais saem pela anonimização (5.5) |

A limpeza roda no job diário e informa quantos registros removeu de cada tipo. Os prazos ficam numa tabela única no código, usada pelo job e pelos testes.

### 5.4 "Meus dados" **(decisão D3)**

- Solicitante, atendente e gestor têm a página "Meus dados", com o botão "Baixar meus dados" (o administrador também, na conta dele).
- O arquivo é um JSON legível, com: perfil (nome, e-mail, perfil, setor, datas de criação), preferências de e-mail, solicitações abertas pela pessoa (com descrição, respostas dos campos, histórico e comentários **públicos**), comentários e notas escritos pela pessoa em outras solicitações, nomes dos anexos enviados (não os arquivos), notificações recentes e permissões recebidas.
- Nunca inclui: hash de senha, notas internas escritas por outras pessoas, dados de outras pessoas além do nome de quem agiu nas solicitações dela.
- A identidade vem só da sessão; não há parâmetro de usuário. Cada exportação entra na auditoria.

### 5.5 Anonimização **(decisão D4)**

1. Só o administrador, só para usuários **desativados**, nunca para si mesmo nem para o último administrador ativo, e só se a pessoa não tiver solicitação **aberta ou em atendimento** como solicitante ou responsável.
2. A ação pede confirmação explícita e é **irreversível**.
3. Efeitos, na mesma transação:
   - nome vira "Pessoa anonimizada <código>" e e-mail vira `anonimizado-<código>@anonimizado.invalid`; o hash da senha é trocado por um valor que nunca autentica;
   - preferências, notificações e registros de envio de e-mail da pessoa são apagados; permissões concedidas a ela são revogadas (com registro no histórico de permissões);
   - nos textos que a **própria pessoa** escreveu — descrições das solicitações que abriu, respostas de campos de texto, comentários e observações de aprovação — o conteúdo é trocado por "[conteúdo removido na anonimização]";
   - anexos enviados pela pessoa são apagados do armazenamento e ficam listados como "Arquivo removido na anonimização".
4. Solicitações, histórico, datas, status e números do painel continuam existindo: só a identidade e o conteúdo escrito pela pessoa saem.
5. A anonimização entra na auditoria, sem o nome nem o e-mail antigos.

### 5.6 Autorização (complementa as SPECs anteriores)

| Operação | Quem pode |
|---|---|
| Ver a auditoria | Só o administrador |
| Baixar "Meus dados" | A própria pessoa, qualquer perfil, só os seus |
| Anonimizar | Só o administrador, nas condições de 5.5 |
| Limpeza por retenção | Só o servidor (job diário protegido por `CRON_SECRET`) |

## 6. Dados (migration somente aditiva)

- Nova tabela `AuditEntry` (`id`, `occurredAt`, `actorId`, `actorRole`, `action`, `entityType`, `entityId`, `entityLabel`, `changes` JSON), com índices por data, entidade e pessoa.
  *Esclarecido em 2026-11-02 (SF-103): `actorId` guarda o identificador da pessoa da sessão como texto, sem chave estrangeira. As pessoas nunca são apagadas (só anonimizadas), a tela busca o nome pelo identificador, e os testes de integração anteriores simulam a sessão com identificadores que não existem no banco. A migration `20261102200000_audit_actor_reference` altera só a tabela `AuditEntry`, criada pela SF-102 e ainda vazia em todos os bancos (exceção registrada à regra "só aditivas").*
- Nova coluna `User.anonymizedAt` (nula por padrão).
- Nova coluna `RequestAttachment.removedAt` (nula por padrão), para listar o anexo removido.
- Nenhuma coluna existente muda de tipo; nenhum dado existente é alterado pela migration.

## 7. Critérios de aceitação

- [ ] **CA-AUD-01** — Sem uso das novas ações, as telas e regras existentes não mudam e as suítes anteriores passam sem alteração de asserções.
- [x] **CA-AUD-02** — Cada ação da tabela 5.1 gera exatamente um registro na mesma transação; se a alteração falha, nada é registrado; uma alteração sem mudança real não gera registro. *Verificado em 2026-11-02 (SF-103): criação, alteração, reordenação, desativação e reativação de usuários, setores, categorias, serviços, documentos, campos e etapas geram um registro cada, na transação da alteração; recusas (por exemplo, categoria com serviço ativo) não registram nada; alterar sem mudar nada, mover o primeiro item para cima ou desativar o que já está inativo não geram registro (unitário e integração).*
- [x] **CA-AUD-03** — Os registros trazem pessoa, perfil, ação, entidade e campos alterados com valores; nome e e-mail de usuário aparecem só como "alterado"; senhas e hashes nunca aparecem. *Verificado em 2026-11-02 (SF-103): cada registro guarda a pessoa da sessão e o perfil dela (administrador, ou atendente com "Gerir serviços do setor"), a ação, a entidade com o nome do momento e os campos alterados com valores (SLA, aprovação, prioridade, formatos, posição); nome e e-mail de usuário aparecem só como "alterado"; senhas e hashes nunca entram, nem quando a senha é trocada (integração confere o texto completo dos registros).*
- [ ] **CA-AUD-04** — Só o administrador vê a seção "Auditoria", com filtros por período, entidade e pessoa, 50 por página, incluindo as concessões e revogações de permissões.
- [ ] **CA-AUD-05** — O job diário aplica os prazos da tabela 5.3, informa o que removeu e não apaga nada dentro do prazo.
- [ ] **CA-AUD-06** — Cada pessoa baixa só os próprios dados, no conteúdo de 5.4, sem hash de senha nem notas internas de outras pessoas; a exportação entra na auditoria.
- [ ] **CA-AUD-07** — A anonimização só é aceita nas condições de 5.5.1 e é recusada nos demais casos sem alterar nada.
- [ ] **CA-AUD-08** — Depois da anonimização, nome, e-mail, textos escritos pela pessoa, anexos, preferências e notificações não existem mais; a conta não autentica; solicitações, histórico e números do painel continuam.
- [ ] **CA-AUD-09** — A anonimização entra na auditoria sem os dados antigos.
- [x] **CA-AUD-10** — Migration aditiva; nenhuma dependência nova. *Verificado em 2026-11-02 (SF-102): migration só com criações (dois enums, uma tabela com índices e chave para o autor, duas colunas que aceitam nulo); ninguém começa anonimizado, nenhum anexo removido e nenhum registro de auditoria (`audit-schema.test.ts`); nenhuma dependência nova.*

## 8. Estratégia de testes

- **Unitários:** cálculo dos campos alterados (inclusive campos pessoais e "sem mudança"); textos das ações; prazos de retenção; montagem do arquivo de "Meus dados"; condições e efeitos da anonimização com portas em memória.
- **Integração:** registro na mesma transação de cada caso de uso administrativo (e nenhum registro quando ele falha); filtros e páginas da auditoria; limpeza por retenção perto do limite; exportação só da própria pessoa; anonimização sobre o banco, inclusive o armazenamento em memória dos anexos.
- **E2E:** o administrador altera o SLA de um serviço e vê o registro na "Auditoria"; o solicitante baixa "Meus dados"; o administrador desativa e anonimiza uma pessoa e a solicitação dela aparece com "Pessoa anonimizada" e o conteúdo removido.

## 9. Riscos

- **Anonimização por engano:** mitigação: só usuários desativados, confirmação explícita, condições de 5.5.1 e registro na auditoria.
- **Auditoria com dados pessoais:** mitigação: campos pessoais só como "alterado"; anonimização não deixa o nome antigo em lugar nenhum.
- **Retenção apagando o que importa:** mitigação: prazos em tabela única testada; solicitações e histórico nunca são apagados automaticamente.
- **Mudanças em muitos casos de uso:** mitigação: um único ponto de gravação da auditoria usado dentro das transações existentes; testes de integração por entidade.

## 10. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-102 | Migration e domínio: tabela de auditoria, colunas novas, campos alterados e textos das ações |
| SF-103 | Registro da auditoria nos casos de uso administrativos (usuários, setores, categorias, serviços, documentos, campos e etapas) |
| SF-104 | Seção "Auditoria" na administração |
| SF-105 | Retenção no job diário |
| SF-106 | "Meus dados" |
| SF-107 | Anonimização |
| SF-108 | E2E e revisão |

**Ordem:** SF-102 → SF-103 → SF-104 → SF-105 → SF-106 → SF-107 → SF-108.

## 11. Decisões tomadas (2026-11-02)

Decisões da responsável pelo projeto: **todas as propostas aceitas** (D5 junto com D1, na mesma pergunta).

| # | Questão | Decisão | Alternativas descartadas |
|---|---|---|---|
| D1 | O que a auditoria registra | Alterações administrativas da tabela 5.1, com valores (campos pessoais só "alterado") | Também logins e leituras de solicitações; só a ação, sem valores |
| D2 | Retenção | Prazos fixos da tabela 5.3, aplicados pelo job diário; solicitações sem prazo automático | Prazo também para solicitações encerradas (apagar após N anos); prazos configuráveis na tela |
| D3 | Exportação dos dados pessoais | "Meus dados" em JSON, baixado pela própria pessoa | Exportação feita pelo administrador a pedido; CSV |
| D4 | Anonimização | Identidade e conteúdo escrito pela pessoa, só para usuários desativados sem solicitações em andamento | Só a identidade (manter textos e anexos); excluir a pessoa e as solicitações dela |
| D5 | Como a auditoria é gravada | Na mesma transação da alteração, por um ponto único chamado pelos casos de uso | Pelos eventos do outbox, depois da resposta |
