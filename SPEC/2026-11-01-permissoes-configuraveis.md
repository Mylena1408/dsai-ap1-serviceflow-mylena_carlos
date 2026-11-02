# SPEC — Permissões configuráveis

**Data:** 2026-11-01
**Status:** Aprovada em 2026-11-01, com as decisões K1 a K4 da seção 11 conforme propostas. **Concluída em 2026-11-01** (SF-087 a SF-091; CA-PER-01 a 10 verificados).
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-visao-geral.md` (§3.4 "permissões"; §12 Permissões), `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seção 10), `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md` (5.2 e 5.7), `SPEC/2026-11-01-aprovacoes.md` (decisão A4), `SPEC/2026-10-29-plano-escala-100k.md` (item 9 e garantia 7.4), `SPEC/2026-11-01-relatorio-fase-3.md`

## 1. Objetivo

Hoje cada perfil tem um conjunto fixo de ações. Esta SPEC permite que o administrador **conceda permissões adicionais** a atendentes e gestores, sempre **limitadas ao setor da pessoa**, para que a operação do dia a dia não dependa só do administrador:

- cuidar dos serviços do próprio setor;
- acompanhar todas as solicitações do setor;
- supervisionar a fila do setor.

## 2. Registro da mudança de escopo

A visão geral (§12) pede que o acesso considere "o perfil do usuário e suas permissões", e o plano de escala (item 9) previu papéis e permissões por escopo. A SPEC principal (seção 10) e as SPECs seguintes definiram regras fixas por perfil. Pela garantia 7.4 do plano, **sem nenhuma permissão concedida, o sistema se comporta exatamente como hoje**: os quatro perfis e suas regras não mudam.

## 3. Escopo

1. Catálogo fixo de permissões, definido no código **(decisão K2)**.
2. Concessão e revogação de permissões a usuários individuais pelo administrador **(decisão K1)**, sempre valendo para o setor do usuário **(decisão K3)**.
3. Histórico de concessões e revogações **(decisão K4)**.
4. Efeito de cada permissão nas telas e nas regras do servidor.

## 4. Fora de escopo

- Papéis criados pelo administrador e atribuição de papéis (decisão K1).
- Permissões para solicitantes ou administradores; permissões sobre setores, categorias ou usuários.
- Permissões que valham para outros setores além do próprio (decisão K3).
- Permissões temporárias, com validade ou aprovação.
- Mudar as regras dos quatro perfis.

## 5. Regras

### 5.1 Catálogo de permissões **(decisão K2)**

| Código | Nome na tela | Quem pode receber | O que libera |
|---|---|---|---|
| `SECTOR_SERVICES` | Gerir serviços do setor | Atendente ou gestor | Criar e editar serviços **do próprio setor** (dados, prazo, prioridade, aprovação, ativar e desativar) e configurar seus documentos exigidos, campos e etapas |
| `SECTOR_REQUESTS_READ` | Ver todas as solicitações do setor | Gestor | Listar e abrir, só para leitura, todas as solicitações do setor, e não só as que exigem aprovação |
| `QUEUE_SUPERVISION` | Supervisionar a fila do setor | Atendente | Liberar ou transferir uma solicitação do setor que está com outro atendente |

### 5.2 Concessão

1. Só o administrador concede e revoga, na tela de usuários. A autorização é verificada no servidor.
2. Uma permissão só pode ser concedida a um usuário **ativo** de um perfil que pode recebê-la (tabela 5.1). Conceder a mesma permissão duas vezes não tem efeito.
3. A permissão vale **para o setor atual do usuário** **(decisão K3)**. Se o usuário mudar de setor, ela passa a valer no setor novo; se mudar para um perfil que não pode recebê-la, ou for desativado, ela deixa de ter efeito (fica registrada, mas não é usada). O administrador vê essas permissões sem efeito marcadas na tela.
4. Toda verificação recarrega as permissões do banco a cada operação: a revogação vale imediatamente, sem precisar sair e entrar de novo.

### 5.3 Efeitos

1. **`SECTOR_SERVICES`:** a pessoa ganha a página "Serviços do setor" na sua área, com os mesmos formulários da administração, limitados aos serviços do seu setor. Ela não muda o setor de um serviço (o setor é sempre o dela), não cria setores, categorias ou usuários e não vê serviços de outros setores. As regras de cada configuração (limites, desativação, cópias nas solicitações) são as mesmas da administração.
2. **`SECTOR_REQUESTS_READ`:** a área "Aprovações" do gestor ganha a aba "Todas do setor", com a lista e o detalhe só de leitura de todas as solicitações do setor. As ações de aprovação continuam valendo só para as que exigem aprovação.
3. **`QUEUE_SUPERVISION`:** além do responsável, quem tem a permissão pode **liberar** ou **transferir** uma solicitação do setor que está com outra pessoa, com a mesma regra de destino da transferência (atendente ativo do setor). Iniciar, concluir e mover etapas continuam sendo só do responsável.

### 5.4 Histórico **(decisão K4)**

Cada concessão e revogação fica numa tabela `UserPermissionEvent` (usuário, permissão, concedida ou revogada, quem fez, quando) e aparece na tela do usuário, na administração. As ações liberadas pelas permissões ficam no histórico normal das solicitações (por exemplo, a transferência por supervisão aparece como uma transferência feita por quem supervisionou).

### 5.5 Autorização (complementa as SPECs anteriores)

| Operação | Sem a permissão | Com a permissão |
|---|---|---|
| Configurar serviços do setor | Só administrador | Também atendente ou gestor com `SECTOR_SERVICES`, só no próprio setor |
| Ler todas as solicitações do setor | Gestor: só as que exigem aprovação | Gestor com `SECTOR_REQUESTS_READ`: todas, só leitura |
| Liberar ou transferir solicitação de outro | Só o responsável | Também atendente com `QUEUE_SUPERVISION` do setor |
| Conceder e revogar permissões | Só administrador | Só administrador |

## 6. Dados (migration somente aditiva)

- Novo enum `Permission` (`SECTOR_SERVICES`, `SECTOR_REQUESTS_READ`, `QUEUE_SUPERVISION`).
- Nova tabela `UserPermission` (`userId`, `permission`, `grantedById`, `grantedAt`), única em (`userId`, `permission`).
- Nova tabela `UserPermissionEvent` (`userId`, `permission`, `action` concedida ou revogada, `actorId`, `occurredAt`).
- Nenhuma tabela existente muda; ninguém começa com permissões.

## 7. Critérios de aceitação

- [x] **CA-PER-01** — Sem permissões concedidas, todas as regras atuais valem, e as suítes anteriores passam sem alteração de asserções. *Verificado em 2026-11-01 (SF-089): sem permissões concedidas, só o administrador configura o catálogo (atendente sem a permissão recebe recusa) e as suítes anteriores passam; as únicas mudanças em testes existentes foram de configuração (mocks de autorização e dublês), sem alteração de asserções.*
- [x] **CA-PER-02** — Só o administrador concede e revoga; a concessão respeita os perfis da tabela 5.1 e só vale para usuários ativos; repetir não duplica. *Verificado em 2026-11-01 (SF-088): só o administrador vê, concede e revoga (atendente, gestor e solicitante recebem recusa); perfis fora da tabela 5.1, permissão desconhecida, usuário inexistente e usuário inativo são recusados sem gravar nada; conceder de novo não duplica nem gera histórico (unitário das ações e integração).*
- [x] **CA-PER-03** — Concessões e revogações ficam no histórico do usuário, com quem fez e quando. *Verificado em 2026-11-01 (SF-088): cada concessão e revogação efetiva fica no histórico com a permissão, a ação, quem fez e quando, e aparece na tela do usuário (integração e navegador).*
- [x] **CA-PER-04** — A revogação vale na operação seguinte, sem novo login; mudança de setor ou de perfil é respeitada. *Verificado em 2026-11-01 (SF-087 e SF-088): a permissão segue o setor atual da pessoa (muda junto com ele) e deixa de valer ao mudar para um perfil que não pode recebê-la, continuando registrada "sem efeito"; as regras releem o usuário a cada verificação (unitário e integração). O uso nas operações, sem novo login, é conferido nas SF-089 e SF-090.*
- [x] **CA-PER-05** — Com `SECTOR_SERVICES`, a pessoa cria e edita serviços do próprio setor e configura documentos, campos e etapas deles; serviços de outros setores e a troca de setor são recusados. *Verificado em 2026-11-01 (SF-089): atendente e gestor com a permissão criam e editam serviços do próprio setor (dados, prazo, aprovação, ativação) e configuram documentos, campos e etapas deles; criar em outro setor, mover um serviço para outro setor e mexer em serviço, campo ou etapa de outro setor (inclusive pelo identificador) são recusados como "não encontrado"; as listas mostram só o setor da pessoa (integração e navegador).*
- [x] **CA-PER-06** — Com `SECTOR_REQUESTS_READ`, o gestor lista e abre todas as solicitações do setor só para leitura; sem a permissão, continua vendo só as que exigem aprovação. *Verificado em 2026-11-01 (SF-090): sem a permissão, o gestor recebe recusa na aba "Todas do setor" e "não encontrado" em solicitações sem aprovação; com ela, lista e abre todas as solicitações do setor, com respostas e documentos, sem poder decidir as que não exigem aprovação; após a revogação, volta a não encontrar (integração e navegador).*
- [x] **CA-PER-07** — Com `QUEUE_SUPERVISION`, o atendente libera e transfere solicitação do setor que está com colega; sem a permissão, continua recusado; iniciar, concluir e mover etapas seguem só do responsável. *Verificado em 2026-11-01 (SF-090): com a permissão, o atendente libera e transfere solicitação de colega (nunca para o responsável atual nem para si); sem ela ou depois da revogação, conflito; assumir uma solicitação com responsável continua recusado; iniciar, concluir e mover etapas seguem só do responsável (regras existentes inalteradas) (unitário e integração).*
- [x] **CA-PER-08** — As ações feitas por permissão aparecem no histórico normal da solicitação e geram os eventos e notificações já existentes. *Verificado em 2026-11-01 (SF-090): a liberação e a transferência por supervisão entram no histórico com quem as fez ("Liberada por … (estava com …)"), gravam `request.assignment_changed` e a transferência notifica o novo responsável, como antes (unitário, integração e navegador).*
- [x] **CA-PER-09** — Telas: a administração mostra e altera as permissões de cada usuário (com as sem efeito marcadas); as áreas mostram as páginas liberadas só para quem tem a permissão. *Parcial em 2026-11-01 (SF-088): a administração mostra e altera as permissões de cada usuário, com as sem efeito marcadas (navegador). Faltam as páginas liberadas nas áreas de atendente e gestor (SF-089 e SF-090).* *Parcial em 2026-11-01 (SF-088 e SF-089): administração com as permissões de cada usuário (SF-088); link e página "Serviços do setor" só para quem tem a permissão, somem na hora após a revogação (navegador). Faltam as telas da SF-090.* *Verificado em 2026-11-01 (SF-088 a SF-090): administração com as permissões de cada usuário; página "Serviços do setor", aba "Todas do setor" e ações de supervisão só aparecem para quem tem a permissão (navegador).*
- [x] **CA-PER-10** — Migration aditiva; dados existentes não mudam. *Verificado em 2026-11-01 (SF-087): migration só aditiva aplicada sobre dados existentes; ninguém começa com permissões; uma concessão por usuário e permissão (`permission-schema.test.ts`); suítes anteriores sem alteração de asserções.*

## 8. Estratégia de testes

- **Unitários:** regra de quem pode receber cada permissão; verificação com setor e perfil atuais; efeitos em cada caso de uso.
- **Integração:** concessão, revogação e histórico; configuração de serviços do setor por atendente e gestor; leitura ampliada do gestor; supervisão da fila; recusas fora do setor.
- **E2E:** o administrador concede "Gerir serviços do setor" a um atendente, que cria um serviço com um campo; concede "Supervisionar a fila" e o atendente transfere a solicitação de um colega; a revogação some com a página na hora.

## 9. Riscos

- **Mais caminhos para configurar o catálogo:** mitigação: os mesmos casos de uso e regras da administração, com o setor sempre vindo do usuário, nunca do formulário.
- **Permissões esquecidas depois de mudanças no usuário:** mitigação: a regra 5.2.3 e a marcação "sem efeito" na tela do administrador.
- **Confusão entre perfil e permissão:** mitigação: as permissões só acrescentam ações dentro do setor; nenhuma remove regra de perfil.

## 10. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-087 | Migration e domínio: catálogo de permissões, quem pode receber, verificação com setor e perfil atuais |
| SF-088 | Concessão e revogação pelo administrador, com histórico e tela |
| SF-089 | "Serviços do setor" para quem tem `SECTOR_SERVICES` (casos de uso de serviços, documentos, campos e etapas aceitando a permissão) |
| SF-090 | Leitura ampliada do gestor (`SECTOR_REQUESTS_READ`) e supervisão da fila (`QUEUE_SUPERVISION`) |
| SF-091 | E2E e revisão |

**Ordem:** SF-087 → SF-088 → SF-089 → SF-090 → SF-091.

## 11. Decisões tomadas (2026-11-01)

Decisões da responsável pelo projeto: **todas as propostas aceitas**.

| # | Questão | Decisão | Alternativas descartadas |
|---|---|---|---|
| K1 | Como as permissões chegam às pessoas | Concedidas individualmente a cada usuário pelo administrador | Papéis criados pelo administrador, com um conjunto de permissões, atribuídos aos usuários |
| K2 | Quais permissões existem | As três da tabela 5.1 | Só "Gerir serviços do setor"; ou acrescentar outras (por exemplo, relatórios, quando existirem) |
| K3 | Onde a permissão vale | Sempre no setor atual do usuário | O administrador escolhe um ou mais setores para cada concessão |
| K4 | Registro das concessões | Histórico de concessões e revogações, visível na administração | Só o estado atual, sem histórico |
