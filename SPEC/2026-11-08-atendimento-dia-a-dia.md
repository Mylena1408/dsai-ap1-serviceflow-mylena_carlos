# SPEC — Atendimento no dia a dia

**Data:** 2026-11-08
**Status:** Aprovada em 2026-11-08. A responsável escolheu, do levantamento de funcionalidades para a meta, os itens 1 a 10 e deixou de fora o item 11 (segurança da conta), para não mexer na segurança nem em princípios de acesso já decididos. Esta é a primeira de duas SPECs: ela cobre os itens 1 a 6 e os complementos ("faça a SPEC 1 com os complementos"); os itens 7 a 10 ficam para a SPEC 2. As decisões I1 a I24 da seção 10 foram adotadas como recomendadas e podem ser revistas por ela antes do início de cada parte.
**Projeto:** ServiceFlow
**Referências:**
- `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (abertura, regras de status);
- `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md` (assumir, cancelar com justificativa, reabrir);
- `SPEC/2026-10-31-busca-filtros-paginacao.md` (critérios das listas e URL);
- `SPEC/2026-10-31-comentarios.md` (comentários públicos e internos);
- `SPEC/2026-11-01-notificacoes-email-preferencias.md` (avisos, categorias de e-mail, preferências);
- `SPEC/2026-11-01-fluxos-configuraveis.md` (etapas; conclusão);
- `SPEC/2026-11-02-api-externa-webhooks.md` (API pública);
- `SPEC/2026-11-02-auditoria-lgpd.md` (auditoria administrativa, anonimização);
- `SPEC/2026-11-06-analises-operacionais.md` (Análises);
- `SPEC/2026-11-07-operacao-e-automacao.md` (vínculo "duplicada de", ações em lote, visões salvas, configuração portátil);
- `SPEC/2026-10-29-plano-escala-100k.md` (garantia 7.4; meta de linhas).

## 1. Objetivo

O atendimento já cobre o ciclo da solicitação, a fila em escala e a configuração. No trabalho de cada dia, porém, faltam formas de organizar a fila por assunto, de garantir que um atendimento siga os passos combinados, de saber quanto tempo ele tomou, de manter outras pessoas a par, de chamar um colega para uma conversa interna e de resolver pedidos repetidos. Esta SPEC acrescenta esses recursos em sete partes independentes:

| Parte | O que acrescenta |
|---|---|
| A — Etiquetas | Etiquetas por setor aplicadas às solicitações, na busca, nas visões, no lote e nas análises |
| B — Checklist | Modelos de checklist por serviço; o checklist acompanha a solicitação e pode ser exigido na conclusão |
| C — Apontamento de horas | Tempo gasto por atendente em cada solicitação, com totais e relatório |
| D — Seguidores | Pessoas que acompanham uma solicitação e recebem os avisos dela |
| E — Menções | `@colega` num comentário interno avisa a pessoa citada |
| F — Duplicadas | Encerrar uma solicitação como duplicada de outra, levando o solicitante a acompanhar a original |
| G — Complementos | Etiquetas e checklists na configuração portátil e na API pública; análises de horas e de checklist |

## 2. Registro da mudança de escopo e garantia

Nenhum destes recursos estava previsto em SPEC anterior; esta SPEC é o registro que autoriza implementá-los. Todos são genéricos: não supõem setores, serviços ou pessoas específicos.

**Garantia 7.4 do plano, para todas as partes:** quem não usa um recurso novo não percebe mudança. Setores sem etiquetas, serviços sem modelo de checklist, solicitações sem horas apontadas, sem seguidores, sem menções e sem duplicadas encerradas se comportam exatamente como hoje, e as suítes anteriores passam sem alteração de asserções (exceto listas exatas que a própria SPEC amplia, como entidades da auditoria, tipos de aviso, operações da API ou o formato da configuração portátil).

**Fora desta SPEC, por decisão da responsável:** nada muda em autenticação, senhas, sessões, perfis ou permissões. Os recursos novos seguem as regras de acesso que já existem (quem lê a solicitação, quem atende o setor, quem administra).

## 3. Parte A — Etiquetas

### 3.1 Escopo

1. **Etiquetas por setor:** cada setor tem suas etiquetas (nome e cor), cadastradas pelo administrador e pelo gestor do setor **(decisão I1)**.
2. **Na solicitação:** atendentes do setor aplicam e retiram etiquetas; o histórico registra a mudança.
3. **Na fila:** etiquetas aparecem na lista; a busca filtra por etiqueta; as visões salvas guardam o filtro; o lote ganha "Etiquetar" e "Retirar etiqueta".
4. **Análises:** contagem de solicitações por etiqueta no período.

### 3.2 Fora de escopo

- Etiquetas globais (de todos os setores); etiquetas escolhidas pelo solicitante; etiquetas automáticas por regra.
- Etiquetas visíveis ao solicitante **(decisão I2)**.

### 3.3 Regras

1. **Cadastro:** nome de 1 a 30 caracteres, único entre as ativas do setor (sem diferenciar maiúsculas); cor de uma paleta fixa de 8 cores com contraste conferido **(decisão I3)**; até 30 etiquetas ativas por setor; desativar não retira a etiqueta das solicitações que já a têm; cada mudança entra na auditoria.
2. **Aplicar:** atendente do setor da solicitação, em solicitação não cancelada; até 5 etiquetas por solicitação; só etiquetas ativas do setor atual. Encaminhada a outro setor, a solicitação **mantém** as etiquetas do setor anterior, que aparecem acinzentadas e podem ser retiradas pelo novo setor **(decisão I4)**.
3. **Histórico e eventos:** "Etiqueta X aplicada/retirada por Y"; evento `request.tags_changed` (sem aviso a pessoas).
4. **Busca:** parâmetro `tag` (uma ou mais etiquetas do setor; "qualquer uma delas"); entra nos critérios normalizados das visões salvas da fila.
5. **Lote:** "Etiquetar" e "Retirar etiqueta" seguem a regra 2 por item, como as demais ações em lote (decisão H18).

### 3.4 Dados

- Nova tabela `SectorTag` (`sectorId`, `name` `citext`, `color`, `isActive`, datas), única entre as ativas por (`sectorId`, `name`).
- Nova tabela `RequestTag` (`requestId`, `tagId`, `addedById`, `addedAt`), única por (`requestId`, `tagId`); nova tabela `RequestTagEvent` (aplicada/retirada, ator, data).
- Enum da auditoria ganha `SECTOR_TAG`.
- *Esclarecimentos registrados em 2026-11-08 (SF-194):*
  - a paleta tem as cores cinza, vermelho, laranja, amarelo, verde, turquesa, azul e roxo, guardadas pela chave (`gray`, `red`…); cada uma é um fundo claro com texto escuro, e os testes conferem o contraste de pelo menos 4,5:1 (WCAG AA) de todos os pares;
  - "não cancelada" na regra 2 inclui as concluídas: uma solicitação concluída ainda pode ser etiquetada (por exemplo, para análise posterior);
  - uma etiqueta em uso nunca é apagada, só desativada (a chave estrangeira impede apagar); a auditoria da etiqueta registra nome, cor e situação, e o setor fica fixo desde a criação.
- *Esclarecimentos registrados em 2026-11-08 (SF-195):*
  - o administrador cuida das etiquetas na seção "Etiquetas" da administração (todos os setores ativos); o gestor, na página "Etiquetas" da área dele (só o próprio setor); atendentes e solicitantes não chegam a essas telas;
  - reativar uma etiqueta conta no limite de 30 e exige o nome livre entre as ativas do setor; a lista mostra quantas solicitações usam cada etiqueta, e as inativas aparecem em cinza.
- *Esclarecimentos registrados em 2026-11-08 (SF-196):*
  - o bloco "Etiquetas" fica no detalhe da fila (o atendente aplica e retira) e no detalhe do gestor do setor (só leitura); quem não é da equipe do setor (inclusive o gestor que só decide uma aprovação de outro setor e o solicitante) não vê o bloco, e a ação responde "não encontrada";
  - o evento `request.tags_changed` leva só quem mudou e quantas etiquetas foram aplicadas e retiradas (as etiquetas ficam no banco); como os webhooks aceitam qualquer evento do domínio, ele também aparece como opção ("Etiquetas alteradas") no cadastro de webhooks. Uma migration nova (`20261108700000_request_tags_event`) acrescenta o tipo às listas do outbox e dos webhooks no banco;
  - uma mudança que não muda nada não grava histórico nem evento; duas pessoas aplicando a mesma etiqueta ao mesmo tempo gravam uma vez só (a outra recebe conflito).
- *Esclarecimentos registrados em 2026-11-08 (SF-197):*
  - o filtro aceita até 5 etiquetas ("qualquer uma delas"), pelos identificadores; o formulário de busca da fila mostra as etiquetas ativas do setor como caixas de marcar; a lista "Minhas solicitações" ignora o parâmetro, porque o solicitante não vê etiquetas;
  - sem etiqueta escolhida, os critérios da busca ficam exatamente como antes; nas visões salvas, as etiquetas são guardadas ordenadas, como os status;
  - no lote, "Etiquetar" e "Retirar etiqueta" usam a etiqueta escolhida para todos os itens e passam cada item pelo caso de uso das etiquetas (o mesmo do detalhe); a recusa por etiqueta de outro setor, inativa ou acima de 5 aparece como "a etiqueta não é do setor dela, está inativa ou ela já tem 5 etiquetas".
- *Esclarecimentos registrados em 2026-11-08 (SF-198):*
  - "Análises" conta as solicitações **abertas no período** pelas etiquetas que elas têm **agora**; uma solicitação com duas etiquetas conta nas duas; a mais usada vem primeiro;
  - vale o mesmo escopo das demais análises (gestor: o próprio setor; administrador: todos ou o setor filtrado); com todos os setores, cada etiqueta vem com o nome do setor;
  - o bloco "Etiquetas" só aparece quando alguma solicitação do período tem etiqueta.
- *Esclarecimentos registrados em 2026-11-08 (SF-199):*
  - a lista da fila mostra as etiquetas de cada solicitação (na cor delas; as de outro setor ou inativas, em cinza), lidas só para as solicitações do setor do atendente;
  - o E2E achou um defeito no lote: quando a ação tira as solicitações do filtro (por exemplo, retirar a etiqueta filtrada), a fila relida fica vazia e o bloco "Ações em lote", que só aparecia com itens, sumia junto com o resultado. O bloco passou a ficar sempre na página: sem itens, esconde o formulário e mantém o resultado, que guarda os nomes das solicitações do momento do envio.

### 3.5 Critérios de aceitação

- [x] **CA-ETQ-01** — Setor sem etiquetas se comporta como hoje. *Verificado em 2026-11-08 (SF-194 a SF-199): sem etiquetas, a busca tem os mesmos critérios, o detalhe não mostra o bloco para quem só lê, "Análises" não mostra o bloco novo e a lista da fila não muda; as suítes anteriores passaram sem mudar asserções (só uma fixture do objeto de análises ganhou o campo novo vazio).*
- [x] **CA-ETQ-02** — Administrador e gestor do setor cadastram, alteram, desativam e reativam etiquetas com os limites da regra 1; mudanças entram na auditoria. *Verificado em 2026-11-08 (SF-194, SF-195 e SF-199): seção "Etiquetas" da administração e página do gestor; nome único entre as ativas, cor da paleta com contraste conferido, até 30 ativas; auditoria `SECTOR_TAG` (unitário, integração e E2E `sector-tags.spec.ts`).*
- [x] **CA-ETQ-03** — Atendentes do setor aplicam e retiram etiquetas com a regra 2; o histórico e o evento registram cada mudança; o solicitante não vê etiquetas. *Verificado em 2026-11-08 (SF-196 e SF-199): até 5, só ativas do setor, nunca em cancelada, as de setor anterior retiráveis; histórico e evento `request.tags_changed` a cada mudança; o solicitante não vê o bloco nem a etiqueta (integração com concorrência e E2E).*
- [x] **CA-ETQ-04** — A busca, as visões salvas e o lote usam etiquetas; "Análises" conta solicitações por etiqueta. *Verificado em 2026-11-08 (SF-197 a SF-199): filtro por até 5 etiquetas na fila, guardado nas visões; "Etiquetar" e "Retirar etiqueta" no lote; "Análises" conta as solicitações abertas no período por etiqueta, no escopo de quem vê (unitário, integração e E2E).*
- [x] **CA-ETQ-05** — Migration aditiva; nenhuma dependência nova. *Verificado em 2026-11-08 (SF-194 e SF-196): `20261108600000_sector_tags` só acrescenta (enums, tabelas, índices, restrições); `20261108700000_request_tags_event` recria as listas de tipos de evento do outbox e dos webhooks com o tipo novo, mantendo os anteriores; nenhuma dependência nova.*

## 4. Parte B — Checklist de atendimento

### 4.1 Escopo

1. **Modelo por serviço:** o administrador (e o gestor do setor do serviço) define um checklist com itens, cada um obrigatório ou opcional.
2. **Na solicitação:** o checklist do serviço é copiado para a solicitação quando ela entra em atendimento **(decisão I5)**; o atendente marca e desmarca itens.
3. **Na conclusão:** com itens obrigatórios por marcar, a conclusão é recusada com a lista do que falta.

### 4.2 Fora de escopo

- Itens com responsável, prazo ou anexos próprios; checklists por etapa; itens acrescentados pelo atendente numa solicitação.
- Checklist visível ao solicitante **(decisão I6)**.

### 4.3 Regras

1. **Modelo:** até 20 itens ativos por serviço, texto de 1 a 120 caracteres, ordem definida por subir e descer; mudanças entram na auditoria. Mudar o modelo **não** muda os checklists já copiados **(decisão I7)**.
2. **Cópia:** na primeira vez que a solicitação passa a "Em atendimento" (ou ao ser assumida, se o serviço não usa essa transição), cria-se o checklist da solicitação com os itens ativos do modelo naquele momento; reabrir não copia de novo.
3. **Marcar:** atendente do setor, com a solicitação em atendimento e sendo o responsável efetivo (ou supervisor da fila, como nas demais ações); cada marcação registra quem e quando; o histórico mostra "Item X concluído por Y".
4. **Conclusão:** a regra entra na mesma transação da conclusão: com obrigatórios por marcar, a conclusão é recusada com conflito e a tela lista os itens pendentes **(decisão I8)**.
5. **Solicitações antigas e serviços sem modelo:** sem checklist, a conclusão segue como hoje.

### 4.4 Dados

- Nova tabela `ServiceChecklistItem` (`serviceId`, `text`, `isRequired`, `position`, `isActive`, datas).
- Nova tabela `RequestChecklistItem` (`requestId`, `textSnapshot`, `isRequired`, `position`, `doneAt`, `doneById`).
- Enum da auditoria ganha `CHECKLIST_ITEM`.
- *Esclarecimentos registrados em 2026-11-08 (SF-200):* para cumprir as regras 2 e 3 e a seção 13.1, os dados ganham: `ServiceChecklistItem.conditionFieldId`/`conditionValue` (item 1 da 13.1; o campo é do mesmo serviço por chave composta, como nas etapas, e a condição tem campo e valor de 1 a 80 caracteres, ou nenhum); `RequestChecklistItem.templateItemId` (de qual item do modelo veio) e `note` (observação de 1 a 200 caracteres, só em item marcado); a tabela `RequestChecklist` (`requestId`, `copiedAt`), que marca que a cópia já foi feita, mesmo quando nenhum item entrou, para que reabrir não copie de novo; e a tabela `RequestChecklistEvent` (item, `DONE`/`UNDONE`, observação, quem e quando) para o histórico. Os limites (texto de 1 a 120, posição a partir de 1, quem e quando sempre juntos) também ficam em `CHECK`s. Item do modelo usado numa cópia nunca é apagado: é desativado. Copiar de outro serviço que ultrapassaria 20 itens ativos não acrescenta nenhum (recusa inteira, como as demais validações de limite), e copiar de um serviço sem itens ativos é recusado. Marcar um item já marcado (ou desmarcar um desmarcado) não muda nada nem gera histórico.
- *Esclarecimentos registrados em 2026-11-08 (SF-201):* o modelo fica na seção "Checklists" da administração (todos os serviços ativos) e na página "Checklists" da área do gestor (os serviços ativos do seu setor), a mesma regra de quem gere as etiquetas; outros perfis não configuram. Cada serviço aparece num bloco com seus itens: acrescentar (texto e "Obrigatório"/"Opcional"), alterar, subir e descer entre os ativos, desativar e reativar; um item reativado volta no fim da lista e conta no limite de 20 ativos. Itens não são apagados, só desativados. A condição do item (13.1 item 1) e a cópia de outro serviço (13.1 item 2) ganham seus formulários nas SF-224 e SF-225; nesta tarefa, alterar um item não mexe na condição. Serviço inativo não recebe itens.
- *Esclarecimentos registrados em 2026-11-08 (SF-202):* no sistema, toda solicitação passa por "Em atendimento" antes de ser concluída (a transição de "Aberta" direto para "Concluída" não existe), e "assumir" não muda a situação; por isso a cópia acontece sempre na passagem para "Em atendimento", na mesma transação, com a hora dessa passagem, pela tela do atendente ou pela API, que usam o mesmo caso de uso. Os itens condicionais são avaliados com as respostas que o solicitante deu na abertura (as mesmas que decidem as etapas). Um serviço sem itens ativos também marca a solicitação como copiada, sem itens: a solicitação segue como hoje e, se o modelo ganhar itens depois, ela não os recebe. Solicitações em atendimento antes desta versão não têm checklist e não recebem um.
- *Esclarecimentos registrados em 2026-11-08 (SF-203):* marca e desmarca quem pode agir no atendimento como nas demais ações: o responsável efetivo, qualquer atendente do setor quando ninguém assumiu, ou um supervisor da fila; um colega sem esse direito recebe conflito, e quem não é atendente do setor recebe "não encontrado". Leem o checklist e o seu histórico os atendentes e o gestor do setor da solicitação (a mesma equipe que lê as etiquetas); o gestor não marca. Marcar grava quem, quando e a observação opcional (13.1 item 4); desmarcar limpa os três. A marcação só é gravada se o item ainda estiver como foi lido (duas pessoas ao mesmo tempo: a segunda recebe conflito). O histórico mostra "Item do checklist "X" concluído" ou "desmarcado", com quem fez e a observação. O bloco do checklist no detalhe chega na SF-205; nesta tarefa, o histórico do detalhe já mostra as marcações.
- *Esclarecimentos registrados em 2026-11-08 (SF-204):* a regra entra no caso de uso da conclusão, depois da verificação das informações do atendimento obrigatórias e na mesma transação. A recusa é um conflito (409 na API) que leva os textos dos itens obrigatórios por marcar, na ordem do checklist; a tela do atendente mostra "Não foi possível concluir: há itens obrigatórios do checklist por marcar." seguido de "Falta marcar: ...", com a lista lida no momento. Itens opcionais não impedem a conclusão; sem checklist, ou com checklist só de opcionais, a conclusão segue como hoje.
- *Esclarecimentos registrados em 2026-11-08 (SF-205):* o detalhe da fila mostra o bloco "Checklist" só quando a solicitação tem itens: o progresso ("Checklist 1/3", 13.1 item 3, que na lista da fila chega na SF-226), os obrigatórios por marcar em destaque, cada item com quem marcou, quando e a observação; quem pode marcar agora vê "Marcar como concluído" (com a observação opcional) e "Desmarcar". O detalhe do gestor mostra o mesmo bloco, só para leitura. O solicitante não vê o bloco nem os textos dos itens.

### 4.5 Critérios de aceitação

- [x] **CA-CHK-01** — Serviço sem modelo de checklist e solicitações antigas se comportam como hoje. *Verificado em 2026-11-08 (SF-202 a SF-205): sem itens, a solicitação é marcada como copiada e conclui como antes; sem checklist, o detalhe não mostra o bloco e o histórico não muda; as suítes anteriores passaram sem mudar asserções (integração e unitário da tela).*
- [x] **CA-CHK-02** — O modelo é configurado com os limites da regra 1 e entra na auditoria; mudá-lo não altera checklists já copiados. *Verificado em 2026-11-08 (SF-200, SF-201 e SF-205): seção "Checklists" da administração e página do gestor; até 20 ativos, texto de 1 a 120, subir e descer; auditoria `CHECKLIST_ITEM`; a cópia guarda o texto do momento (integração e E2E `checklists.spec.ts`).*
- [x] **CA-CHK-03** — O checklist é copiado uma vez, na entrada em atendimento; marcar e desmarcar seguem a regra 3 e ficam no histórico. *Verificado em 2026-11-08 (SF-202, SF-203 e SF-205): cópia na primeira passagem para "Em atendimento", nunca de novo; marca o responsável efetivo (ou o setor sem responsável, ou um supervisor); o histórico mostra cada marcação com a observação (integração, unitário e E2E).*
- [x] **CA-CHK-04** — A conclusão com itens obrigatórios por marcar é recusada, com a lista do que falta; concluída a solicitação, o checklist não muda mais. *Verificado em 2026-11-08 (SF-203 a SF-205): conflito com os itens que faltam, na mesma transação; a tela mostra "Falta marcar"; concluída, a marcação é recusada e o bloco só mostra (integração e E2E).*
- [x] **CA-CHK-05** — Migration aditiva; nenhuma dependência nova. *Verificado em 2026-11-08 (SF-200): `20261108800000_checklists` só cria tipos, tabelas, índices e restrições e acrescenta um valor ao enum da auditoria; `package.json` não mudou.*

## 5. Parte C — Apontamento de horas

### 5.1 Escopo

1. **Lançar tempo:** o atendente registra o tempo que gastou numa solicitação (data, duração e uma nota curta opcional).
2. **Totais:** a solicitação mostra o total de horas e quem lançou.
3. **Relatório:** gestor e administrador veem as horas por atendente, por serviço e por setor no período, com CSV.

### 5.2 Fora de escopo

- Cronômetro em tempo real; custo por hora; aprovação de horas; horas fora de solicitações.
- Horas visíveis ao solicitante **(decisão I9)**.

### 5.3 Regras

1. **Quem lança:** atendente do setor da solicitação (não precisa ser o responsável), em solicitação não cancelada; também depois de concluída, por até 7 dias **(decisão I10)**.
2. **Valores:** duração de 1 a 720 minutos por lançamento (em horas e minutos na tela); data entre a abertura da solicitação e hoje (fuso da organização); nota de até 200 caracteres.
3. **Alterar e apagar:** só a própria pessoa, em até 7 dias depois do lançamento; o histórico guarda a mudança.
4. **Relatório:** gestor vê o próprio setor (pelas regras de leitura do setor que já existem); administrador vê todos; filtros de período (os mesmos de "Análises") e setor; CSV com colunas fixas e sem descrição das solicitações.

### 5.4 Dados

- Nova tabela `RequestTimeEntry` (`requestId`, `userId`, `workedOn` `DATE`, `minutes`, `note`, `createdAt`, `updatedAt`, `deletedAt`), com `CHECK` dos valores; apagar marca `deletedAt` **(decisão I11)**.
- *Esclarecimentos registrados em 2026-11-08 (SF-206):* para cumprir a regra 3 ("o histórico guarda a mudança"), os dados ganham a tabela `RequestTimeEntryEvent` (lançamento, `CREATED`/`UPDATED`/`DELETED`, dia e minutos depois da mudança, quem e quando), ligada ao lançamento e à mesma solicitação por chave composta. A coluna `Service.estimatedHours` (13.2 item 1, de 1 a 200 ou nenhuma) entra nesta mesma migration, para a parte C ter um só envio com backup; a tela e a auditoria da estimativa chegam na SF-227. A duração é informada em horas (0 a 12) e minutos (0 a 59) e guardada em minutos; o dia é um dia válido do calendário. O prazo de 7 dias para lançar depois da conclusão e para alterar ou apagar conta em horas corridas desde a conclusão ou o lançamento. Lançamento com histórico nunca é apagado do banco: apagar marca `deletedAt` (decisão I11).
- *Esclarecimentos registrados em 2026-11-08 (SF-207):* quem não é atendente do setor da solicitação (outro setor, gestor, solicitante) recebe "não encontrado"; em solicitação cancelada, ou concluída há mais de 7 dias, o lançamento é recusado com conflito. Alterar e apagar valem para o próprio lançamento, ainda não apagado, por até 7 dias depois de lançado, e só enquanto a pessoa ainda pode lançar na solicitação (um atendente que mudou de setor não altera mais). Alterar com os mesmos valores não grava nada. O dia de abertura e o "hoje" seguem o fuso do calendário da organização.
- *Esclarecimentos registrados em 2026-11-08 (SF-208):* o detalhe da fila e o do gestor ganham o bloco "Horas", lido pela mesma equipe do checklist (atendentes e gestor do setor; o solicitante e outros setores recebem "não encontrado"): o total contra a estimativa do serviço quando houver ("2h de 4h estimadas"), o total por pessoa e os lançamentos não apagados, do dia mais recente para o mais antigo. O histórico do detalhe mostra "Horas lançadas", "alteradas" ou "apagadas" com a duração e o dia. Sem horas e sem poder lançar (por exemplo, o gestor numa solicitação sem horas), o bloco não aparece. Os formulários de lançar, alterar e apagar chegam na SF-210.
- *Esclarecimentos registrados em 2026-11-08 (SF-209):* o relatório fica em "Horas" na área do gestor (só o seu setor, como em "Análises") e na seção "Horas" da administração (toda a organização ou um setor). O período usa os mesmos filtros de "Análises" e conta cada lançamento pelo seu dia; o setor é o atual da solicitação; lançamentos apagados não contam. A tela mostra o total e as horas por atendente e por serviço (e por setor quando o administrador vê a organização inteira; aí cada atendente e serviço leva o nome do setor). O CSV tem um lançamento por linha, com as colunas fixas Dia, Atendente, Setor, Serviço, Solicitação (o código curto), Minutos e Horas (com vírgula decimal); não traz a nota do lançamento nem a descrição da solicitação, e é recusado acima de 10.000 linhas, como o CSV do painel.
- *Esclarecimentos registrados em 2026-11-08 (SF-210):* no detalhe da fila, o bloco "Horas" ganha "Lançar horas" (dia, de abertura a hoje, com hoje já escolhido; horas de 0 a 12; minutos de 0 a 59; nota opcional) para quem pode lançar agora, e "Alterar" e "Apagar" só nos lançamentos que a própria pessoa ainda pode mudar. Cada recusa tem a sua mensagem (dia fora do intervalo, duração inválida, nota longa, prazo ou situação da solicitação). O detalhe do gestor só mostra.

### 5.5 Critérios de aceitação

- [x] **CA-HRS-01** — Solicitações sem horas se comportam como hoje. *Verificado em 2026-11-08 (SF-206 a SF-210): sem horas e sem poder lançar, o detalhe não mostra o bloco e o histórico não muda; as suítes anteriores passaram sem mudar asserções (as exportações de "Análises" usadas pela tela das horas não mudaram por dentro).*
- [x] **CA-HRS-02** — Atendentes lançam, alteram e apagam horas com as regras 1 a 3; o total aparece na solicitação para a equipe e nunca para o solicitante. *Verificado em 2026-11-08 (SF-207, SF-208 e SF-210): qualquer atendente do setor lança; nunca em cancelada e até 7 dias depois da conclusão; só quem lançou altera e apaga, em até 7 dias; apagar marca o lançamento e o histórico fica; o bloco "Horas" mostra o total contra a estimativa, para a equipe (integração e E2E `time-entries.spec.ts`).*
- [x] **CA-HRS-03** — O relatório soma as horas por atendente, serviço e setor no período, respeita quem pode ver cada setor e exporta CSV. *Verificado em 2026-11-08 (SF-209 e SF-210): gestor no próprio setor, administrador na organização ou num setor; CSV com colunas fixas, sem nota nem descrição (unitário, integração e E2E).*
- [x] **CA-HRS-04** — Migration aditiva; nenhuma dependência nova. *Verificado em 2026-11-08 (SF-206): `20261108900000_time_entries` só cria um tipo, duas tabelas, uma coluna opcional, índices e restrições; `package.json` não mudou.*

## 6. Parte D — Seguidores

### 6.1 Escopo

1. **Seguir:** o solicitante inclui colegas (outros usuários com perfil Solicitante) que acompanham a solicitação; atendentes do setor podem seguir a solicitação para receber os avisos dela.
2. **Avisos:** seguidores recebem os mesmos avisos que o solicitante recebe sobre andamento e comentários públicos **(decisão I12)**.
3. **Leitura:** o colega seguidor lê a solicitação como o solicitante, sem poder agir nela **(decisão I13)**.

### 6.2 Fora de escopo

- Seguidores externos (sem conta); seguir um serviço ou um setor inteiro.
- Seguidor que comenta, cancela, reabre ou avalia.

### 6.3 Regras

1. **Incluir e retirar:** o solicitante inclui até 10 colegas ativos com perfil Solicitante e retira qualquer um; o colega pode deixar de seguir; o atendente do setor segue e deixa de seguir só a si mesmo.
2. **Leitura do colega:** vê os dados, o histórico e os comentários públicos (nunca os internos), os documentos e as respostas, como o solicitante; não vê dados que só a equipe vê. A lista "Minhas solicitações" ganha o filtro "Que eu acompanho" **(decisão I14)**.
3. **Avisos:** cada aviso enviado ao solicitante (mudança de status, comentário público, etapa) vai também aos seguidores colegas; o atendente seguidor recebe os avisos que a equipe recebe sobre aquela solicitação; as preferências de e-mail de cada pessoa valem como hoje.
4. **Histórico:** "Fulano passou a acompanhar" e "deixou de acompanhar".
5. **Anonimização:** a pessoa anonimizada deixa de seguir tudo.

### 6.4 Dados

- Nova tabela `RequestFollower` (`requestId`, `userId`, `addedById`, `createdAt`), única por (`requestId`, `userId`); nova tabela `RequestFollowerEvent`.
- *Esclarecimentos registrados em 2026-11-09 (SF-211):* `RequestFollowerEvent` guarda quem passou a acompanhar ou deixou de acompanhar (`ADDED`/`REMOVED`), quem fez e quando. A preferência "seguir ao comentar" (13.3 item 2) fica numa tabela própria, `FollowPreference` (uma linha por pessoa; sem linha, vale "ligada"), entrando nesta mesma migration para a parte D ter um só envio com backup; o modelo do usuário não muda. O limite de 10 colegas e quem pode ser seguidor são conferidos pelos casos de uso, em transações serializáveis. O solicitante não retira um atendente que segue (cada atendente deixa de seguir só a si mesmo); retirar quem não segue é conflito. Esta parte amplia quem lê uma solicitação (o colega seguidor, só leitura, decisão I13), sem mudar nenhuma outra regra de acesso nem a segurança da conta.
- *Esclarecimentos registrados em 2026-11-09 (SF-212):* (1) **Como escolher o colega:** o solicitante informa o e-mail exato do colega; não há lista de pessoas para solicitantes, para que ninguém descubra por aqui quem tem conta. Um e-mail desconhecido, de quem não é solicitante ou inativo recebe a mesma recusa, sem dizer qual é o caso. (2) **Leitura do colega por um caminho próprio:** o colega seguidor lê a solicitação por consultas novas e separadas (a solicitação com o histórico sem os salvamentos do atendimento, os comentários públicos, as respostas do formulário do solicitante e a lista de documentos), sem mudar nenhuma regra de acesso que já existe; os caminhos do próprio solicitante continuam só dele. (3) **Documentos:** o colega vê o nome, o formato e o tamanho de cada documento, mas não baixa o arquivo: o download tem regra de acesso própria, que esta SPEC não altera (redução registrada da regra 2, "os documentos ... como o solicitante"). (4) Quem acompanha é visto pelo solicitante, pelos colegas que seguem e pela equipe do setor.
- *Esclarecimentos registrados em 2026-11-09 (SF-213):* os avisos dos seguidores saem da mesma regra dos demais: cada aviso planejado para o solicitante vai também a cada colega que segue (o colega não recebe aviso dos comentários do próprio solicitante, que não vão ao solicitante); cada aviso planejado para a equipe (o responsável efetivo ou, nos alertas de prazo, o setor) vai também aos atendentes que seguem e ainda são do setor atual da solicitação (o de outro setor não recebe, porque um aviso da equipe pode falar de nota interna). Sem responsável, os avisos que hoje não vão a ninguém da equipe também não vão aos atendentes seguidores. O autor da ação nunca recebe o próprio aviso, ninguém recebe o mesmo aviso duas vezes, e o e-mail segue a preferência de cada pessoa. Pessoa inativa não recebe; a anonimizada deixa de seguir (as linhas de seguidor e a preferência de seguir ao comentar são apagadas; o histórico fica, com o nome já anonimizado).
- *Esclarecimentos registrados em 2026-11-09 (SF-214):* "Que eu acompanho" (decisão I14) é uma página própria, aberta por um link no alto de "Minhas solicitações", em vez de mais um critério da busca: a busca do solicitante lista só as solicitações dele, e as dos colegas são lidas pelo caminho próprio do colega (`/requests/following`). O bloco "Acompanham" aparece no detalhe do solicitante (incluir colega pelo e-mail, retirar colegas), da fila (acompanhar e deixar de acompanhar), do gestor (só leitura, adiantando parte do 13.3 item 3) e do colega (deixar de acompanhar, voltando à lista); só nomes, sem dados de contato.

### 6.5 Critérios de aceitação

- [x] **CA-SEG-01** — Solicitações sem seguidores se comportam como hoje. *Verificado em 2026-11-09 (SF-211 a SF-214): sem seguidores, os avisos são os mesmos (os testes de avisos que já existiam passaram sem mudança), o detalhe mostra "Ninguém acompanha" e o histórico não muda.*
- [x] **CA-SEG-02** — Inclusão e retirada seguem a regra 1 e ficam no histórico. *Verificado em 2026-11-09 (SF-211, SF-212 e SF-214): colega pelo e-mail, até 10; atendente só a si mesmo; o solicitante retira colegas; cada um deixa de seguir; "passou a acompanhar" e "deixou de acompanhar" no histórico (unitário, integração e E2E `followers.spec.ts`).*
- [x] **CA-SEG-03** — O colega seguidor lê a solicitação como o solicitante, sem comentários internos e sem poder agir; a lista ganha "Que eu acompanho". *Verificado em 2026-11-09 (SF-212 e SF-214): leitura por caminho próprio, sem notas internas, sem ações além de deixar de acompanhar, sem baixar documentos (registrado na SF-212); "Que eu acompanho" a partir de "Minhas solicitações" (integração e E2E).*
- [x] **CA-SEG-04** — Os avisos da regra 3 chegam aos seguidores, respeitando as preferências; a anonimização retira a pessoa. *Verificado em 2026-11-09 (SF-213): pela regra dos avisos e pelo processamento real dos eventos, com a preferência de e-mail de cada pessoa (unitário e integração).*
- [x] **CA-SEG-05** — Migration aditiva; nenhuma dependência nova. *Verificado em 2026-11-09 (SF-211): `20261109100000_request_followers` só cria um tipo, três tabelas, índices e chaves; `package.json` não mudou.*

## 7. Parte E — Menções em comentários internos

### 7.1 Escopo

1. **Mencionar:** num comentário interno, `@` seguido do nome de um colega do setor (atendente ou gestor) avisa essa pessoa.

### 7.2 Fora de escopo

- Menções em comentários públicos (o solicitante veria nomes da equipe); menções a pessoas de outros setores **(decisão I15)**.

### 7.3 Regras

1. **Escolha:** o formulário do comentário interno oferece "Mencionar" com a lista dos colegas ativos do setor da solicitação; as menções são guardadas pelos ids escolhidos, não pelo texto **(decisão I16)**; até 5 por comentário.
2. **Aviso:** cada pessoa mencionada recebe o aviso `comment.mention` (categoria "Comentários"), uma vez por comentário, mesmo se também receberia o de comentário interno; quem escreveu não é avisado.
3. **Exibição:** o comentário mostra "Menciona: Fulano, Beltrana".

### 7.4 Dados

- Nova tabela `CommentMention` (`commentId`, `userId`), única pelo par.
- *Esclarecimentos registrados em 2026-11-09 (SF-215):* a tabela guarda também quando a menção foi feita e quando a pessoa a viu (`seenAt`, para "Minhas menções", 13.4), já nesta migration para a parte E ter um só envio com backup; um `CHECK` impede que seja vista antes de existir. Mencionáveis são os atendentes ativos do setor da solicitação (ver a correção da seção 13.10); o autor que se menciona é ignorado; menção em comentário público, de outra pessoa ou acima de 5 recusa o comentário inteiro. O aviso `comment.mention` (categoria "Comentários") substitui, para a pessoa mencionada, o aviso de nota interna que ela receberia; quem segue a solicitação e não foi mencionado recebe o de nota interna; ninguém recebe dois avisos do mesmo comentário.
- *Esclarecimentos registrados em 2026-11-09 (SF-216):* o formulário de comentário da fila ganha "Mencionar", com uma caixa para cada colega atendente ativo do setor (sem a própria pessoa), visível só para quem escreve nota interna; escolher alguém sem marcar "Nota interna" recusa o comentário com uma mensagem própria. A nota mostra "Menciona: Fulano, Beltrana" logo abaixo do texto; o solicitante não vê notas internas, então não vê menções.

### 7.5 Critérios de aceitação

- [x] **CA-MEN-01** — Comentários sem menção se comportam como hoje. *Verificado em 2026-11-09 (SF-215 e SF-216): sem menção, os avisos são os mesmos (os testes de avisos e de comentários que já existiam passaram sem mudança) e a conversa não muda; o solicitante não vê o campo.*
- [x] **CA-MEN-02** — Só colegas ativos do setor podem ser mencionados, até 5, só em comentário interno; cada um recebe um aviso. *Verificado em 2026-11-09 (SF-215 e SF-216): só atendentes ativos do setor (correção da seção 13.10), até 5, só em nota interna; um aviso `comment.mention` por pessoa; a nota mostra "Menciona: ..." (unitário, integração e E2E `mentions.spec.ts`).*
- [x] **CA-MEN-03** — Migration aditiva; nenhuma dependência nova. *Verificado em 2026-11-09 (SF-215): `20261109200000_comment_mentions` só cria uma tabela com chaves, índice e `CHECK`; `package.json` não mudou.*

## 8. Parte F — Encerrar como duplicada

### 8.1 Escopo

1. **Encerrar como duplicada:** numa solicitação marcada como "duplicada de" outra (vínculo da SPEC 2026-11-07, parte A), o atendente a encerra como duplicada; o solicitante dela passa a acompanhar a original **(decisão I17)**.

### 8.2 Fora de escopo

- Mover comentários, anexos ou respostas da duplicada para a original (ficam onde estão, ligados pelo vínculo) **(decisão I18)**.
- Desfazer o encerramento (a reabertura segue a regra que já existe).

### 8.3 Regras

1. **Quem e quando:** quem pode cancelar a duplicada pelas regras atuais (atendente do setor, responsável ou supervisor), com o vínculo "duplicada de" já registrado e a original não cancelada.
2. **O que acontece, numa transação:** a duplicada é cancelada com a justificativa "Duplicada de #código" mais a nota do atendente; o solicitante da duplicada vira seguidor da original (parte D), se ainda não for o solicitante dela; o histórico das duas registra o encerramento; os avisos são os do cancelamento e o de "passou a acompanhar".
3. **Leitura:** o solicitante que passou a acompanhar a original lê a original como seguidor (regra 2 da parte D), sem ver os comentários internos.

### 8.4 Dados

- Sem tabelas novas: usa o cancelamento, o vínculo e os seguidores. O histórico do cancelamento ganha o motivo `DUPLICATE`.
- *Esclarecimentos registrados em 2026-11-09 (SF-217):* sem tabelas novas, como previsto; a migration `20261109300000_close_as_duplicate` acrescenta só a coluna opcional `reason` ao histórico de situação (valor `DUPLICATE`, aceito só em cancelamento, por `CHECK`) e a ação `CLOSED_AS_DUPLICATE` ao histórico dos vínculos, que aparece nas duas solicitações ("Encerrada como duplicada de #código" na duplicada; "Duplicada #código encerrada" na original). Encerra quem cancela hoje pelo lado da equipe (atendente do setor; com responsável, só ele); a nota do atendente é obrigatória, como no cancelamento pela equipe, e a justificativa gravada é "Duplicada de #código. <nota>". Sem o vínculo, ou com a original cancelada, é conflito. O solicitante da duplicada passa a seguir a original como colega ("passou a acompanhar" feito pelo atendente), exceto quando é também o solicitante da original.
- *Esclarecimentos registrados em 2026-11-09 (SF-218):* o sistema não tem aviso próprio de "passou a acompanhar" (a parte D registra a entrada só no histórico dos seguidores); por isso, quando o cancelamento tem o motivo `DUPLICATE`, o solicitante da duplicada recebe, no lugar do aviso do cancelamento, um único aviso `status.DUPLICATE` (categoria de status, "Encerrada como duplicada; você passa a acompanhar a original: <serviço>"), que cobre os dois. O motivo é lido do histórico da situação no momento do evento, sem mudar o conteúdo do evento `request.status_changed`. Na página da duplicada, o solicitante vê um atalho para a original pela página do colega (`/requests/following/<id>`), só enquanto a acompanha; a consulta é separada e não muda o que os caminhos do solicitante já mostram.
- *Esclarecimentos registrados em 2026-11-09 (SF-219):* no detalhe da fila, o bloco "Encerrar como duplicada" aparece junto de "Cancelar solicitação" (mesmas condições: aberta ou em atendimento, sem responsável que seja outro colega) e só quando a solicitação é "duplicada de" uma original não cancelada; mostra o código da original (com link quando o atendente pode lê-la), o serviço e o setor, e pede a nota obrigatória. Na original ("original de"), sem vínculo ou com a original cancelada, o bloco não aparece e a página é a de antes. O servidor confere tudo de novo.

### 8.5 Critérios de aceitação

- [x] **CA-DUP-01** — Solicitações sem vínculo de duplicada se comportam como hoje. *Verificado em 2026-11-09 (SF-217 a SF-219): sem o vínculo, a página e o cancelamento são os de antes, e o aviso de cancelamento não muda; as suítes anteriores passaram sem mudar asserções (unitário, integração e E2E).*
- [x] **CA-DUP-02** — O encerramento segue as regras 1 e 2, numa transação, com histórico nas duas solicitações e os avisos.
- [x] **CA-DUP-03** — O solicitante da duplicada acompanha a original sem ver dados internos.

## 9. Parte G — Complementos

### 9.1 Escopo e regras

1. **Configuração portátil:** o arquivo passa à versão 2, com as etiquetas de cada setor e o modelo de checklist de cada serviço; a importação aceita as versões 1 e 2, e a versão 1 continua igual ao que era **(decisão I19)**. As regras da SPEC 2026-11-07, parte D (prévia, tudo ou nada, auditoria, ida e volta igual) valem para os itens novos.
2. **API pública:** a leitura de uma solicitação passa a trazer as etiquetas, o checklist (itens, obrigatório, concluído) e o total de minutos apontados, para quem já pode ler a solicitação pela API **(decisão I20)**; a lista de operações e o documento da API são atualizados. Sem escrita pela API nesta SPEC.
3. **Análises de horas e de checklist:** em "Análises", para quem já vê as análises: horas apontadas no período (total, por setor e por serviço) e conclusão do checklist (solicitações concluídas com checklist completo, e os itens opcionais mais deixados sem marcar).

- *Esclarecimentos registrados em 2026-11-14 (SF-221):* o item 2 vale junto com as decisões I2, I6 e I9: entre quem lê a solicitação pela API, só a equipe do setor (atendentes e gestor do setor) recebe os dados novos, lidos pelos mesmos casos de uso dos blocos das telas. O detalhe (`GET /api/v1/requests/{id}` e as ações que devolvem o detalhe) ganha três campos: `tags` (identificador, nome, cor, se está ativa e se é de um setor anterior), `checklist` (marcados, total e os itens na ordem, cada um com texto, obrigatório, se está concluído, quando e por quem) e `minutesLogged` (total de minutos dos lançamentos não apagados). Para quem não é da equipe (o solicitante, ou o gestor que só decide uma aprovação de outro setor), os três vêm `null`, e não "não encontrada", porque a solicitação continua legível; `checklist` também é `null` para a solicitação sem itens de checklist (nunca copiado, ou copiado de um modelo vazio), como na tela, que não mostra o bloco. A listagem `GET /api/v1/requests` não muda. Não há operação nova: a lista de operações fica igual, e o documento OpenAPI e o README descrevem os campos.
- *Esclarecimentos registrados em 2026-11-14 (SF-222):* as horas de "Análises" seguem as regras do relatório de horas (SF-209): cada lançamento não apagado conta pelo seu dia, no período escolhido no alto de "Análises", e pertence ao setor atual da solicitação; o escopo é o de "Análises" (o gestor, o próprio setor; o administrador, a organização ou um setor). O bloco "Horas apontadas" fica depois de "Etiquetas" e só aparece quando há horas no período: o total, as horas por setor (só quando o administrador vê a organização inteira, porque com um setor seria uma linha igual ao total) e por serviço (com o nome do setor quando a organização inteira é vista), cada linha com as horas e o número de lançamentos, das mais horas para as menos. Um link leva ao relatório de horas com o mesmo período e setor, onde ficam as horas por atendente, por etiqueta, a estimativa e o CSV; "Análises" não repete esses dados nem ganha CSV.

### 9.2 Critérios de aceitação

- [x] **CA-CMP-01** — A configuração portátil exporta e importa etiquetas e modelos de checklist com as regras da parte D da SPEC anterior; um arquivo da versão 1 continua sendo aceito; ida e volta dá "igual". *Verificado em 2026-11-14 (SF-220): a exportação escreve a versão 2 com as etiquetas e o checklist; a importação aceita as versões 1 e 2 (a 1 deixa etiquetas e checklists do destino como estão); prévia, regras das telas, tudo ou nada e auditoria valem para os itens novos; reimportar o arquivo exportado dá "igual" em tudo (integração). Nomes de etiqueta e textos de checklist repetidos seguem a regra da SF-187: a exportação os lista e a importação os recusa.*
- [x] **CA-CMP-02** — A API traz etiquetas, checklist e total de horas na leitura da solicitação, sem mudar as demais respostas. *Verificado em 2026-11-14 (SF-221): o detalhe traz `tags`, `checklist` e `minutesLogged` para atendentes e gestor do setor, e `null` nos três para o solicitante e para o gestor que só decide uma aprovação de outro setor; as ações devolvem o mesmo detalhe; a listagem e os demais campos não mudaram (unitário, integração e os E2E da API, com as suítes anteriores passando sem mudar asserções).*
- [ ] **CA-CMP-03** — "Análises" mostra as horas e a conclusão do checklist no período, só quando houver dados.

## 10. Decisões tomadas (2026-11-08)

Adotadas como recomendadas; a responsável pode revê-las antes do início de cada parte.

| # | Questão | Decisão | Alternativa descartada |
|---|---|---|---|
| I1 | Escopo das etiquetas | Por setor | Globais (um setor veria a classificação do outro) |
| I2 | Etiquetas e o solicitante | Só a equipe vê | Visíveis ao solicitante (expõe classificação interna) |
| I3 | Cores | Paleta fixa de 8, com contraste conferido | Cor livre (contraste não garantido) |
| I4 | Etiquetas ao encaminhar | Ficam, acinzentadas, até o novo setor retirar | Retiradas automaticamente (perde informação) |
| I5 | Quando o checklist é copiado | Na entrada em atendimento | Na abertura (o modelo pode mudar até alguém atender) |
| I6 | Checklist e o solicitante | Só a equipe vê | Visível ao solicitante |
| I7 | Mudança do modelo | Não altera checklists já copiados | Atualizar todos (mudaria o que já foi conferido) |
| I8 | Obrigatórios na conclusão | Recusa a conclusão | Só avisa |
| I9 | Horas e o solicitante | Só a equipe vê | Visíveis ao solicitante |
| I10 | Horas depois da conclusão | Até 7 dias | Só antes de concluir (horas lançadas depois se perderiam) |
| I11 | Apagar horas | Marca como apagada (o histórico fica) | Apagar a linha |
| I12 | Avisos dos seguidores | Os mesmos do solicitante (ou da equipe, para atendentes) | Avisos próprios |
| I13 | Poderes do seguidor | Só leitura | Comentar e agir |
| I14 | Lista do seguidor | Filtro "Que eu acompanho" em "Minhas solicitações" | Página nova |
| I15 | Alcance das menções | Só comentário interno, colegas do setor | Também público e outros setores |
| I16 | Como guardar a menção | Pelos ids escolhidos | Interpretar o texto `@nome` |
| I17 | Encerrar como duplicada | Cancela a duplicada e o solicitante passa a seguir a original | Mesclar as duas numa só |
| I18 | Conteúdo da duplicada | Fica onde está, ligado pelo vínculo | Mover comentários e anexos |
| I19 | Versão da configuração portátil | Versão 2, aceitando a 1 | Mudar a versão 1 |
| I20 | API | Só leitura dos dados novos | Também escrita |
| I21 | Etiquetas no lote | Duas ações novas: etiquetar e retirar | Fora do lote |
| I22 | Seguidor que é atendente | Segue só a si mesmo | Incluir colegas |
| I23 | Auditoria | Etiquetas e modelos de checklist (configuração) | Também horas e seguidores (são do atendimento, ficam no histórico) |
| I24 | Ordem das partes | A → B → C → D → E → F → G | Outra |

## 11. Testes

Cada parte segue o padrão das SPECs anteriores, em três camadas:
- **Unitários:** validações de etiquetas, checklist, horas e seguidores; regra de conclusão; normalização dos critérios com etiqueta; leitura do seguidor; formato 2 da configuração; respostas da API.
- **Integração (banco real):** schema e `CHECK`s; casos de uso com perfis e setores; conclusão recusada pelo checklist; encerramento como duplicada numa transação; avisos aos seguidores e às pessoas mencionadas; ida e volta da configuração versão 2; auditoria.
- **E2E:** um percurso por parte, pela tela.

## 12. Tarefas

| Tarefa | Parte | Conteúdo |
|---|---|---|
| SF-194 | A | Migrations e domínio das etiquetas |
| SF-195 | A | Cadastro das etiquetas (administração e gestor) com auditoria |
| SF-196 | A | Aplicar e retirar na solicitação, histórico e evento |
| SF-197 | A | Busca, visões salvas e lote com etiquetas |
| SF-198 | A | Etiquetas em "Análises" |
| SF-199 | A | Telas da fila com etiquetas e E2E |
| SF-200 | B | Migrations e domínio do checklist |
| SF-201 | B | Modelo de checklist por serviço com auditoria |
| SF-202 | B | Cópia na entrada em atendimento |
| SF-203 | B | Marcar e desmarcar, histórico |
| SF-204 | B | Regra da conclusão |
| SF-205 | B | Telas do checklist e E2E |
| SF-206 | C | Migrations e domínio das horas |
| SF-207 | C | Lançar, alterar e apagar horas |
| SF-208 | C | Totais na solicitação |
| SF-209 | C | Relatório de horas e CSV |
| SF-210 | C | Telas das horas e E2E |
| SF-211 | D | Migrations e domínio dos seguidores |
| SF-212 | D | Incluir, retirar e leitura do seguidor |
| SF-213 | D | Avisos aos seguidores e anonimização |
| SF-214 | D | Telas dos seguidores e E2E |
| SF-215 | E | Migration, domínio e avisos das menções |
| SF-216 | E | Telas das menções e E2E |
| SF-217 | F | Domínio e caso de uso do encerramento como duplicada |
| SF-218 | F | Histórico, avisos e leitura da original |
| SF-219 | F | Telas do encerramento como duplicada e E2E |
| SF-220 | G | Configuração portátil versão 2 (etiquetas e checklist) |
| SF-221 | G | API pública: etiquetas, checklist e horas |
| SF-222 | G | Análises de horas |
| SF-223 | G | Análises de checklist e revisão final da SPEC |

**Ordem:** A → B → C → D → E → F → G (decisão I24). A parte F depende da D (o solicitante da duplicada passa a seguir a original); a G depende de A, B e C. Cada parte termina com todas as suítes aprovadas e com registro em `NOTES.md` das linhas novas (aplicação e testes, separadas).

**Estimativa:** cerca de 30 tarefas × 630 linhas (média real medida na SPEC 2026-11-07: 11.903 linhas em 19 tarefas) ≈ **18.900 linhas** pelo `cloc`, com margem de ±20%. Com a contagem de 72.773 linhas em 2026-11-08, esta SPEC leva o projeto a algo entre 87.900 e 95.400; a SPEC 2 (itens 7 a 10 do levantamento: avisos e manutenção programada, importação de usuários por CSV, relatório periódico e calendário por setor, cerca de 10.000 linhas) completa a meta de 100.000. Por pedido da responsável ("deixe a spec 2 para quando a spec 1 estiver perto do fim, me avise e revisamos"), a SPEC 2 só será escrita perto do fim desta, depois de revisada com ela.

**Lembrete registrado:** ao passar de 99.000 linhas `added`, lembrar a responsável da escolha entre a conexão direta e o pooling do Neon.

## 13. Aprofundamento das partes B a F (2026-11-08)

**Registro da mudança de escopo.** A parte A entregou cerca de 1.630 linhas em 6 tarefas (cerca de 270 por tarefa, contra a média de 630 usada na estimativa), porque o código existente já resolvia boa parte do trabalho. Diante disso, a responsável escolheu aprofundar as partes que faltam ("vamos prosseguir pela opção 2"): mais regras e telas onde a SPEC já previa espaço, sempre registradas aqui antes de implementar. Cada acréscimo abaixo resolve um uso real do atendimento e segue o padrão de regras que já existem no sistema; vale a mesma garantia da seção 2 (quem não usa não percebe mudança) e a mesma exclusão de segurança da conta e de acesso. As decisões J1 a J10 foram adotadas como recomendadas e podem ser revistas pela responsável antes de cada parte.

### 13.1 Parte B — Checklist (acréscimos)

1. **Itens condicionais (decisão J1):** um item do modelo pode depender da resposta a um campo do serviço, com a mesma regra das condições das etapas (campo ativo do formulário do solicitante, do tipo escolha, e um valor entre as opções); na cópia, o item só entra se a resposta da solicitação atender à condição.
2. **Copiar o modelo de outro serviço (decisão J2):** na configuração do checklist, "Copiar de outro serviço" acrescenta os itens ativos do outro serviço ao fim do modelo (sem as condições, que apontam para campos do outro serviço), respeitando o limite de 20 itens; entra na auditoria.
3. **Progresso:** a lista da fila mostra "Checklist 3/5" (marcados sobre o total) nas solicitações que têm checklist; o detalhe mostra os obrigatórios pendentes em destaque.
4. **Observação no item (decisão J3):** ao marcar um item, o atendente pode escrever uma observação curta (até 200 caracteres), que aparece no checklist e no histórico.

- [x] **CA-CHK-06** — Itens condicionais entram na cópia só quando a resposta atende à condição; a condição segue as regras das etapas. *Verificado em 2026-11-08 (SF-202 e SF-224): a lista "Aplica-se" só oferece os campos aceitos pelas etapas e a mesma validação recusa os outros; a cópia avalia as respostas da abertura; o campo usado fica protegido como nas etapas (unitário e integração).*
- [x] **CA-CHK-07** — Copiar de outro serviço acrescenta os itens ativos sem condição, dentro do limite, com auditoria; a fila mostra o progresso; a observação do item fica no checklist e no histórico. *Verificado em 2026-11-08 (SF-203, SF-205, SF-225 e SF-226): cópia ao fim, sem condições, tudo ou nada no limite, uma entrada de auditoria por item; "Checklist 1/2" na lista da fila; a observação aparece no bloco e no histórico (unitário, integração e E2E `checklists.spec.ts`).*
- *Esclarecimentos registrados em 2026-11-08 (SF-224):* a condição se escolhe no bloco "Alterar" de cada item, numa lista "Aplica-se" com "Sempre" e cada valor dos campos que podem ser condição (os mesmos das etapas: campo ativo do formulário do solicitante, de lista, sim ou não ou múltipla escolha, sem condição própria); a tabela mostra "Sempre" ou "Quando "campo" for "valor"". Mudar a condição entra na auditoria e só vale para as solicitações que entrarem em atendimento depois (decisão I7). Como nas etapas, um campo usado por item ativo não é desativado, não perde a opção usada e não muda de público; item desativado libera o campo, e um item só é reativado com o campo da sua condição ativo.
- *Esclarecimentos registrados em 2026-11-08 (SF-225):* "Copiar de outro serviço" fica no bloco de cada serviço, com a lista dos outros serviços da tela que têm itens ativos; a origem precisa ser um serviço que a pessoa também configura (o gestor copia entre os serviços do seu setor; o administrador, entre quaisquer serviços ativos), para que ninguém leia por aqui o checklist de outro setor. Os itens entram no fim, na ordem da origem, com texto e "obrigatório" e sem condição; cada um tem sua entrada "criado" na auditoria. Se a cópia passar de 20 itens ativos, nada é acrescentado; a origem não muda.
- *Esclarecimentos registrados em 2026-11-08 (SF-226):* o progresso aparece na lista da fila do atendente, abaixo da situação do prazo, só nas solicitações do seu setor que têm itens no checklist ("Checklist 1/2": marcados sobre o total, obrigatórios e opcionais); é lido numa consulta agrupada para a página inteira. A observação do item (13.1 item 4) já foi entregue nas SF-203 e SF-205.

### 13.2 Parte C — Apontamento de horas (acréscimos)

1. **Estimativa por serviço (decisão J4):** o serviço pode ter uma estimativa de horas de atendimento (de 1 a 200 horas, opcional, com auditoria); a solicitação mostra o total apontado contra a estimativa ("3h de 4h estimadas") e o relatório mostra, por serviço, a média apontada nas solicitações concluídas contra a estimativa.
2. **"Minhas horas" (decisão J5):** o painel do atendente ("Meu painel") ganha as horas que ele apontou no período, por dia e por serviço.
3. **Horas por etiqueta:** o relatório de horas soma as horas também por etiqueta (uma solicitação com duas etiquetas conta nas duas, como em "Análises").

- [x] **CA-HRS-05** — A estimativa do serviço é configurável com auditoria e aparece na solicitação e no relatório. *Verificado em 2026-11-09 (SF-206, SF-208 e SF-227): campo "Estimativa de atendimento (horas)" no cadastro do serviço, de 1 a 200 ou vazio, na auditoria do serviço; "3h de 4h estimadas" na solicitação; média apontada contra a estimativa no relatório (unitário e integração).*
- *Esclarecimentos registrados em 2026-11-09 (SF-227):* a estimativa fica no formulário do serviço, ao lado do prazo-base, na administração e em "Serviços do setor" (as mesmas telas e regras de quem edita o serviço); campo vazio é "sem estimativa" e formulário sem o campo mantém o valor, como o prazo-base. No relatório de horas, a tabela "Média apontada contra a estimativa" considera as solicitações concluídas no período que têm horas lançadas (as sem horas não entram na média), com a estimativa atual do serviço; serviços sem estimativa aparecem com "—".
- [x] **CA-HRS-06** — "Meu painel" mostra as horas do atendente no período; o relatório soma também por etiqueta. *Verificado em 2026-11-09 (SF-228): bloco "Minhas horas" em "Meu painel", por dia e por serviço, só com as horas da própria pessoa; tabela "Horas por etiqueta" no relatório, uma solicitação com duas etiquetas contando nas duas (unitário, integração e E2E).*
- *Esclarecimentos registrados em 2026-11-09 (SF-228):* "Minhas horas" usa o período escolhido no alto de "Meu painel" e soma os lançamentos da própria pessoa pelo dia de cada um, em qualquer solicitação (inclusive de um setor anterior); só o atendente tem o bloco. No relatório, as horas por etiqueta usam as etiquetas que a solicitação tem agora, no escopo de quem vê (com o nome do setor quando o administrador vê a organização inteira); sem etiquetas, a tabela não aparece.

### 13.3 Parte D — Seguidores (acréscimos)

1. **"Acompanhando" na fila (decisão J6):** a fila ganha o filtro "Que eu acompanho", com as solicitações que o atendente segue, inclusive as de outro setor que ele seguiu antes de serem encaminhadas (só os dados que a leitura permite).
2. **Seguir ao comentar (decisão J7):** o atendente que escreve um comentário numa solicitação passa a segui-la automaticamente, se ainda não segue; a preferência "Seguir automaticamente as solicitações em que comento" (ligada por padrão) fica em "Notificações" e pode ser desligada.
3. **Seguidores na tela da equipe:** o detalhe da fila e do gestor mostra quem acompanha a solicitação (nomes), sem dados de contato.

- [x] **CA-SEG-06** — O filtro "Que eu acompanho" da fila mostra só o que a pessoa segue e pode ler; seguir ao comentar respeita a preferência; a equipe vê quem acompanha. *Verificado em 2026-11-09 (SF-214, SF-229 e SF-230): filtro só com as solicitações do setor que a pessoa segue, as de outro setor à parte e sem link; o atendente que comenta passa a seguir, salvo com a preferência desligada; nomes de quem acompanha nas telas da equipe (integração e E2E).*
- *Esclarecimentos registrados em 2026-11-09 (SF-229):* "Que eu acompanho" é uma caixa da busca da fila (parâmetro `following=1`, guardado nas visões salvas e nos links de página), só para o atendente; filtra as solicitações do setor que ele segue. As que ele segue e foram encaminhadas para outro setor aparecem à parte, em "Acompanho em outros setores", só com o código curto, o serviço, a situação e o setor atual, sem link: o detalhe é do setor atual, e as regras de leitura não mudam. A lista do solicitante ignora o parâmetro. Os nomes de quem acompanha na tela da equipe (13.3 item 3) chegaram com a SF-214.
- *Esclarecimentos registrados em 2026-11-09 (SF-230):* seguir ao comentar vale para qualquer comentário do atendente (público ou nota interna), na mesma transação do comentário, e entra no histórico como "passou a acompanhar" feito pela própria pessoa; quem já segue não ganha outra linha. A preferência fica em "Notificações > Preferências" do atendente, abaixo das de e-mail; sem escolha salva, vale "ligada". Comentários do solicitante não mudam nada (ele já recebe os avisos da própria solicitação).

### 13.4 Parte E — Menções (acréscimos)

1. **"Minhas menções" (decisão J8):** a área do atendente e a do gestor ganham a lista das menções recebidas (solicitação, quem mencionou, quando, lida ou não), ligada à notificação; abrir a solicitação marca a menção como vista.
2. **Gestor também menciona:** o gestor do setor, que já escreve comentários internos, pode mencionar os atendentes do setor.

- [x] **CA-MEN-04** — "Minhas menções" lista as menções recebidas, marca como vistas ao abrir e respeita quem pode ler cada solicitação. *Verificado em 2026-11-09 (SF-231): só na área do atendente (correção da seção 13.10), com as menções das solicitações do setor atual dele, da mais recente para a mais antiga; "Abrir" marca como vista uma vez e leva à conversa; o menu mostra quantas faltam ver (unitário, integração e E2E `mentions.spec.ts`).*
- *Esclarecimentos registrados em 2026-11-09 (SF-231):* "Minhas menções" fica em `/queue/mentions`, com até as 50 menções mais recentes; as de solicitações que foram para outro setor somem da lista, porque o atendente não as lê mais. A menção é marcada como vista ao ser aberta pela lista (uma ação explícita); abrir a solicitação por outro caminho, como a notificação, não a marca. A notificação `comment.mention` continua levando à solicitação, como as demais.

### 13.5 Parte F — Duplicadas (acréscimos)

1. **Possíveis duplicadas (decisão J9):** o detalhe da fila mostra, para a equipe, até 5 solicitações do mesmo solicitante e do mesmo serviço abertas nos 7 dias anteriores ou posteriores e ainda não encerradas, com atalho para vincular como duplicada.
2. **Encerrar como duplicada no lote (decisão J10):** o lote ganha "Encerrar como duplicada de", que pede o código da original e a nota; cada item exige o vínculo "duplicada de" com essa original (criado na hora, se ainda não existir, pelas regras dos vínculos) e segue a regra 8.3.

- *Esclarecimentos registrados em 2026-11-09 (SF-232):* "abertas" conta a data de abertura de cada uma, até 7 dias (168 horas) antes ou depois da abertura desta; "ainda não encerradas" quer dizer abertas ou em atendimento (concluídas e canceladas ficam de fora); solicitações sem serviço (serviço removido) não têm sugestões; as já vinculadas a esta, por qualquer tipo de vínculo, saem da lista; a ordem é a mais próxima no tempo primeiro (no empate, a mais antiga). A lista aparece no detalhe da fila só para atendentes que leem a solicitação (o solicitante e o gestor não a recebem); uma sugestão de outro setor aparece sem link. O atalho "Vincular esta como duplicada de #código" usa o formulário de vínculos, com as mesmas regras e recusas, e só aparece com esta aberta ou em atendimento e ainda sem original.
- *Esclarecimentos registrados em 2026-11-09 (SF-233):* no lote, a ação "Encerrar como duplicada de" pede o código da original e a nota, iguais para todos os itens. Antes de qualquer item, a nota é conferida (1 a 1.000 caracteres) e a original também (uma solicitação que o atendente lê e que não está cancelada); se uma das duas falhar, o lote inteiro é recusado e nada muda. Depois, item a item, cada um na sua transação: o vínculo "duplicada de" com essa original é criado pelas regras dos vínculos, se ainda não existir (se já existir, nada é gravado), e o encerramento segue a regra 8.3 (quem pode cancelar, a nota, o solicitante seguindo a original, os avisos). O vínculo e o encerramento são duas transações: se o encerramento de um item for recusado (por exemplo, ele tem outro responsável), o vínculo criado para ele fica, como se o atendente o tivesse feito pelo formulário, e o resultado diz "recusado". A própria original, um item que já é duplicada ou original de outra, ou que já tem 10 vínculos, é recusado com o motivo "é a própria original, já está vinculada a outra de outro jeito, tem 10 vínculos ou não pode ser encerrada agora"; os motivos das outras ações do lote não mudam.
- [x] **CA-DUP-04** — As possíveis duplicadas aparecem com o critério da regra 1, só para a equipe; o lote encerra como duplicada item a item, com resultado por item. *Verificado em 2026-11-09 (SF-232 e SF-233): sugestões só para a equipe, pelo critério da regra 1; o lote confere a original e a nota uma vez, vincula quando falta e encerra cada item pela regra 8.3, com o resultado de cada um (unitário, integração `possible-duplicates.test.ts` e `batch-duplicate.test.ts`, E2E `close-as-duplicate.spec.ts`).*

### 13.6 Decisões (2026-11-08)

| # | Questão | Decisão | Alternativa descartada |
|---|---|---|---|
| J1 | Item condicional | Mesma regra das condições das etapas | Condição própria (outra regra para aprender) |
| J2 | Copiar modelo | Acrescenta ao fim, sem condições | Substituir o modelo (apagaria itens) |
| J3 | Observação no item | Opcional, até 200 caracteres | Obrigatória |
| J4 | Estimativa | Por serviço, em horas inteiras | Por solicitação |
| J5 | Horas do atendente | Em "Meu painel" | Página nova |
| J6 | "Acompanhando" na fila | Filtro da busca | Página separada |
| J7 | Seguir ao comentar | Automático, com preferência para desligar | Só manual |
| J8 | Menções recebidas | Lista própria ligada às notificações | Só a notificação |
| J9 | Possíveis duplicadas | Mesmo solicitante e serviço, ±7 dias, não encerradas | Semelhança de texto (cara e imprecisa) |
| J10 | Duplicadas no lote | Uma original para todos os itens | Uma original por item |

### 13.7 Tarefas acrescentadas

| Tarefa | Parte | Conteúdo |
|---|---|---|
| SF-224 | B | Itens condicionais do checklist |
| SF-225 | B | Copiar o modelo de outro serviço |
| SF-226 | B | Progresso do checklist na fila e observação no item |
| SF-227 | C | Estimativa de horas por serviço |
| SF-228 | C | "Minhas horas" no painel e horas por etiqueta |
| SF-229 | D | "Que eu acompanho" na fila e seguidores na tela da equipe |
| SF-230 | D | Seguir ao comentar, com a preferência |
| SF-231 | E | "Minhas menções" e menções do gestor |
| SF-232 | F | Possíveis duplicadas |
| SF-233 | F | Encerrar como duplicada no lote |

**Ordem:** cada tarefa acrescentada entra no fim da sua parte (por exemplo, SF-224 a SF-226 depois da SF-205 e antes da parte C). **Estimativa revista:** pela média real da parte A (cerca de 270 linhas por tarefa) e com os acréscimos (que têm mais telas e regras próprias), a SPEC 1 deve somar algo entre 11.000 e 14.000 linhas; o que faltar para as 100.000 será tratado na revisão da SPEC 2, perto do fim desta.

### 13.8 Ajuste de um teste antigo (2026-11-09)

**Registro da mudança.** A pedido da responsável ("corrija o teste antigo"), o E2E `tests/e2e/dashboard.spec.ts` (SF-101) passa a localizar o alerta do período recusado pelo próprio texto (`getByRole("alert").filter({ hasText: "A data de início" })`) em vez de qualquer alerta da página. Motivo: depois da hidratação, o Next.js põe na página o anunciador de rotas (`__next-route-announcer__`), que também tem `role="alert"`; quando a página hidratava antes da asserção, o teste encontrava dois alertas e falhava (visto na rodada completa da SF-210; o teste passava sozinho). O que o teste confere não muda: a mesma mensagem, com o mesmo texto completo. É a única exceção à garantia da seção 2 feita nesta SPEC fora das listas exatas que ela estende; nenhum comportamento do sistema muda.

### 13.9 Ajuste de um teste antigo pelo seguir ao comentar (2026-11-09)

**Registro da mudança.** Com o seguir ao comentar ligado por padrão (decisão J7), o atendente que comenta passa a seguir a solicitação e, depois de uma transferência, recebe os avisos da equipe como seguidor. O teste de integração `notifications.test.ts` ("notifies the right people and never the author", CA-EVT-06), que espera que a atendente que comentou e transferiu não receba aviso, passou a desligar a preferência dessa atendente no início, para continuar conferindo a regra original; as asserções não mudaram. O comportamento novo (a atendente que seguiu ao comentar recebe o aviso da resposta do solicitante depois da transferência) é conferido em `follow-on-comment.test.ts`.

### 13.10 Correção da parte E: o gestor não menciona nem é mencionado (2026-11-09)

**Registro da mudança.** A regra 7.1 ("colega do setor, atendente ou gestor") e o 13.4 item 2 ("o gestor do setor, que já escreve comentários internos") partiam de uma premissa errada: no sistema, só os atendentes do setor leem e escrevem comentários internos (decisão C3 de uma SPEC anterior); o gestor não lê nem escreve comentários. Mencionar o gestor o avisaria de uma nota que ele não pode ler, e deixá-lo mencionar exigiria dar a ele acesso aos comentários internos. Consultada, a responsável escolheu manter as regras de acesso: **as menções são só entre os atendentes ativos do setor**; o gestor não menciona nem é mencionado, e "Minhas menções" (13.4 item 1) fica só na área do atendente. O 13.4 item 2 sai do escopo; o CA-MEN-04 passa a valer para o atendente.
