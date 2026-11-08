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
- `Request.groupPosition` (1 a 5, só com grupo, uma por posição no grupo), acrescentada na SF-179: as solicitações de um pacote nascem no mesmo instante da transação, e sem a posição a ordem do pacote se perderia.
- *Esclarecimentos registrados em 2026-11-07 (SF-177):*
  - "documentos exigidos ativos" (decisão H5) vale para qualquer documento ativo do serviço, obrigatório ou opcional: a abertura do pacote não recebe arquivos, e o documento pode ser enviado depois da abertura;
  - "serviço ativo" inclui a categoria e o setor ativos, como na abertura de um serviço;
  - a reativação de um pacote só confere o nome livre entre os ativos; os serviços ficam como estiverem, e o pacote só aparece no catálogo enquanto todos puderem ser abertos;
  - a migration desta tarefa já cria `RequestGroup` e `Request.groupId`, usados pela abertura (SF-178).
- *Esclarecimentos registrados em 2026-11-07 (SF-179):*
  - a ordem das solicitações do grupo vem de `groupPosition`, gravada na abertura; a migration preenche a posição de grupos já existentes pela ordem de criação antes de criar a restrição;
  - cancelar o pacote não é "tudo ou nada": cada solicitação aberta é cancelada na sua própria transação, pela regra do cancelamento isolado; uma que mudou no meio (por exemplo, começou a ser atendida) fica como está e entra na conta das mantidas;
  - na página do solicitante, a solicitação de um pacote mostra "Parte do pacote …" com o andamento; o bloco com as outras solicitações é do atendente e do gestor.

### 3.5 Critérios de aceitação

- [x] **CA-VNC-01** — Solicitações sem vínculo e fora de pacote se comportam como hoje. *Verificado em 2026-11-07 (SF-176): sem vínculos, o bloco "Vínculos" não aparece para o solicitante nem para o gestor, a linha do tempo é a mesma de antes e a API traz `links: []`; para o atendente, o bloco mostra só o formulário (unitário, integração e as suítes anteriores sem mudança).*
- [x] **CA-VNC-02** — O atendente cria e remove "relacionada a" e "duplicada de" pelo código, com as recusas da regra 1 (si mesma, repetida, cadeia, mais de 10, sem leitura) e o histórico nas solicitações envolvidas; a duplicada não muda de status. *Verificado em 2026-11-07 (SF-175 e SF-176): pela tela, o atendente vincula pelo código (com ou sem "#", maiúsculas ou minúsculas), como "relacionada a" ou "esta é duplicada de", e remove pelo botão "Remover"; as recusas têm mensagens fixas; a linha do tempo das duas solicitações mostra "Vinculada como …" e "Vínculo removido: …"; o status não muda (integração, unitário e E2E `request-links.spec.ts`).*
- [x] **CA-VNC-03** — O solicitante só vê vínculos entre solicitações dele; o atendente vê código, serviço, setor e status da outra. *Verificado em 2026-11-07 (SF-175 e SF-176): o solicitante vê, só para leitura, os vínculos entre solicitações dele; quem atende vê código, serviço, setor e status da outra, com link apenas quando pode lê-la; o gestor vê só para leitura; a API traz `links` com a mesma filtragem e `accessible` (integração da API, unitário e E2E).*
- [x] **CA-VNC-04** — Só o administrador configura pacotes; a configuração recusa nome vazio, longo ou repetido, menos de 2 ou mais de 5 serviços, repetição e serviço inativo ou com documento exigido; as mudanças entram na auditoria; o pacote some do catálogo quando deixa de poder ser aberto. *Verificado em 2026-11-07 (SF-177 e SF-178): só o administrador cria, edita, desativa e reativa pacotes na seção "Pacotes"; a configuração recusa nome vazio, longo ou repetido entre os ativos (também na reativação), menos de 2 ou mais de 5 serviços, repetição e serviço inativo, de categoria ou setor inativo ou com documento ativo (obrigatório ou opcional); as mudanças entram na auditoria; o catálogo do solicitante mostra a seção "Pacotes" só com pacotes que podem ser abertos, e um pacote que deixa de poder é "não encontrado" (integração, unitário e E2E `service-bundles.spec.ts`).*
- [x] **CA-VNC-05** — Abrir um pacote cria uma solicitação por serviço numa transação, cada uma igual à abertura isolada; uma recusa não cria nenhuma e devolve o formulário preenchido. *Verificado em 2026-11-07 (SF-178): abrir um pacote cria o grupo e uma solicitação por serviço, na ordem do pacote, numa transação; cada uma nasce como a abertura isolada (cópias, aprovação, SLA, respostas do próprio serviço, histórico e `request.opened`); respostas inválidas em qualquer seção não criam nada e voltam com os erros de todas as seções juntos; resposta a campo que nenhum serviço tem é tratada como formulário desatualizado; serviço que passou a pedir documento, serviço ou pacote indisponível e quem não é solicitante são recusados; o formulário mantém o que foi digitado (integração, unitário e E2E).*
- [x] **CA-VNC-06** — O andamento do grupo, o cancelamento do pacote (só do que o solicitante pode cancelar) e o bloco "Pacote" no detalhe funcionam como na regra 4. *Verificado em 2026-11-07 (SF-179): o grupo mostra "Em andamento" ou "Encerrado" e "N de M concluídas" (com as canceladas à parte), na ordem do pacote; a lista do solicitante marca "Pacote: nome" com link para o grupo; cancelar o pacote cancela, com a mesma justificativa e pela mesma regra do cancelamento isolado, cada solicitação ainda aberta, uma transação por solicitação, e mantém as outras, dizendo quantas; o bloco "Pacote" do atendente e do gestor lista as outras solicitações com código, serviço, setor e status, com link só para as que podem ler; a API traz `group` no detalhe (null fora de pacote) (integração, unitário e E2E `request-groups.spec.ts`).*
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

- *Esclarecimentos registrados em 2026-11-07 (SF-180):*
  - o rodízio segue a ordem dos nomes (e do id no empate) de todos os atendentes do setor, disponíveis ou não, a partir de quem recebeu por último; se essa pessoa saiu do setor, a vez recomeça do primeiro nome;
  - a ausência de atendente usa as mesmas regras de período da ausência de gestor (até 90 dias, ainda não encerrada, sem sobreposição) e é registrada pelo administrador, pelo gestor do setor da pessoa ou pela própria pessoa;
  - o motivo da atribuição feita pelo sistema (`reason`) é obrigatório quando não há autor, e só então; as atribuições das regras de escalonamento passaram a gravá-lo.
- *Esclarecimentos registrados em 2026-11-07 (SF-181):*
  - na liberação por um supervisor, a distribuição pula tanto quem liberou quanto quem tinha a solicitação;
  - a distribuição roda na mesma transação da operação que pôs a solicitação na fila, logo depois dos registros dela; a linha do setor fica travada até o fim da transação;
  - o histórico e a API dizem por que o sistema atribuiu: "Distribuída automaticamente a …" e `reason: DISTRIBUTION`.
- *Esclarecimentos registrados em 2026-11-07 (SF-182):*
  - a passagem só acontece em setores com a distribuição ligada (rodízio ou menor carga), porque o colega é escolhido pelo modo do setor;
  - a ausência é marcada como "passada" antes de passar as solicitações, para duas execuções do job ao mesmo tempo não passarem duas vezes; cada solicitação vai na sua própria transação;
  - solicitações que a pessoa recebe depois do primeiro dia da ausência (por exemplo, encaminhadas a ela por um colega) não são passadas de novo.
- *Esclarecimentos registrados em 2026-11-07 (SF-183):*
  - na fila e no painel do gestor, a carga só aparece para setores com a distribuição ligada (garantia 7.4); a administração vê a de todos os setores, ao lado da configuração;
  - o gestor vê a carga no "Painel do setor", porque não tem acesso à fila;
  - "Distribuídas automaticamente" conta as atribuições feitas pelo sistema na entrada da fila e na ausência do responsável.

### 4.5 Critérios de aceitação

- [x] **CA-DST-01** — Setor com a distribuição desligada se comporta como hoje. *Verificado em 2026-11-07 (SF-181): com a distribuição desligada, a abertura, a aprovação, o encaminhamento e a liberação ficam como antes, sem atribuição nem histórico novos; as suítes anteriores passaram sem mudança (integração `queue-distribution.test.ts`).*
- [x] **CA-DST-02** — Só o administrador configura modo, limite e passagem na ausência; valores inválidos são recusados; a mudança entra na auditoria. *Verificado em 2026-11-07 (SF-180 e SF-183): só o administrador configura, no bloco "Distribuição automática" da seção "Setores" (modo, limite de 1 a 100 ou vazio, passagem na ausência); valores inválidos têm mensagem fixa; a mudança entra na auditoria do setor (integração, unitário e E2E `queue-distribution.spec.ts`).*
- [x] **CA-DST-03** — Abertura sem aprovação, aprovação final, encaminhamento e liberação distribuem segundo o modo, pulando quem está inativo, ausente ou no limite; reabertura e solicitação com responsável não distribuem; sem candidato, fica sem responsável. *Verificado em 2026-11-07 (SF-181): a abertura sem aprovação pendente, a aprovação final, a chegada por encaminhamento e a liberação (sem voltar para quem liberou nem para quem tinha) distribuem; a reabertura mantém o responsável; inativo, ausente no dia e quem está no limite são pulados; sem candidato, fica sem responsável; a atribuição tem o sistema como autor, o motivo `DISTRIBUTION`, o evento e o aviso de transferência (integração e unitário).*
- [x] **CA-DST-04** — Rodízio e menor carga escolhem como na regra 4; entradas simultâneas não ultrapassam o limite nem repetem a vez. *Verificado em 2026-11-07 (SF-181): rodízio pela ordem dos nomes a partir de quem recebeu por último e menor carga com desempate pelo rodízio; as solicitações de um pacote do mesmo setor vão para atendentes diferentes na vez; três aberturas simultâneas com limite 1 não passam do limite nem repetem a vez (a linha do setor é travada) (integração e unitário).*
- [x] **CA-DST-05** — A ausência de atendente segue as regras de período; com a opção do setor, o job passa as solicitações da pessoa uma vez por ausência, com histórico, evento e aviso. *Verificado em 2026-11-07 (SF-182): o administrador registra para qualquer atendente, o gestor para os do próprio setor e o atendente para si, com as regras de período (até 90 dias, não encerrado, sem sobreposição) e cancelamento enquanto não termina; telas próprias: a seção "Afastamentos de atendentes" da administração, "Afastamentos da equipe" do gestor e "Minhas ausências" do atendente; com a opção do setor ligada, o job passa as solicitações abertas e em atendimento da pessoa pelo modo do setor no primeiro dia, uma vez por ausência, com o sistema como autor, o motivo `ABSENCE`, o evento e o aviso; sem ninguém disponível, a solicitação fica com a pessoa; durante a ausência, a distribuição a pula (integração, unitário).*
- [x] **CA-DST-06** — A carga da equipe aparece para gestor, supervisor e administrador como na regra 8; "Análises" mostra quantas solicitações foram distribuídas automaticamente. *Verificado em 2026-11-07 (SF-183): a "Carga da equipe" mostra, por setor, as solicitações ativas de cada atendente ativo, a situação (disponível, no limite, ausente hoje) e quantas estão na fila sem responsável: o administrador vê todos os setores em "Setores"; o gestor, no "Painel do setor", e quem supervisiona a fila, na fila, veem o próprio setor quando ele distribui; "Análises" mostra "Distribuídas automaticamente" quando houver alguma. No `serviceflow_perf` (98.014 solicitações, 56.008 ativas no setor mais cheio), a carga respondeu em cerca de 50 a 55 ms e a distribuição com a trava do setor em cerca de 50 a 56 ms (integração, unitário e E2E).*
- [x] **CA-DST-07** — Migrations aditivas; atribuições existentes ficam sem motivo. *Verificado em 2026-11-07 (SF-180): migration `20261108200000_queue_distribution` só acrescenta (enums, colunas com padrão ou opcionais, tabela das ausências de atendente, restrições); todo setor começa com a distribuição desligada; as atribuições existentes feitas por pessoas ficam sem motivo, e as feitas pelas regras de escalonamento (SF-174) recebem `ESCALATION_RULE`; cada recusa do banco conferida pelo nome da restrição (integração).*

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
- *Esclarecimentos registrados em 2026-11-07 (SF-184):*
  - as notificações do sistema (`RequestNotification`) pertencem sempre a uma solicitação, e uma execução "não aberta" não tem solicitação; por isso os tipos `recurring.skipped` e `recurring.paused` **não** são criados: o aviso a quem criou a agenda (regra 3) aparece na tela das agendas, com destaque para as execuções "não abertas" e as agendas pausadas pelo sistema (SF-185 e SF-186), e não gera e-mail;
  - na auditoria, os dias da semana da agenda são registrados como `recurrenceWeekdays` ("Dias da semana"), porque `weekdays` já é o campo dos dias de expediente do calendário;
  - o banco também confere: nome sem espaços nas pontas, descrição não vazia, dias da semana sem repetição e respostas como objeto.
- *Esclarecimentos registrados em 2026-11-07 (SF-185):*
  - "agendas ativas" do limite de 200 (decisão H22) são as não encerradas e ainda dentro do período, **incluindo as pausadas**, para que retomar nunca ultrapasse o limite;
  - na alteração, um início que já passou pode ficar como está; só um início novo precisa ser hoje ou depois. Agendas encerradas ou com o fim já passado não são alteradas, pausadas nem retomadas;
  - retomar uma agenda zera as execuções seguidas "não abertas" (regra 3);
  - a tela abre o formulário em dois passos (primeiro o serviço, depois o formulário com os campos dele) e, na alteração, mantém o serviço da agenda; para trocar de serviço, encerra-se a agenda e cria-se outra;
  - o administrador tem a seção "Agendas" e o gestor a página "Agendas" na sua área; o gestor escolhe o solicitante entre todos os solicitantes ativos;
  - "Aberta automaticamente pela agenda …" na solicitação (regra 4) entra com a SF-186, porque só a execução pelo job cria essas solicitações.
- *Esclarecimentos registrados em 2026-11-07 (SF-186):*
  - depois do fim da agenda, o job não abre mais nada, nem o último dia previsto que tenha perdido (CA-REC-05); antes do fim, se o job não rodou no dia, a próxima execução abre só o dia previsto mais recente (decisão H10);
  - a execução roda no job depois da passagem por ausência (para a distribuição já pular quem está ausente) e antes do processamento dos eventos (para os avisos da abertura saírem na mesma execução);
  - a pausa automática na terceira execução seguida "não aberta" é feita pelo sistema e não gera registro de auditoria (que exige uma pessoa como autora); a tela mostra "Pausada pelo sistema" com o número de execuções;
  - um erro inesperado numa agenda não grava nada, não impede as outras e aparece no resumo do job como `failed`; a próxima execução tenta de novo;
  - o aviso "Aberta automaticamente pela agenda …" aparece na tela da solicitação do solicitante.

### 5.5 Critérios de aceitação

- [x] **CA-REC-01** — Sem agendas, nada muda. *Verificado em 2026-11-07 (SF-186): sem agendas, o passo do job não abre nada e devolve zeros; as telas das agendas só aparecem na seção "Agendas" e na página do gestor; as suítes anteriores passaram sem mudança (integração `recurring-runs.test.ts`).*
- [x] **CA-REC-02** — Administrador e gestor (só do próprio setor) criam e alteram agendas; a configuração recusa as violações da regra 2; outros perfis são recusados; as mudanças entram na auditoria. *Verificado em 2026-11-07 (SF-184 a SF-186): o administrador agenda qualquer serviço e o gestor só os do próprio setor; atendente e solicitante são recusados; serviço indisponível ou com documentos exigidos, solicitante inativo, respostas inválidas, datas fora da regra e a 201ª agenda em vigor são recusados com mensagem própria; criação e mudanças entram na auditoria, com descrição e respostas como dados pessoais (unitário, integração `recurring-schedules.test.ts` e E2E `recurring-requests.spec.ts`).*
- [x] **CA-REC-03** — O job abre a solicitação no dia previsto, uma vez por agenda e dia, mesmo com execuções simultâneas; a solicitação nasce como a abertura normal e mostra a agenda; dias perdidos não são recuperados. *Verificado em 2026-11-07 (SF-186): o job abre pela mesma função da abertura, em nome do solicitante, com respostas, histórico e evento `request.opened`; uma segunda chamada no mesmo dia e três jobs simultâneos abrem uma só (linha única por agenda e dia); os dias perdidos não são recuperados; o solicitante vê "Aberta automaticamente pela agenda …" (integração `recurring-runs.test.ts` e E2E pela rota do job).*
- [x] **CA-REC-04** — Uma execução que não confere fica registrada com o motivo e avisa quem criou; três seguidas pausam a agenda. *Verificado em 2026-11-07 (SF-185 e SF-186): serviço indisponível, solicitante inativo, documento exigido e formulário mudado ficam registrados como "não aberta" com o motivo; a tela das agendas mostra o aviso (esclarecimento da SF-184); a terceira seguida pausa a agenda e uma abertura zera a contagem (integração e unitário).*
- [x] **CA-REC-05** — Pausar, retomar e encerrar funcionam; agenda pausada ou encerrada não executa; o fim da agenda é respeitado. *Verificado em 2026-11-07 (SF-185 e SF-186): pausar, retomar (zerando as falhas) e encerrar seguem o estado, com conflito para o que não se aplica; agendas pausadas, encerradas, ainda não iniciadas ou com o fim passado não executam (integração e E2E).*
- [x] **CA-REC-06** — Migrations aditivas; nenhuma dependência nova. *Verificado em 2026-11-07 (SF-184): migration `20261108300000_recurring_requests` só acrescenta (enums, duas tabelas, coluna opcional em `Request`, função e restrições); nenhuma dependência nova (integração do schema).*

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
- *Esclarecimentos registrados em 2026-11-07 (SF-187):*
  - **nomes repetidos:** o nome do serviço não é único no banco, e campos, etapas, documentos, papéis, pacotes, respostas prontas e regras de escalonamento só são únicos entre os ativos. Como a importação casa pelo nome (decisão H14), a exportação gera o arquivo mesmo assim, mas lista os nomes repetidos no mesmo escopo (comparados sem diferenciar maiúsculas), avisando que eles vão impedir a importação; a prévia (SF-188) recusa o arquivo com chaves repetidas;
  - no arquivo, as respostas prontas e as regras de escalonamento ficam dentro do setor, e os campos, documentos, etapas e artigos dentro do serviço; a ordem é fixa (por nome ou posição), para a mesma configuração dar sempre o mesmo conteúdo;
  - não vão para o arquivo o estado de funcionamento (por exemplo, o último atendente que recebeu pelo rodízio) nem referências a itens que não existem mais; das pessoas, só o e-mail das que a configuração cita;
  - o calendário vai com os horários em "HH:MM", como na tela; os limites decimais, como texto com as casas do campo;
  - um arquivo acima de 2 MB é gerado com aviso, porque a importação não o aceitará;
  - na auditoria, a configuração não tem linha própria: os registros de exportação e de importação usam um identificador fixo de entidade, com o rótulo "Configuração da organização"; a exportação não registra mudanças de campos.
- *Esclarecimentos registrados em 2026-11-07 (SF-188):*
  - a prévia usa os próprios esquemas e regras de cada tela, aplicados ao estado que a importação deixaria (o que existe mais o que vem no arquivo); itens **iguais** ao destino não mudam nada e não são conferidos de novo, e os limites de um grupo (por exemplo, 10 campos ativos por serviço) são conferidos quando o arquivo muda algo nele, para que exportar e importar de volta sempre funcione (regra 6);
  - nas pessoas, o valor que o destino já tem naquele item é mantido, mesmo que hoje a pessoa não pudesse ser escolhida, pelo mesmo motivo; um item que perde a pessoa continua tendo de seguir as regras (por exemplo, uma regra de escalonamento que fica sem nenhuma ação é recusada);
  - o tipo de um campo existente nunca muda, como na tela de campos (não só quando há respostas);
  - um arquivo com nomes que não podem ser casados (repetidos no arquivo, ou repetidos no destino e usados pelo arquivo) é recusado antes das demais regras;
  - o caminho de cada problema segue o arquivo, com os nomes: por exemplo, "services › Acesso a sistema › fields › Sistema › options";
  - a prévia não grava nada nem entra na auditoria; ela devolve o resumo criptográfico (SHA-256) do arquivo e da configuração do destino, que a aplicação (SF-189) confere.
- *Esclarecimentos registrados em 2026-11-08 (SF-189):*
  - a aplicação confere o resumo do arquivo antes de abrir a transação e, dentro dela, lê o destino de novo, refaz a mesma avaliação da prévia e compara o resumo do destino; qualquer diferença recusa a aplicação e pede nova prévia;
  - itens iguais não são tocados; os novos são criados e os alterados atualizados com a auditoria da tela correspondente. Como nas telas, um campo novo com condição e a condição de aprovação de um serviço são gravados em um segundo passo (a condição aponta para um campo), o que gera um segundo registro de auditoria; as respostas prontas não têm auditoria na tela e também não têm na importação; o calendário igual ao padrão não gera registro, como na tela;
  - as pessoas são ligadas pelo e-mail; as posições (de campos, documentos, etapas e artigos) vêm do arquivo como estão;
  - o registro próprio da importação ("Importou · Configuração da organização") traz "Itens novos", "Itens alterados" e "Itens iguais";
  - a transação tem limite de 60 segundos; se estourar, nada é gravado.
- *Esclarecimentos registrados em 2026-11-08 (SF-190):*
  - a seção "Configuração portátil" da administração mostra, antes de exportar, o tamanho previsto e os nomes repetidos, por uma leitura que não é exportação e não entra na auditoria; o botão "Exportar configuração" baixa o arquivo e registra a exportação;
  - a importação na tela é em dois passos sem passar pelo endereço: o arquivo vai para a prévia, que volta com o texto do arquivo; "Aplicar a importação" só aparece numa prévia aceita e envia esse mesmo texto com os resumos;
  - como um formulário envia as quebras de linha como CRLF, os dois passos usam quebras LF (no JSON, só espaço em branco); sem isso, o resumo do arquivo não conferia e a aplicação era recusada;
  - quando tudo no arquivo já está igual, a tela diz que não há o que aplicar e o botão fica desativado.

### 6.5 Critérios de aceitação

- [x] **CA-CFG-01** — Só o administrador exporta e importa; as duas ações entram na auditoria. *Verificado em 2026-11-08 (SF-187 a SF-190): exportar, a prévia e a aplicação recusam os outros perfis; "Exportou" e "Importou · Configuração da organização" entram na auditoria, a importação com os itens novos, alterados e iguais (unitário, integração e E2E `configuration-portable.spec.ts`).*
- [x] **CA-CFG-02** — O arquivo exportado segue o formato e o conteúdo da regra 2, sem dados pessoais, segredos ou identificadores internos. *Verificado em 2026-11-08 (SF-187 e SF-190): formato `serviceflow-config` versão 1 com todos os itens da regra 2, ativos e inativos, por nomes, rótulos e e-mails; nenhum id interno de linha, nome de pessoa, senha ou segredo de webhook aparece no arquivo (unitário, integração e E2E).*
- [x] **CA-CFG-03** — A prévia recusa arquivo inválido com a lista de problemas, classifica cada item e avisa sobre pessoas não encontradas. *Verificado em 2026-11-08 (SF-188 e SF-190): arquivo fora do formato, acima de 2 MB, com nomes repetidos ou com qualquer violação das regras das telas é recusado inteiro, com até 50 problemas e o caminho de cada um; os itens aparecem como novos, alterados (com os campos) ou iguais; pessoas que não existem ou não podem ocupar o papel viram aviso e o item entra sem elas (unitário, integração e E2E).*
- [x] **CA-CFG-04** — A aplicação é tudo ou nada, não apaga nada, audita cada item e recusa quando o destino mudou depois da prévia. *Verificado em 2026-11-08 (SF-189 e SF-190): uma falha provocada na última gravação não deixa nada; o que não está no arquivo fica como está; cada item criado ou alterado tem a auditoria da sua tela; outro arquivo ou destino alterado depois da prévia são recusados com pedido de nova prévia (integração e unitário).*
- [x] **CA-CFG-05** — Exportar de um ambiente e importar num banco vazio reproduz a configuração; reimportar o mesmo arquivo dá "igual" em tudo. *Verificado em 2026-11-08 (SF-189 e SF-190): um banco sem configuração (pessoas mantidas) é reconstruído e exportado de novo igual ao original; reimportar o arquivo exportado dá "igual" em tudo e só grava o registro da importação; na tela, a segunda importação do mesmo arquivo informa que não há o que aplicar (integração e E2E).*

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
- *Esclarecimentos registrados em 2026-11-08 (SF-191):*
  - os critérios guardados são a query string da lista só com os parâmetros dela (fila: busca, status, responsável, prazo, etapa, datas e ordem; "Minhas solicitações": busca, status, datas e ordem), em ordem fixa, sem a página e com os status ordenados, para a mesma busca gerar sempre o mesmo texto;
  - a fila é de quem tem perfil Atendente e "Minhas solicitações" de quem tem perfil Solicitante, como as próprias listas; nome repetido ou acima do limite de 20 tem mensagem própria, e uma busca normalizada acima de 1.000 caracteres conta como acima do limite;
  - o bloco "Minhas visões" fica abaixo da busca, com a visão aberta marcada; renomear e apagar ficam dentro de "Renomear ou apagar";
  - ao abrir uma visão sem recarregar a página, o formulário de busca passou a ser recriado com os critérios da visão (antes os campos mantinham os valores anteriores, embora a lista viesse filtrada certo);
  - a anonimização de uma pessoa apaga as visões dela, porque podem guardar termos de busca; "Meus dados" continua sem as visões (fora do escopo desta SPEC).
- *Esclarecimentos registrados em 2026-11-08 (SF-192):*
  - cada item passa pela própria ação individual (assumir, transferir, mudar a prioridade, encaminhar), com a autorização, a transação, o histórico, os eventos e os avisos dela; os itens são tratados um depois do outro, para cada um ver o que os anteriores deixaram (por exemplo, a vez da distribuição);
  - o caso de uso aceita de 1 a 50 solicitações distintas; "todas da página atual" é garantido pela tela (SF-193), que só oferece as da página;
  - os dados comuns são conferidos uma vez antes de qualquer item: a justificativa do encaminhamento vazia, mais de 50 ou solicitações repetidas recusam o lote inteiro, sem tocar em nada;
  - os motivos são textos fixos: "sem permissão", "já tem responsável…", "a ação não vale para ela agora…", "o colega escolhido não pode recebê-la", "já está com essa prioridade", "o setor escolhido não pode recebê-la" e "não foi possível concluir". A ação individual usa o mesmo erro para "não vale agora" e "mudou enquanto você agia", por isso esses dois casos têm um texto só;
  - uma falha inesperada num item vira "não foi possível concluir" e não interrompe os demais.
- *Esclarecimentos registrados em 2026-11-08 (SF-193):*
  - na fila, cada solicitação da página ganha "Marcar para ação em lote"; as caixas pertencem ao formulário "Ações em lote" pelo identificador dele, então só as solicitações da página podem ser enviadas;
  - o formulário mostra só os dados da ação escolhida (colega, prioridade, ou setor e justificativa); os colegas e setores oferecidos são os mesmos das ações individuais, para o setor de quem está na fila;
  - o resultado aparece no próprio bloco, sem passar pelo endereço: o resumo ("Assumir: 2 feitas, 1 recusada") e cada solicitação com "feito" ou "recusado (motivo)"; a fila é lida de novo depois do lote.

### 7.5 Critérios de aceitação

- [x] **CA-LOT-01** — Quem não salva visões nem usa o lote não vê mudança além dos controles novos. *Verificado em 2026-11-08 (SF-191 e SF-193): sem visões nem lote, as listas e as ações individuais funcionam como antes (as suítes anteriores passaram sem mudança de comportamento); os controles novos são o bloco "Minhas visões", o bloco "Ações em lote" e as caixas de marcação da fila. A única mudança fora deles foi a correção do formulário de busca, que agora mostra os critérios da página também numa navegação sem recarregar (unitário, integração e E2E).*
- [x] **CA-LOT-02** — Salvar, abrir, renomear e apagar visões nas duas listas, com os limites da regra 1; uma pessoa nunca vê as visões de outra. *Verificado em 2026-11-08 (SF-191): na fila e em "Minhas solicitações", com nome de 1 a 40, único por pessoa e lista sem diferenciar maiúsculas, até 20 por lista e critérios normalizados de até 1.000 caracteres; as visões de outra pessoa não aparecem e respondem "não encontrada" (unitário, integração e E2E `saved-views.spec.ts`).*
- [x] **CA-LOT-03** — As quatro ações em lote aplicam a cada item as regras da ação individual, cada um na sua transação, e mostram o resultado por item; um item recusado não afeta os outros; mais de 50 é recusado. *Verificado em 2026-11-08 (SF-192 e SF-193): assumir, transferir, mudar a prioridade e encaminhar passam cada item pela ação individual; a tela mostra o resultado por item com motivo fixo; um item de outra pessoa ou de outro setor é recusado sem afetar os demais; mais de 50, repetidas ou encaminhamento sem justificativa são recusados antes de qualquer item; dois lotes simultâneos assumem cada solicitação uma vez (unitário, integração com concorrência e E2E `queue-batch.spec.ts`).*
- [x] **CA-LOT-04** — O histórico, os eventos e os avisos de cada item são os mesmos da ação individual. *Verificado em 2026-11-08 (SF-192 e SF-193): cada item grava a atribuição, a prioridade ou o encaminhamento com o ator, o evento (`request.assignment_changed`, `request.priority_changed`, `request.sector_changed`) e os avisos da própria ação individual, que é a que roda; o histórico da solicitação mostra a mudança como numa ação feita sozinha (integração e E2E).*
- [x] **CA-LOT-05** — Migration aditiva; nenhuma dependência nova. *Verificado em 2026-11-08 (SF-191): migration `20261108500000_saved_views` só acrescenta (enum, tabela, índice único e `CHECK`); as ações em lote não têm tabela; nenhuma dependência nova (integração do schema).*

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
