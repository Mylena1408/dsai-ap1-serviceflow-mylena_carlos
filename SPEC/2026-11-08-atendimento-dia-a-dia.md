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

### 4.5 Critérios de aceitação

- [ ] **CA-CHK-01** — Serviço sem modelo de checklist e solicitações antigas se comportam como hoje.
- [ ] **CA-CHK-02** — O modelo é configurado com os limites da regra 1 e entra na auditoria; mudá-lo não altera checklists já copiados.
- [ ] **CA-CHK-03** — O checklist é copiado uma vez, na entrada em atendimento; marcar e desmarcar seguem a regra 3 e ficam no histórico.
- [ ] **CA-CHK-04** — A conclusão com itens obrigatórios por marcar é recusada, com a lista do que falta; concluída a solicitação, o checklist não muda mais.
- [ ] **CA-CHK-05** — Migration aditiva; nenhuma dependência nova.

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

### 5.5 Critérios de aceitação

- [ ] **CA-HRS-01** — Solicitações sem horas se comportam como hoje.
- [ ] **CA-HRS-02** — Atendentes lançam, alteram e apagam horas com as regras 1 a 3; o total aparece na solicitação para a equipe e nunca para o solicitante.
- [ ] **CA-HRS-03** — O relatório soma as horas por atendente, serviço e setor no período, respeita quem pode ver cada setor e exporta CSV.
- [ ] **CA-HRS-04** — Migration aditiva; nenhuma dependência nova.

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

### 6.5 Critérios de aceitação

- [ ] **CA-SEG-01** — Solicitações sem seguidores se comportam como hoje.
- [ ] **CA-SEG-02** — Inclusão e retirada seguem a regra 1 e ficam no histórico.
- [ ] **CA-SEG-03** — O colega seguidor lê a solicitação como o solicitante, sem comentários internos e sem poder agir; a lista ganha "Que eu acompanho".
- [ ] **CA-SEG-04** — Os avisos da regra 3 chegam aos seguidores, respeitando as preferências; a anonimização retira a pessoa.
- [ ] **CA-SEG-05** — Migration aditiva; nenhuma dependência nova.

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

### 7.5 Critérios de aceitação

- [ ] **CA-MEN-01** — Comentários sem menção se comportam como hoje.
- [ ] **CA-MEN-02** — Só colegas ativos do setor podem ser mencionados, até 5, só em comentário interno; cada um recebe um aviso.
- [ ] **CA-MEN-03** — Migration aditiva; nenhuma dependência nova.

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

### 8.5 Critérios de aceitação

- [ ] **CA-DUP-01** — Solicitações sem vínculo de duplicada se comportam como hoje.
- [ ] **CA-DUP-02** — O encerramento segue as regras 1 e 2, numa transação, com histórico nas duas solicitações e os avisos.
- [ ] **CA-DUP-03** — O solicitante da duplicada acompanha a original sem ver dados internos.

## 9. Parte G — Complementos

### 9.1 Escopo e regras

1. **Configuração portátil:** o arquivo passa à versão 2, com as etiquetas de cada setor e o modelo de checklist de cada serviço; a importação aceita as versões 1 e 2, e a versão 1 continua igual ao que era **(decisão I19)**. As regras da SPEC 2026-11-07, parte D (prévia, tudo ou nada, auditoria, ida e volta igual) valem para os itens novos.
2. **API pública:** a leitura de uma solicitação passa a trazer as etiquetas, o checklist (itens, obrigatório, concluído) e o total de minutos apontados, para quem já pode ler a solicitação pela API **(decisão I20)**; a lista de operações e o documento da API são atualizados. Sem escrita pela API nesta SPEC.
3. **Análises de horas e de checklist:** em "Análises", para quem já vê as análises: horas apontadas no período (total, por setor e por serviço) e conclusão do checklist (solicitações concluídas com checklist completo, e os itens opcionais mais deixados sem marcar).

### 9.2 Critérios de aceitação

- [ ] **CA-CMP-01** — A configuração portátil exporta e importa etiquetas e modelos de checklist com as regras da parte D da SPEC anterior; um arquivo da versão 1 continua sendo aceito; ida e volta dá "igual".
- [ ] **CA-CMP-02** — A API traz etiquetas, checklist e total de horas na leitura da solicitação, sem mudar as demais respostas.
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
