# SPEC — Fluxos configuráveis por serviço

**Data:** 2026-11-01
**Status:** Aprovada em 2026-11-01, com as decisões W1 a W4 da seção 11 conforme propostas.
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-visao-geral.md` (§4 "fluxo de atendimento"; §7 Fluxo de atendimento), `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seções 5, 9 e 19), `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md` (5.3, 5.6, 5.8 e 5.9), `SPEC/2026-10-31-eventos-outbox-jobs.md`, `SPEC/2026-11-01-sla-prioridades.md`, `SPEC/2026-10-29-plano-escala-100k.md` (item 7 e garantia 7.4)

## 1. Objetivo

Permitir que cada serviço tenha um **fluxo de atendimento próprio**, formado por etapas definidas pelo administrador (por exemplo, "Triagem", "Execução", "Testes"). A equipe passa a mostrar em que ponto do atendimento a solicitação está, e o solicitante acompanha essas etapas.

## 2. Registro da mudança de escopo

A SPEC principal deixou "fluxos configuráveis por serviço e etapas adicionais" para SPECs futuras (seções 5 e 19) e definiu que não há transições além das da seção 9. O item 7 do plano de escala foi aceito em 2026-10-29, condicionado a esta SPEC. Pela garantia 7.4 do plano, **um serviço sem etapas configuradas se comporta exatamente como hoje**.

A visão geral (§7) cita etapas como triagem, aprovação, atribuição e execução. Nesta SPEC:

- **triagem, execução, testes ou outras** são etapas configuráveis;
- **atribuição** já existe (responsável, SPEC de 2026-10-31) e continua independente das etapas;
- **aprovação** é o item 8 do plano e terá SPEC própria; ela poderá usar as etapas desta SPEC, mas não faz parte dela.

## 3. Escopo

1. Cadastro de etapas por serviço pelo administrador: criar, renomear, reordenar, desativar e reativar.
2. Etapas **dentro do status "Em atendimento"** **(decisão W1)**: o status da solicitação continua o mesmo de hoje.
3. Avanço e retorno entre etapas pelo atendente **(decisão W2)**, com cópia do fluxo no início do atendimento **(decisão W3)**.
4. Etapa atual e histórico de etapas nos detalhes, na fila e em "Minhas solicitações".
5. Evento de domínio da mudança de etapa e notificação ao solicitante **(decisão W4)**.

## 4. Fora de escopo

- Aprovações e o perfil Gestor (item 8 do plano).
- Etapas com responsável, prazo ou formulário próprios.
- Fluxos com ramificações, etapas paralelas ou condições.
- Etapas antes do início do atendimento (enquanto a solicitação está "Aberta") ou depois da conclusão.
- Modelos de fluxo compartilhados entre serviços.
- Filtro da fila por etapa e relatórios por etapa (itens 11 e 13).

## 5. Regras

### 5.1 Configuração (somente `ADMIN`)

1. Só o administrador cria, renomeia, reordena, desativa e reativa etapas; a autorização é verificada no servidor.
2. Cada etapa pertence a um único serviço e tem:
   - **nome**: obrigatório, sem espaços nas pontas, até 60 caracteres, único entre as etapas **ativas** do mesmo serviço, sem distinguir maiúsculas e minúsculas;
   - **ordem** e estado **ativo/inativo**.
3. Um serviço pode ter **de 0 a 8 etapas ativas**. Com 0 etapas, o serviço não tem fluxo e funciona como hoje.
4. Etapas são desativadas, nunca apagadas. Reativar põe a etapa no fim do fluxo, dentro do limite e sem repetir o nome de outra ativa.
5. Mudar a configuração não altera solicitações já em atendimento, que seguem a cópia do fluxo feita no início **(decisão W3)**.
6. Nenhuma etapa é criada por código de produção, migration ou seed obrigatório.

### 5.2 Etapas dentro de "Em atendimento" **(decisão W1)**

1. O status da solicitação (`OPEN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`) e todas as regras que dependem dele (SLA, filtros, cancelamento, reabertura, notificações de status) **não mudam**.
2. Ao iniciar o atendimento (`OPEN` → `IN_PROGRESS`) de um serviço com etapas ativas, a solicitação **guarda a lista de nomes das etapas ativas, na ordem** (cópia) e entra na **primeira etapa**. Sem etapas ativas, nada é guardado e a solicitação fica sem etapa, como hoje.
3. A etapa só existe enquanto a solicitação está "Em atendimento". Ao concluir ou cancelar, a etapa em que estava fica registrada no histórico.

### 5.3 Avanço e retorno **(decisão W2)**

1. Quem pode mover: as mesmas pessoas que concluem a solicitação (atendente ativo do setor; com responsável, só o responsável — SPEC de atribuição, 5.3).
2. **Avançar** leva para a próxima etapa da cópia. **Voltar** leva para a etapa anterior e exige uma justificativa de 1 a 1.000 caracteres. Não é possível pular etapas.
3. **Concluir** uma solicitação com fluxo só é permitido **na última etapa**. Antes dela, a ação de concluir é recusada com mensagem fixa.
4. Cancelar continua permitido em qualquer etapa (SPEC de atribuição, 5.4).
5. Cada movimento é uma transação `Serializable` que só grava se o status, o responsável e a etapa ainda forem os lidos; caso contrário, conflito com mensagem fixa e nada é gravado. Os horários vêm do relógio do banco.

### 5.4 Reabertura

Uma solicitação concluída que é reaberta volta para "Aberta" sem etapa. Quando o atendimento for iniciado de novo, ela recebe uma **nova cópia** do fluxo vigente nesse momento e começa da primeira etapa.

### 5.5 Histórico, eventos e notificações

1. Cada entrada e mudança de etapa fica numa nova tabela `RequestStageEvent` (`requestId`, `actorId`, `fromStage` (nulo ao entrar na primeira), `toStage`, `note` (só no retorno), `occurredAt`) e aparece na linha do tempo única, com os nomes das etapas.
2. Cada mudança de etapa grava, na mesma transação, o evento `request.stage_changed` na outbox.
3. **(decisão W4)** O solicitante recebe uma notificação na aplicação a cada mudança de etapa feita pela equipe ("Sua solicitação passou para a etapa …"). A entrada na primeira etapa, que acontece junto com o início do atendimento, não gera notificação extra: o aviso de início já existe.

### 5.6 Telas

- **Área administrativa:** bloco "Etapas do atendimento" em cada serviço, no mesmo padrão dos documentos e dos campos.
- **Detalhes (atendente):** etapa atual com a posição ("Etapa 2 de 4: Execução"), botões "Avançar para …" e "Voltar para …" (com justificativa) e o botão de concluir só na última etapa.
- **Detalhes (solicitante):** etapa atual com a posição e a lista de etapas da cópia, marcando as já percorridas.
- **Fila e "Minhas solicitações":** a etapa atual aparece ao lado do status, quando existir.

### 5.7 Autorização

| Operação | Administrador | Solicitante | Atendente |
| --- | --- | --- | --- |
| Configurar etapas | Permitido | Negado | Negado |
| Avançar ou voltar etapa | Negado | Negado | Somente no setor atual, regra 5.3.1 |
| Ver etapa e histórico | Negado (como hoje) | Somente as próprias | Somente no setor atual |

## 6. Dados (migration somente aditiva)

- Nova tabela `ServiceStage`: `id`, `serviceId`, `name` (`citext`), `position`, `isActive`, `createdAt`, `updatedAt`; índice único parcial em `(serviceId, name)` entre as ativas; `CHECK` do nome (1 a 60 caracteres, sem espaços nas pontas) e da posição.
- `Request` ganha:
  - `stageNamesSnapshot` (lista de texto, vazia por padrão): a cópia do fluxo no início do atendimento;
  - `stageIndex` (inteiro opcional): a posição atual na cópia, de 0 ao tamanho da cópia menos 1;
  - `CHECK`: `stageIndex` é nulo exatamente quando a cópia está vazia e, quando existe, fica entre 0 e o tamanho da cópia menos 1. A etapa é mantida depois de concluir ou cancelar, para consulta (5.2.3); a reabertura limpa a cópia e a etapa (5.4).
- Nova tabela `RequestStageEvent` (seção 5.5.1), com índice em `requestId`.
- `OutboxEvent`: o `CHECK` de tipos passa a aceitar `request.stage_changed` (mesmo procedimento da SPEC de SLA: a restrição é recriada mais ampla, sem perda de dados).
- Solicitações e serviços existentes ficam sem etapas.
- A limpeza do banco de teste passa a apagar as tabelas novas.

## 7. Critérios de aceitação

- [ ] **CA-FLX-01** — Serviço sem etapas: iniciar, concluir, cancelar e reabrir funcionam como hoje, e todas as suítes anteriores passam sem alteração de asserções.
- [ ] **CA-FLX-02** — O administrador cria, renomeia, reordena, desativa e reativa etapas; outros perfis são negados no servidor.
- [ ] **CA-FLX-03** — A configuração recusa nome vazio, com mais de 60 caracteres ou repetido entre as ativas, e a 9ª etapa ativa (também na reativação).
- [ ] **CA-FLX-04** — Ao iniciar o atendimento, a solicitação guarda a cópia das etapas ativas e entra na primeira; mudar o fluxo depois não altera a cópia.
- [ ] **CA-FLX-05** — Avançar vai para a próxima etapa; voltar vai para a anterior e exige justificativa; não há avanço depois da última nem retorno antes da primeira.
- [ ] **CA-FLX-06** — Concluir antes da última etapa é recusado; na última, conclui normalmente (com o resultado do SLA, quando houver).
- [ ] **CA-FLX-07** — Só o atendente do setor (o responsável, se houver) move etapas; colega com responsável definido, outro setor, solicitante e administrador são recusados; movimento concorrente gera conflito sem gravar nada.
- [ ] **CA-FLX-08** — Cada mudança aparece na linha do tempo, grava `request.stage_changed` na outbox e notifica o solicitante (exceto a entrada na primeira etapa).
- [ ] **CA-FLX-09** — Reabrir e iniciar de novo cria uma nova cópia do fluxo vigente e começa da primeira etapa.
- [ ] **CA-FLX-10** — Detalhes, fila e "Minhas solicitações" mostram a etapa atual e a posição; o solicitante vê as etapas percorridas.
- [x] **CA-FLX-11** — Migration aditiva; dados existentes não mudam. *Verificado em 2026-11-01 (SF-076): migration aplicada sobre dados existentes; serviços ficam sem etapas e solicitações com cópia vazia e sem etapa (`service-stage-schema.test.ts`); suítes anteriores sem alteração de asserções.*

## 8. Estratégia de testes

- **Unitários:** validação da configuração; regras de avanço, retorno e conclusão; cópia no início; reabertura; notificação planejada.
- **Integração:** configuração no banco (limite, unicidade, reativação, `CHECK`s); início com cópia; avanço e retorno com histórico e evento; conclusão na última etapa; conflito concorrente; acesso por perfil.
- **E2E:** o administrador cria um fluxo de três etapas; o solicitante abre; o atendente inicia, avança, volta com justificativa, avança até a última e conclui; o solicitante vê as etapas e a notificação.

## 9. Riscos

- **Mais regras na conclusão:** a recusa antes da última etapa vale só para solicitações com cópia; as sem fluxo não passam por ela (CA-FLX-01).
- **Fluxo alterado no meio do atendimento:** tratado pela cópia (W3). A alternativa (seguir sempre a configuração atual) foi descartada porque etapas removidas deixariam solicitações numa etapa inexistente.
- **Base para aprovações:** a SPEC de aprovações (item 8) deverá dizer se uma aprovação vira um tipo de etapa ou um passo antes do início do atendimento; esta SPEC não antecipa essa escolha.

## 10. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-076 | Migration e domínio: configuração das etapas, cópia, avanço, retorno e regra de conclusão |
| SF-077 | Configuração pelo administrador: casos de uso, ações e editor "Etapas do atendimento" |
| SF-078 | Início com cópia, avanço, retorno e conclusão na última etapa: casos de uso, histórico, evento e concorrência |
| SF-079 | Telas (detalhes, fila, "Minhas solicitações") e notificação ao solicitante |
| SF-080 | E2E e revisão |

**Ordem:** SF-076 → SF-077 → SF-078 → SF-079 → SF-080.

## 11. Decisões tomadas (2026-11-01)

Decisões da responsável pelo projeto: **todas as propostas aceitas**.

| # | Questão | Decisão | Alternativas descartadas |
|---|---|---|---|
| W1 | Como as etapas se relacionam com o status | Etapas dentro de "Em atendimento"; o status e tudo o que depende dele não mudam | Etapas substituem o status (cada serviço define seus próprios estados), o que obriga a refazer SLA, filtros, cancelamento e reabertura |
| W2 | Movimento entre etapas | Avançar uma por vez; voltar uma por vez com justificativa; concluir só na última | Só avançar; ou pular livremente para qualquer etapa |
| W3 | Mudança do fluxo com solicitações em andamento | Cópia do fluxo no início do atendimento; mudanças valem para os próximos | Seguir sempre a configuração atual |
| W4 | Avisar o solicitante | Notificação na aplicação a cada mudança de etapa | Só mostrar a etapa nos detalhes, sem notificação |
