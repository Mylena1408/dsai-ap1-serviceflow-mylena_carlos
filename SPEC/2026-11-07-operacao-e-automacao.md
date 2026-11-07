# SPEC — Operação e automação do atendimento

**Data:** 2026-11-07
**Status:** Aprovada em 2026-11-07. A responsável escolheu cinco itens do levantamento de funcionalidades para a meta ("faça a SPEC com os itens 2, 3, 4, 6 e 7"): solicitações vinculadas e pacotes, distribuição automática na fila, solicitações recorrentes, exportação e importação da configuração, visões salvas e ações em lote. As decisões H1 a H22 da seção 9 foram adotadas como recomendadas e podem ser revistas por ela antes do início de cada parte.
**Projeto:** ServiceFlow
**Referências:**
- `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (abertura, regras de status, seção 19);
- `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md` (assumir, liberar, transferir, cancelar, reabrir);
- `SPEC/2026-10-31-busca-filtros-paginacao.md` (critérios das listas e URL);
- `SPEC/2026-11-01-sla-prioridades.md` (mudança de prioridade);
- `SPEC/2026-11-03-transferencia-entre-setores.md` (encaminhamento);
- `SPEC/2026-11-03-anexos-comentarios-documentos.md` (documento enviado depois da abertura);
- `SPEC/2026-11-06-aprofundamento-configurabilidade.md` (ausência com período, decisão G17 "o sistema" como autor, regras de escalonamento);
- `SPEC/2026-11-02-auditoria-lgpd.md` (auditoria administrativa);
- `SPEC/2026-10-29-plano-escala-100k.md` (garantia 7.4; meta de linhas).

## 1. Objetivo

O ServiceFlow cobre o ciclo de uma solicitação isolada, aberta por uma pessoa e tratada uma a uma. Organizações reais também precisam de pedidos que envolvem vários setores, de abertura periódica, de distribuição do trabalho sem depender de quem "assume" primeiro, de levar a configuração de um ambiente a outro e de tratar várias solicitações de uma vez. Esta SPEC acrescenta esses recursos em cinco partes independentes:

| Parte | O que acrescenta |
|---|---|
| A — Vínculos e pacotes | Solicitações relacionadas e duplicadas; pacotes de serviços que abrem várias solicitações de uma vez, com acompanhamento consolidado |
| B — Distribuição | Atribuição automática na entrada da fila (rodízio ou menor carga), limite por atendente e ausência de atendente |
| C — Recorrência | Solicitações abertas periodicamente pelo job, em nome de um solicitante, com histórico de execuções |
| D — Configuração portátil | Exportar a configuração em JSON e importá-la em outro ambiente, com prévia antes de aplicar |
| E — Fila em escala | Visões salvas das listas e ações em lote na fila, com resultado por item |

## 2. Registro da mudança de escopo e garantia

Nenhum destes recursos estava previsto em SPEC anterior; esta SPEC é o registro que autoriza implementá-los. Todos são genéricos: não supõem setores, serviços ou pessoas específicos.

**Garantia 7.4 do plano, para todas as partes:** quem não usa um recurso novo não percebe mudança. Solicitações sem vínculo e fora de pacote; setores com distribuição desligada (o padrão); nenhuma agenda de recorrência; nenhuma importação; usuários sem visão salva e sem usar ações em lote: todos se comportam exatamente como hoje, e as suítes anteriores passam sem alteração de asserções (exceto listas exatas que a própria SPEC amplia, como entidades da auditoria ou passos do job diário).

**Job diário:** continua uma vez por dia (`/api/cron/daily`). A recorrência e a redistribuição por ausência são contadas em **dias** do calendário da organização **(decisão H1)**.

**Autor "sistema":** as atribuições automáticas desta SPEC usam o autor nulo já adotado na decisão G17 (`actorId` nulo, "Sistema" nas telas, `actor: null` na API), com o motivo no histórico.

## 3. Parte A — Vínculos e pacotes

### 3.1 Escopo

1. **Vínculos entre solicitações:** "relacionada a" (simétrico) e "duplicada de" (a duplicada aponta para a original) **(decisão H2)**.
2. **Pacotes de serviços:** o administrador cria um pacote com 2 a 5 serviços (por exemplo, "Admissão de colaborador" com serviços de setores diferentes); o solicitante abre o pacote num formulário só, que cria uma solicitação por serviço **(decisão H3)**.
3. **Acompanhamento consolidado:** o solicitante vê o pacote com o andamento de cada solicitação; quem atende uma delas vê as outras do pacote, sem o conteúdo delas **(decisão H4)**.

### 3.2 Fora de escopo

- Dependências entre as solicitações de um pacote (uma só começar depois de outra); ordem obrigatória de atendimento.
- Mesclar solicitações (unir comentários, anexos e histórico).
- Pacotes com serviços que têm documentos exigidos ativos (decisão H5) e pacotes dentro de pacotes.
- Fechar ou cancelar automaticamente a duplicada.

### 3.3 Regras

1. **Vínculos:**
   - quem cria e remove: atendente do setor da solicitação de origem (as mesmas regras de quem altera a solicitação), e só para uma solicitação que ele também consegue ler; o administrador não opera solicitações e continua sem esse papel;
   - a outra solicitação é informada pelo código curto que as telas já mostram;
   - não se vincula uma solicitação a ela mesma; o mesmo par aparece uma vez só (o "relacionada a" vale nos dois sentidos);
   - até 10 vínculos por solicitação;
   - "duplicada de": uma solicitação é duplicada de no máximo uma; a original não pode ser, ela mesma, duplicada de outra (sem cadeias); marcar como duplicada **não muda o status** (o atendente cancela ou conclui como hoje);
   - cada criação e remoção entra no histórico da solicitação (das duas, no caso de "relacionada a"), com quem fez e quando;
   - o solicitante vê o vínculo só quando é solicitante das duas; quem atende vê o código, o serviço, o setor e o status da outra, e o link só quando pode lê-la.
2. **Pacotes (configuração):**
   - só o administrador cria, edita, desativa e reativa (o pacote cruza setores); entra na auditoria;
   - nome obrigatório, até 80 caracteres, único entre os ativos; descrição até 500; de 2 a 5 serviços distintos, em ordem;
   - os serviços precisam estar ativos e sem documentos exigidos ativos no momento da configuração (decisão H5);
   - o pacote aparece no catálogo, numa seção "Pacotes" (decisão H20), só quando todos os seus serviços estão ativos e sem documentos exigidos ativos; se algum deixar de estar, o pacote some do catálogo e a administração mostra o motivo — desativar ou mudar o serviço continua livre.
3. **Abertura de um pacote:**
   - só o solicitante, como na abertura de um serviço; o formulário tem uma descrição comum e uma seção por serviço, com os campos daquele serviço (incluindo condições e formatos);
   - **tudo ou nada:** uma transação valida todas as seções e cria todas as solicitações; uma recusa em qualquer seção não cria nenhuma, e o formulário volta com os valores (SPEC de formulários que mantêm os dados);
   - cada solicitação nasce exatamente como se fosse aberta sozinha (cópias, SLA, aprovação, distribuição da parte B, evento `request.opened`, notificações);
   - a descrição comum vai para todas; o grupo guarda o nome do pacote na hora da abertura.
4. **Acompanhamento:**
   - o grupo está "em andamento" enquanto alguma solicitação está aberta ou em atendimento (ou aguardando aprovação) e "encerrado" quando todas estão concluídas ou canceladas; o andamento mostra "N de M concluídas";
   - o solicitante abre o grupo pela lista das suas solicitações (cada item mostra "Pacote: nome") e pode **cancelar o pacote**: cancela, com a mesma justificativa, cada solicitação que ele ainda poderia cancelar sozinho; as outras ficam como estão e a tela diz quais;
   - no detalhe do atendente e do gestor, o bloco "Pacote" lista as outras solicitações do grupo com código, serviço, setor e status.

### 3.4 Dados

- Nova tabela `RequestLink` (`fromRequestId`, `toRequestId`, `kind` `RELATED` ou `DUPLICATE_OF`, `createdById`, `createdAt`), com `CHECK` contra vínculo consigo mesma e índices únicos: um par por tipo (para `RELATED`, com o menor id primeiro) e uma linha `DUPLICATE_OF` por origem.
- Nova tabela `RequestLinkEvent` (vinculou ou removeu, com o tipo, as duas solicitações, quem e quando), para o histórico.
- *Esclarecimentos registrados em 2026-11-07 (SF-175):*
  - "um par só uma vez" vale para qualquer tipo e direção: um índice único sobre (menor id, maior id); a SPEC falava em "um par por tipo", mas uma solicitação duplicada de outra já é relacionada a ela;
  - o código curto é o começo do id (8 dígitos hexadecimais); a busca usa o intervalo de ids desse começo, servido pela chave primária; um código que casa com duas solicitações é recusado como inválido;
  - quem remove: atendente do setor de qualquer uma das duas, desde que leia a outra;
  - o administrador não opera solicitações e não vincula; o gestor só lê os vínculos das solicitações que já lê.
- Nova tabela `ServiceBundle` (`name` `citext`, `description`, `serviceIds uuid[]` em ordem, `isActive`, datas), com `CHECK` do nome, da descrição e de 2 a 5 serviços sem repetição; índice único do nome entre os ativos.
- Nova tabela `RequestGroup` (`bundleId` opcional, `bundleNameSnapshot`, `requesterId`, `createdAt`) e `Request.groupId` opcional.
- Enum da auditoria ganha `SERVICE_BUNDLE`.

### 3.5 Critérios de aceitação

- [ ] **CA-VNC-01** — Solicitações sem vínculo e fora de pacote se comportam como hoje.
- [ ] **CA-VNC-02** — O atendente cria e remove "relacionada a" e "duplicada de" pelo código, com as recusas da regra 1 (si mesma, repetida, cadeia, mais de 10, sem leitura) e o histórico nas solicitações envolvidas; a duplicada não muda de status. *Parcial em 2026-11-07 (SF-175): regras e casos de uso prontos e verificados (código curto com ou sem "#", recusas de si mesma, par repetido, cadeia de duplicadas, mais de 10, código desconhecido, ambíguo ou de solicitação que o atendente não lê; histórico nas duas solicitações; status inalterado; dois vínculos simultâneos do mesmo par gravam um). Falta a tela (SF-176).*
- [ ] **CA-VNC-03** — O solicitante só vê vínculos entre solicitações dele; o atendente vê código, serviço, setor e status da outra. *Parcial em 2026-11-07 (SF-175): a leitura dos vínculos já filtra para o solicitante (só entre solicitações dele) e marca, para quem atende, se a outra pode ser aberta. Falta a tela (SF-176).*
- [ ] **CA-VNC-04** — Só o administrador configura pacotes; a configuração recusa nome vazio, longo ou repetido, menos de 2 ou mais de 5 serviços, repetição e serviço inativo ou com documento exigido; as mudanças entram na auditoria; o pacote some do catálogo quando deixa de poder ser aberto.
- [ ] **CA-VNC-05** — Abrir um pacote cria uma solicitação por serviço numa transação, cada uma igual à abertura isolada; uma recusa não cria nenhuma e devolve o formulário preenchido.
- [ ] **CA-VNC-06** — O andamento do grupo, o cancelamento do pacote (só do que o solicitante pode cancelar) e o bloco "Pacote" no detalhe funcionam como na regra 4.
- [x] **CA-VNC-07** — Migrations aditivas; nenhuma dependência nova. *Verificado em 2026-11-07 (SF-175): migration `20261107900000_request_links` só acrescenta (dois enums, duas tabelas, restrições); cada recusa do banco conferida pelo nome da restrição; nenhuma dependência nova. A SF-177 acrescentará a migration dos pacotes.*

## 4. Parte B — Distribuição automática

### 4.1 Escopo

1. Por setor, um **modo de distribuição**: desligado (padrão), rodízio ou menor carga **(decisão H6)**.
2. Por setor, um **limite** opcional de solicitações ativas por atendente.
3. **Ausência de atendente** com período, que tira a pessoa da distribuição e, se o setor quiser, passa as solicitações dela a colegas no início da ausência.
4. **Carga da equipe**: quantas solicitações ativas cada atendente tem, o limite e quem está ausente.

### 4.2 Fora de escopo

- Distribuição por habilidade, por serviço ou por fila separada dentro do setor.
- Pesos diferentes por atendente; turnos e horários de cada pessoa.
- Distribuição para gestores.

### 4.3 Regras

1. **Configuração:** só o administrador, na seção "Setores"; o limite vai de 1 a 100 ou fica vazio (sem limite); a mudança entra na auditoria do setor.
2. **Quando distribui (decisão H7):** quando uma solicitação passa a estar na fila do setor **sem responsável** e o setor tem a distribuição ligada:
   - na abertura, se não aguarda aprovação;
   - na aprovação final;
   - na chegada por encaminhamento de outro setor;
   - quando o responsável libera (sem voltar para quem liberou).

   Não distribui na reabertura (que mantém o responsável, regra 5.5 da SPEC de atribuição), nem quando a solicitação já tem responsável.
3. **Quem pode receber:** atendente ativo do setor, sem ausência no dia (fuso da organização) e abaixo do limite, contando as solicitações abertas e em atendimento de que é responsável.
4. **Escolha:**
   - rodízio: o próximo depois do último que recebeu por distribuição no setor, na ordem do nome (e do id no empate); quem não pode receber é pulado;
   - menor carga: quem tem menos solicitações ativas; no empate, a ordem do rodízio.
5. **Atribuição:** com o sistema como autor (G17), no mesmo instante e na mesma transação da operação que colocou a solicitação na fila; histórico "Distribuída automaticamente a …", evento `request.assignment_changed` e aviso de transferência. Sem ninguém que possa receber, a solicitação fica sem responsável, como hoje.
6. **Concorrência:** duas entradas ao mesmo tempo no mesmo setor não ultrapassam o limite nem pulam a vez no rodízio (a escolha trava a linha do setor).
7. **Ausência de atendente:**
   - registrada pelo administrador, pelo gestor do setor da pessoa ou pela própria pessoa; período de até 90 dias que ainda não acabou; sem sobreposição para a mesma pessoa; cancelável enquanto não termina (as regras de período da ausência de gestor, seção 4.3.5 da SPEC de configurabilidade);
   - durante a ausência, só a distribuição pula a pessoa; o responsável de etapa e as regras de escalonamento que a apontam continuam como estão (decisão H8);
   - opção do setor "Passar as solicitações de quem se ausenta": no dia em que a ausência começa, o job passa cada solicitação aberta ou em atendimento da pessoa a outro atendente escolhido pelo modo do setor; sem ninguém, a solicitação fica com a pessoa ausente; cada passagem tem histórico, evento e aviso, e acontece uma vez por ausência.
8. **Carga da equipe:** o gestor do setor e quem supervisiona a fila veem, na fila, a carga de cada atendente do setor, o limite e as ausências do dia; o administrador vê de todos os setores na seção "Setores".

### 4.4 Dados

- `Sector` ganha `distributionMode` (`NONE`, `ROUND_ROBIN`, `LEAST_LOAD`; padrão `NONE`), `maxActivePerAttendant` (opcional, `CHECK` de 1 a 100), `redistributeOnAbsence` (padrão `false`) e `lastDistributedToId` (opcional).
- Nova tabela `AttendantAbsence` (`userId`, `startsOn`, `endsOn` `DATE`, `createdById`, `createdAt`, `cancelledAt`, `redistributedAt`), com `CHECK` do período.
- `RequestAssignmentEvent` ganha `reason` (`DISTRIBUTION`, `ABSENCE`, `ESCALATION_RULE` ou nulo para as mudanças feitas por pessoas; decisão H19), com `CHECK` de que o motivo só existe com o autor nulo; as linhas existentes ficam nulas e as atribuições das regras de escalonamento (SF-174) passam a gravar `ESCALATION_RULE`.

### 4.5 Critérios de aceitação

- [ ] **CA-DST-01** — Setor com a distribuição desligada se comporta como hoje.
- [ ] **CA-DST-02** — Só o administrador configura modo, limite e passagem na ausência; valores inválidos são recusados; a mudança entra na auditoria.
- [ ] **CA-DST-03** — Abertura sem aprovação, aprovação final, encaminhamento e liberação distribuem segundo o modo, pulando quem está inativo, ausente ou no limite; reabertura e solicitação com responsável não distribuem; sem candidato, fica sem responsável.
- [ ] **CA-DST-04** — Rodízio e menor carga escolhem como na regra 4; entradas simultâneas não ultrapassam o limite nem repetem a vez.
- [ ] **CA-DST-05** — A ausência de atendente segue as regras de período; com a opção do setor, o job passa as solicitações da pessoa uma vez por ausência, com histórico, evento e aviso.
- [ ] **CA-DST-06** — A carga da equipe aparece para gestor, supervisor e administrador como na regra 8; "Análises" mostra quantas solicitações foram distribuídas automaticamente.
- [ ] **CA-DST-07** — Migrations aditivas; atribuições existentes ficam sem motivo.

## 5. Parte C — Solicitações recorrentes

### 5.1 Escopo

1. **Agenda de recorrência:** um serviço, um solicitante, a descrição e as respostas do formulário, e a frequência (semanal em dias escolhidos ou mensal num dia de 1 a 28) **(decisão H9)**.
2. **Abertura pelo job:** no dia previsto, o job abre a solicitação em nome do solicitante, com as regras da abertura normal.
3. **Histórico de execuções**, pausa e retomada.

### 5.2 Fora de escopo

- Frequências em horas, "a cada N dias" e datas avulsas; recuperar dias em que o job não rodou (decisão H10).
- Agendas com anexos ou para serviços com documentos exigidos ativos.
- Agendas criadas pelo próprio solicitante.

### 5.3 Regras

1. **Quem cria e altera (decisão H11):** o administrador, para qualquer serviço, e o gestor, para serviços do próprio setor; cada mudança entra na auditoria.
2. **Agenda:**
   - nome até 80 caracteres; o solicitante precisa ser um usuário ativo com perfil Solicitante;
   - o serviço precisa estar ativo, publicado no catálogo e sem documentos exigidos ativos;
   - a descrição e as respostas seguem exatamente as validações da abertura (incluindo condições e formatos), conferidas ao salvar;
   - semanal: de 1 a 7 dias da semana; mensal: um dia de 1 a 28; início (hoje ou depois) e fim opcional, até 2 anos depois do início;
   - até 200 agendas ativas na organização (decisão H22).
3. **Execução:**
   - o job diário, para cada agenda ativa e não pausada cujo dia previsto mais recente (fuso da organização) já chegou e ainda não teve execução, faz **uma** execução daquele dia; dias perdidos não são recuperados (decisão H10);
   - uma execução abre a solicitação com as regras da abertura normal, re-conferidas naquele momento (serviço, solicitante, respostas válidas para o formulário atual, sem documentos exigidos); a solicitação nasce como qualquer outra e marca que veio da agenda;
   - se algo não confere, a execução fica registrada como "não aberta", com o motivo (serviço indisponível, solicitante inativo, formulário mudou, documento exigido), e quem criou a agenda recebe um aviso;
   - três execuções seguidas "não abertas" pausam a agenda, com aviso;
   - **uma execução por agenda e dia**, mesmo com duas execuções do job ao mesmo tempo.
4. **Telas:**
   - administrador e gestor: lista das agendas com a próxima data, o estado e as últimas execuções; criar, editar, pausar, retomar e encerrar;
   - o solicitante vê, na solicitação, "Aberta automaticamente pela agenda …", e não altera a agenda.

### 5.4 Dados

- Nova tabela `RecurringRequest` (`name`, `serviceId`, `requesterId`, `createdById`, `description`, `answers` `jsonb`, `frequency` `WEEKLY` ou `MONTHLY`, `weekdays int[]`, `monthDay`, `startsOn`, `endsOn`, `pausedAt`, `endedAt`, `consecutiveFailures`, datas), com `CHECK` da frequência.
- Nova tabela `RecurringRequestRun` (`recurringRequestId`, `scheduledOn` `DATE`, `outcome` `OPENED` ou `SKIPPED`, `reason`, `requestId` opcional, `occurredAt`), única por (`recurringRequestId`, `scheduledOn`).
- `Request.recurringRequestId` opcional.
- Enum da auditoria ganha `RECURRING_REQUEST`; tipos de notificação ganham `recurring.skipped` e `recurring.paused` (categoria de e-mail "Prazos").

### 5.5 Critérios de aceitação

- [ ] **CA-REC-01** — Sem agendas, nada muda.
- [ ] **CA-REC-02** — Administrador e gestor (só do próprio setor) criam e alteram agendas; a configuração recusa as violações da regra 2; outros perfis são recusados; as mudanças entram na auditoria.
- [ ] **CA-REC-03** — O job abre a solicitação no dia previsto, uma vez por agenda e dia, mesmo com execuções simultâneas; a solicitação nasce como a abertura normal e mostra a agenda; dias perdidos não são recuperados.
- [ ] **CA-REC-04** — Uma execução que não confere fica registrada com o motivo e avisa quem criou; três seguidas pausam a agenda.
- [ ] **CA-REC-05** — Pausar, retomar e encerrar funcionam; agenda pausada ou encerrada não executa; o fim da agenda é respeitado.
- [ ] **CA-REC-06** — Migrations aditivas; nenhuma dependência nova.

## 6. Parte D — Configuração portátil

### 6.1 Escopo

1. **Exportar** a configuração da organização num arquivo JSON versionado.
2. **Importar** um arquivo desses em outro ambiente (por exemplo, de testes para produção), com **prévia** das mudanças antes de aplicar **(decisão H12)**.

### 6.2 Fora de escopo

- Pessoas, senhas, permissões individuais, tokens de API, webhooks e seus segredos, solicitações e qualquer dado pessoal (decisão H13).
- Apagar pela importação o que não está no arquivo; sincronização automática entre ambientes.
- Importação parcial escolhida item a item.

### 6.3 Regras

1. **Quem:** só o administrador; exportar e importar entram na auditoria.
2. **Conteúdo exportado:** setores (com escalonamento, regras de escalonamento e distribuição), categorias, serviços (com campos, condições, documentos exigidos, etapas, aprovação, prazos), artigos da base de conhecimento, respostas prontas, papéis de acesso, calendário e feriados, pacotes; itens ativos e inativos. Referências a pessoas (responsável de etapa, pessoas das regras de escalonamento) vão pelo e-mail; referências entre itens vão pelo nome (setor, categoria, serviço) e pelo rótulo ou nome dentro do serviço (campo, etapa) **(decisão H14)**.
3. **Formato:** `{"format": "serviceflow-config", "version": 1, "exportedAt": …, "data": {…}}`; até 2 MB; o arquivo não leva identificadores internos.
4. **Prévia da importação:**
   - o arquivo é validado inteiro com as mesmas regras de cada tela de configuração (nomes, limites, condições, níveis, regras); qualquer erro recusa o arquivo, com a lista dos problemas (até 50) e o caminho de cada um;
   - cada item é casado pela chave natural com o que existe e classificado como "novo", "alterado" (com os campos que mudam) ou "igual";
   - pessoas citadas por e-mail que não existem no destino, ou que não podem ocupar o papel (por exemplo, responsável de etapa que não é atendente do setor), são listadas como avisos; o item entra sem aquela pessoa;
   - mudanças que as telas não permitem (por exemplo, trocar o tipo de um campo que já tem respostas) recusam o arquivo.
5. **Aplicação:**
   - só depois da prévia, confirmando o mesmo arquivo (conferido pelo resumo criptográfico) e com a configuração do destino igual à da prévia; se algo mudou entre a prévia e a aplicação, a aplicação é recusada e pede nova prévia;
   - **tudo ou nada**, numa transação; nada é apagado; o que não está no arquivo fica como está;
   - cada item criado ou alterado entra na auditoria como se fosse feito pela tela, e a importação inteira tem um registro próprio com o resumo (quantos novos, alterados e iguais).
6. **Exportar e importar de volta** o mesmo arquivo no mesmo ambiente resulta em "igual" para todos os itens.

### 6.4 Dados

- Sem tabelas novas de configuração. Enum da auditoria ganha `CONFIGURATION`, e a ação ganha `IMPORTED` e `EXPORTED_CONFIGURATION` **(decisão H15)**.

### 6.5 Critérios de aceitação

- [ ] **CA-CFG-01** — Só o administrador exporta e importa; as duas ações entram na auditoria.
- [ ] **CA-CFG-02** — O arquivo exportado segue o formato e o conteúdo da regra 2, sem dados pessoais, segredos ou identificadores internos.
- [ ] **CA-CFG-03** — A prévia recusa arquivo inválido com a lista de problemas, classifica cada item e avisa sobre pessoas não encontradas.
- [ ] **CA-CFG-04** — A aplicação é tudo ou nada, não apaga nada, audita cada item e recusa quando o destino mudou depois da prévia.
- [ ] **CA-CFG-05** — Exportar de um ambiente e importar num banco vazio reproduz a configuração; reimportar o mesmo arquivo dá "igual" em tudo.

## 7. Parte E — Fila em escala

### 7.1 Escopo

1. **Visões salvas:** cada pessoa salva os critérios de busca de uma lista com um nome e volta a eles com um clique **(decisão H16)**.
2. **Ações em lote na fila:** o atendente marca várias solicitações da página e aplica uma ação a todas: assumir, transferir a um colega, mudar a prioridade ou encaminhar a outro setor **(decisão H17)**.

### 7.2 Fora de escopo

- Visões compartilhadas entre pessoas; visão padrão aberta automaticamente.
- Lote para concluir, cancelar ou comentar; lote em mais de uma página; lote pela API.

### 7.3 Regras

1. **Visões salvas:**
   - nas listas com busca: fila do atendente e "Minhas solicitações" do solicitante;
   - nome de 1 a 40 caracteres, único por pessoa e lista; até 20 por pessoa e lista;
   - guardam os critérios já normalizados (os mesmos da URL); critérios inválidos na hora de abrir seguem as regras atuais da busca;
   - só a própria pessoa vê, renomeia e apaga as suas.
2. **Ações em lote:**
   - até 50 solicitações, todas da página atual;
   - **cada item é tratado sozinho**, com exatamente as regras, o histórico, os eventos e os avisos da ação individual, na sua própria transação **(decisão H18)**; um item recusado não desfaz os outros;
   - transferir e encaminhar pedem os mesmos dados da ação individual (colega, setor, justificativa), iguais para todos os itens;
   - o resultado mostra, por item, "feito" ou "recusado" com o motivo em texto fixo (por exemplo, "já tem responsável", "sem permissão", "mudou enquanto você agia").

### 7.4 Dados

- Nova tabela `SavedView` (`userId`, `list` `QUEUE` ou `MY_REQUESTS`, `name` `citext`, `criteria` `text`, `createdAt`, `updatedAt`), única por (`userId`, `list`, `name`), com `CHECK` do nome e do tamanho dos critérios (até 1.000 caracteres).
- As ações em lote não têm tabela própria: cada item grava o que a ação individual grava.

### 7.5 Critérios de aceitação

- [ ] **CA-LOT-01** — Quem não salva visões nem usa o lote não vê mudança além dos controles novos.
- [ ] **CA-LOT-02** — Salvar, abrir, renomear e apagar visões nas duas listas, com os limites da regra 1; uma pessoa nunca vê as visões de outra.
- [ ] **CA-LOT-03** — As quatro ações em lote aplicam a cada item as regras da ação individual, cada um na sua transação, e mostram o resultado por item; um item recusado não afeta os outros; mais de 50 é recusado.
- [ ] **CA-LOT-04** — O histórico, os eventos e os avisos de cada item são os mesmos da ação individual.
- [ ] **CA-LOT-05** — Migration aditiva; nenhuma dependência nova.

## 8. Testes

Cada parte segue o padrão das SPECs anteriores, em três camadas:
- **Unitários:** validações de configuração; regras de vínculo; montagem e validação do formulário de pacote; escolha do rodízio e da menor carga; datas da recorrência; formato, validação, casamento e diferenças da configuração; critérios das visões e resultado por item do lote.
- **Integração (banco real):** schema e `CHECK`s; casos de uso com perfis e setores; transação "tudo ou nada" do pacote e da importação; concorrência na distribuição, na recorrência e no lote; job diário (recorrência e passagem na ausência); auditoria.
- **E2E:** um percurso por parte, pela tela (vínculo e pacote aberto e acompanhado; distribuição em rodízio com limite e ausência; agenda executada pela rota protegida do job; exportar e importar com prévia; visão salva e lote com um item recusado).
- **Volume:** distribuição e carga da equipe medidas no banco `serviceflow_perf`.

## 9. Decisões tomadas (2026-11-07)

Adotadas como recomendadas; a responsável pode revê-las antes do início de cada parte.

| # | Questão | Decisão | Alternativa descartada |
|---|---|---|---|
| H1 | Unidade dos agendamentos | Dias, no job diário | Horas (o job roda uma vez por dia) |
| H2 | Tipos de vínculo | "Relacionada a" e "duplicada de" | Tipos definidos pelo administrador |
| H3 | Pacote | Abre uma solicitação por serviço | Uma solicitação com várias tarefas internas (exigiria remodelar o atendimento) |
| H4 | Visibilidade entre setores no pacote | Código, serviço, setor e status | Conteúdo completo (vazaria dados de outros setores) |
| H5 | Documentos no pacote | Só serviços sem documentos exigidos ativos; o documento pode ser enviado depois | Upload de vários grupos de arquivos numa abertura |
| H6 | Modos de distribuição | Rodízio e menor carga | Por habilidade ou por serviço |
| H7 | Momentos da distribuição | Entrada na fila sem responsável (abertura, aprovação, encaminhamento, liberação) | Job periódico que distribui o que sobrou |
| H8 | Ausência de atendente e regras existentes | Só a distribuição pula o ausente | Também as regras de etapa e de escalonamento (mudaria o comportamento já entregue) |
| H9 | Frequências | Semanal (dias) e mensal (dia 1 a 28) | Expressão de calendário livre |
| H10 | Dias perdidos | Não são recuperados | Abrir uma solicitação por dia perdido |
| H11 | Quem agenda | Administrador e gestor do setor do serviço | Também o próprio solicitante |
| H12 | Importação | Prévia obrigatória e aplicação tudo ou nada | Aplicar direto, item a item |
| H13 | Pessoas no arquivo | Só e-mails como referência, sem cadastro | Exportar usuários |
| H14 | Chaves de casamento | Nomes e rótulos | Identificadores internos (não existem no outro ambiente) |
| H15 | Auditoria da importação | Cada item mais um registro do conjunto | Só o registro do conjunto |
| H16 | Visões | Pessoais | Compartilhadas por setor |
| H17 | Ações em lote | Assumir, transferir, prioridade e encaminhar | Também concluir e cancelar (exigem nota por item) |
| H18 | Atomicidade do lote | Cada item sozinho, resultado por item | Tudo ou nada (um item mudado por outra pessoa bloquearia todos) |
| H19 | Motivo da atribuição automática | Coluna `reason` no histórico | Texto livre |
| H20 | Onde o pacote aparece | Seção "Pacotes" do catálogo | Misturado aos serviços |
| H21 | Ordem das partes | A → B → C → D → E | Por tamanho |
| H22 | Limite de agendas | 200 ativas na organização | Sem limite |

## 10. Tarefas

| Tarefa | Parte | Conteúdo |
|---|---|---|
| SF-175 | A | Migrations e domínio dos vínculos; casos de uso com histórico |
| SF-176 | A | Vínculos nas telas do atendente e do solicitante, API e E2E parcial |
| SF-177 | A | Pacotes: migrations, domínio, configuração e auditoria |
| SF-178 | A | Abertura do pacote: formulário, transação tudo ou nada, catálogo |
| SF-179 | A | Acompanhamento do grupo, cancelamento do pacote, bloco "Pacote", API e E2E |
| SF-180 | B | Migrations e domínio da distribuição, do limite e da ausência de atendente |
| SF-181 | B | Distribuição na entrada da fila (abertura, aprovação, encaminhamento, liberação) e concorrência |
| SF-182 | B | Ausência de atendente: cadastro, passagem pelo job, avisos |
| SF-183 | B | Configuração nas telas, carga da equipe, análises, medição e E2E |
| SF-184 | C | Migrations e domínio das agendas e das datas |
| SF-185 | C | Casos de uso e telas das agendas (administrador e gestor), auditoria |
| SF-186 | C | Execução pelo job: abertura, recusas, avisos, pausa automática, concorrência e E2E |
| SF-187 | D | Formato e exportação |
| SF-188 | D | Validação e prévia da importação |
| SF-189 | D | Aplicação da importação, auditoria e conferência da ida e volta |
| SF-190 | D | Telas, avisos de pessoas e E2E |
| SF-191 | E | Visões salvas: dados, domínio e telas |
| SF-192 | E | Ações em lote: domínio e casos de uso com resultado por item |
| SF-193 | E | Telas do lote, concorrência e E2E |

**Ordem:** A → B → C → D → E (decisão H21). A distribuição (B) entra antes da recorrência (C), para que as solicitações abertas pelas agendas já passem por ela (as dos pacotes passam a ser distribuídas quando B for entregue); a configuração portátil (D) vem depois de A e B, para exportar também pacotes e distribuição (as agendas citam pessoas e solicitantes, por isso não são exportadas). Cada parte termina com todas as suítes aprovadas e com registro em `NOTES.md` das linhas novas (aplicação e testes, separadas).

**Estimativa:** de 16.000 a 21.000 linhas de código pelo `cloc` (19 tarefas, pela média de cerca de 840 linhas por tarefa medida nas SF-167 a SF-174, com as de banco e transação maiores). Com a contagem de 60.870 linhas em 2026-11-07, a SPEC leva o projeto a algo entre 77.000 e 82.000; a meta de 100.000 exigirá outra SPEC depois desta.
