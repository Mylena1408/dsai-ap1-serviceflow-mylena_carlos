# SPEC — Campos condicionais, seleção múltipla e campos do atendimento

**Data:** 2026-11-03
**Status:** Aprovada em 2026-11-03: a responsável aprovou a funcionalidade 8 ("campos condicionais, seleção múltipla e campos do atendente") da lista de pendências; as decisões K1 a K10 da seção 11 foram adotadas como recomendadas, e podem ser revistas por ela.
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-11-01-campos-personalizados.md` (seção 4: "campos condicionais", "seleção múltipla" e "campos preenchidos pelo atendente durante o atendimento" fora de escopo; regras 5.1 a 5.5), `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md` (responsável efetivo), `SPEC/2026-11-01-permissoes-configuraveis.md` (supervisão da fila e "Gerir serviços do setor"), `SPEC/2026-11-02-auditoria-lgpd.md`, `SPEC/2026-11-02-api-externa-webhooks.md`

## 1. Objetivo

Deixar os formulários dos serviços mais úteis em três pontos que a SPEC de campos personalizados deixou de fora:

1. **Seleção múltipla:** o solicitante marca uma ou mais opções de uma lista.
2. **Campos condicionais:** um campo só aparece, e só é exigido, quando outro campo tem uma resposta escolhida.
3. **Campos do atendimento:** campos que a equipe preenche durante o atendimento (por exemplo, "Número da ordem de serviço", "Peça trocada"), e não o solicitante na abertura.

## 2. Registro da mudança de escopo

A SPEC de campos personalizados (seção 4) deixou fora de escopo "campos condicionais", "seleção múltipla" e "campos preenchidos pelo atendente durante o atendimento"; a seção 9 previu que poderiam virar SPECs próprias. Esta é essa SPEC. Pela garantia 7.4 do plano de escala, **um serviço que não usa nada disto se comporta exatamente como hoje**.

## 3. Escopo

1. Tipo de campo novo **"Seleção múltipla"** **(decisão K1)**.
2. **Condição** opcional por campo: "mostrar só quando o campo *X* for (ou contiver) *V*" **(decisões K2 a K4)**.
3. **Público** do campo: "Solicitante, na abertura" (padrão, como hoje) ou "Atendimento" **(decisões K5 a K7)**.
4. Formulário "Informações do atendimento" no detalhe da fila, histórico e regra de conclusão.
5. Telas da administração, detalhe, API, anonimização e "Meus dados" ajustados.

## 4. Fora de escopo

- Condições com mais de um critério, operadores além de "igual a" e "contém", ou encadeadas (um campo condicionado por outro campo condicionado) (decisão K2).
- Campos do atendimento preenchidos ou lidos pelo solicitante (decisão K6).
- Editar campos do atendimento pela API: a API só os mostra, para a equipe.
- Limites de quantidade de opções marcadas na seleção múltipla.
- Notificações, eventos de domínio ou webhooks sobre campos do atendimento.
- Usar respostas em buscas, filtros ou relatórios (continua fora, como na SPEC de campos).
- Dados fictícios novos (decisão K10).

## 5. Regras

### 5.1 Seleção múltipla **(decisão K1)**

1. Configuração igual à da lista de opções: 2 a 20 opções, cada uma com até 80 caracteres, sem repetição (sem distinguir maiúsculas e minúsculas).
2. Na tela: uma caixa de seleção por opção.
3. Valor aceito: uma ou mais das opções vigentes, sem repetição. Num campo obrigatório, ao menos uma. Nenhuma marcada num campo opcional não gera resposta.
4. A resposta guarda as opções marcadas **na ordem configurada**, como lista JSON em texto (por exemplo, `["Mouse","Teclado"]`), com o snapshot de rótulo, tipo e posição, como os outros tipos.
5. Nos detalhes, as opções aparecem separadas por vírgula.

### 5.2 Condição **(decisões K2 e K3)**

1. Um campo pode ter **uma** condição: o **campo controlador** e o **valor** esperado.
2. O controlador precisa ser um campo **ativo** do mesmo serviço e do mesmo público, do tipo lista de opções, sim ou não ou seleção múltipla, e **sem condição própria** (um nível só). Um campo não pode ser o próprio controlador.
3. O valor precisa ser uma opção vigente do controlador (lista e seleção múltipla) ou "Sim"/"Não" (sim ou não).
4. A condição é atendida quando a resposta do controlador é igual ao valor (lista, sim ou não) ou contém o valor (seleção múltipla).
5. Enquanto a condição não é atendida, o campo fica escondido e não é exigido. Se um valor chegar ao servidor para um campo com condição não atendida (por exemplo, sem JavaScript, ou um valor preenchido antes de mudar o controlador), ele é **descartado**: nenhuma resposta é gravada e nenhum erro é dado.
6. Com JavaScript, o formulário mostra e esconde o campo na hora. Sem JavaScript, todos os campos aparecem, cada condicional com o aviso "Preencha só se …", e o servidor aplica a regra 5.
7. A condição não entra no snapshot da resposta: só rótulo, tipo, posição e valor, como hoje.

### 5.3 Integridade das condições **(decisão K4)**

São recusados com `409`, com mensagem fixa:

1. desativar um campo que é controlador de algum campo ativo;
2. editar as opções de um controlador de modo que o valor de alguma condição ativa deixe de existir;
3. reativar um campo cuja condição aponta para um controlador inativo;
4. dar uma condição a um campo que já é controlador de outro campo ativo (o que criaria dois níveis).

O tipo continua imutável (SPEC de campos, 5.1). A condição e o público podem ser editados, respeitando as regras acima.

### 5.4 Público do campo **(decisão K5)**

1. "Solicitante, na abertura" (padrão): como hoje.
2. "Atendimento": o campo não aparece na abertura. Aparece no detalhe da fila, no bloco "Informações do atendimento", para quem pode mudar a prioridade (responsável efetivo, qualquer atendente do setor sem responsável, ou supervisor da fila), enquanto a solicitação está aberta ou em atendimento.
3. O limite de 10 campos ativos por serviço vale para o total dos dois públicos **(decisão K8)**.
4. Uma resposta enviada na abertura para um campo do atendimento é recusada como formulário desatualizado (5.3.3 da SPEC de campos), porque o campo não está no formulário do solicitante.

### 5.5 Preenchimento pelo atendimento **(decisões K5 e K7)**

1. O formulário mostra todos os campos ativos do atendimento com os valores atuais. Ao salvar, cada valor é validado pelo tipo, e as condições valem como na abertura.
2. Os valores podem ser alterados quantas vezes for preciso enquanto a solicitação está aberta ou em atendimento. Apagar o valor de um campo opcional remove a resposta. Um obrigatório pode ficar em branco ao salvar: a obrigatoriedade só é cobrada na conclusão (item 4).
3. Cada gravação que muda algo registra no histórico "Informações do atendimento atualizadas: *rótulos dos campos alterados*", com quem fez e quando. **Os valores não entram no histórico.** Gravação sem mudança não registra nada.
4. **Conclusão:** a solicitação só é concluída quando todos os campos **obrigatórios** do atendimento, ativos e com a condição atendida, têm resposta. Caso contrário: `409`, com a mensagem "Preencha as informações do atendimento obrigatórias antes de concluir".
5. A resposta guarda o snapshot de rótulo, tipo e posição da última gravação, quem gravou por último e quando.
6. Mudar a configuração depois não altera respostas gravadas.
7. Concorrência: a gravação confere o status e o responsável lidos, como as outras ações (`409` se mudaram).

### 5.6 Quem vê **(decisão K6)**

1. Respostas do solicitante: como hoje.
2. Respostas do atendimento: **só a equipe do setor atual**, no detalhe da fila e no detalhe da API para atendentes, com o campo `audience`. O solicitante não as vê na tela, na API nem em "Meus dados".
3. O gestor do setor (área de aprovações) vê só as respostas do solicitante, como hoje.

### 5.7 Administração

1. O formulário do campo ganha:
   - o tipo "Seleção múltipla";
   - "Quem preenche": "Solicitante, na abertura" ou "Atendimento";
   - "Mostrar só quando": nenhum controlador, ou um controlador com o valor.
2. A lista mostra o público e a condição de cada campo ("Mostrar só quando Tipo de equipamento = Notebook").
3. Quem tem "Gerir serviços do setor" configura os campos dos serviços do próprio setor, como hoje.
4. As alterações entram na auditoria como os outros campos do campo personalizado.

### 5.8 API, anonimização e "Meus dados"

1. **API:**
   - na abertura, `fieldValues` aceita uma lista de textos para a seleção múltipla;
   - no detalhe, cada resposta ganha `audience`, e as do atendimento só aparecem para atendentes do setor;
   - o OpenAPI descreve as duas coisas.
2. **Anonimização:** as respostas de texto (curto ou longo) de campos do atendimento gravadas por último pela pessoa anonimizada são substituídas por "[conteúdo removido na anonimização]", como as justificativas. Os outros tipos não guardam texto livre e ficam.
3. **"Meus dados":** continua com as respostas do solicitante e não inclui as do atendimento (5.6).

## 6. Dados

Duas migrations, porque um valor novo de enum do PostgreSQL não pode ser usado na mesma transação em que é criado. O projeto já fez o mesmo com o perfil de gestor (`20261101500000_manager_role` e `20261101500100_approvals`).

1. **`…_field_type_multi_select`:** acrescenta `MULTI_SELECT` ao enum `ServiceFieldType`.
2. **`…_conditional_attendant_fields`:**
   - **novos tipos:** enum `ServiceFieldAudience` (`REQUESTER`, `ATTENDANT`);
   - **`ServiceField`:**
     - `audience` (padrão `REQUESTER`);
     - `conditionFieldId` (opcional, chave para `ServiceField` do mesmo serviço) e `conditionValue` (opcional);
     - restrição "os dois juntos ou nenhum" e "não aponta para si mesmo";
   - **`RequestFieldValue`:** `updatedAt` e `updatedById` (opcionais, preenchidos nas gravações do atendimento);
   - **tabela `RequestFieldUpdateEvent`:** `id`, `requestId`, `actorId`, `labels` (lista de 1 a 10 rótulos), `occurredAt`; índice por `requestId`;
   - **restrição recriada mais ampla, sem perda de dados:** a de `options` do `ServiceField` passa a aceitar 2 a 20 opções também em `MULTI_SELECT`.

Campos e respostas existentes ficam com público "Solicitante" e sem condição. Nenhuma dependência nova.

## 7. Critérios de aceitação

- [ ] **CA-CND-01** — Sem usar nada disto, nada muda: suítes anteriores passam (listas que enumeram todos os tipos são estendidas, como nas SPECs anteriores).
- [x] **CA-CND-02** — O administrador cria e edita campos de seleção múltipla, de atendimento e com condição; a configuração recusa controlador de outro serviço, de outro público, de tipo errado, inativo, com condição própria ou o próprio campo, e valor que não é opção do controlador. *Verificado em 2026-11-03 (SF-133 e SF-134): o administrador cria seleção múltipla, campo do atendimento e condicionais por lista e por seleção múltipla; editar sem as chaves novas mantém a condição e condição vazia a remove; recusados no campo `conditionFieldId` controlador de texto, de outro público, com condição própria, de outro serviço, inativo e o próprio campo, e no campo `conditionValue` valor fora das opções, sem gravar nada (unitários e integração); editor com "Quem preenche" e "Mostrar só quando", mensagens fixas e auditoria dos campos novos.*
- [x] **CA-CND-03** — As regras de integridade (5.3) recusam com `409`: desativar controlador em uso, remover opção usada, reativar dependente com controlador inativo, condicionar um controlador. *Verificado em 2026-11-03 (SF-134): `409` ao desativar controlador em uso, remover opção usada, condicionar um controlador, mudar o público de um controlador com dependentes e reativar dependente com controlador inativo; acrescentar opção e reativar depois do controlador são aceitos (integração).*
- [ ] **CA-CND-04** — Na abertura, a seleção múltipla aceita uma ou mais opções vigentes e grava a lista na ordem configurada; obrigatória sem marcação, opção fora da lista e repetição são recusadas.
- [ ] **CA-CND-05** — O campo condicional só é exigido com a condição atendida; com a condição não atendida, o valor enviado é descartado; o formulário mostra e esconde o campo conforme o controlador.
- [ ] **CA-CND-06** — Campos do atendimento não aparecem na abertura (resposta para eles é recusada) e são preenchidos e alterados no detalhe da fila por quem pode mudar a prioridade; cada gravação com mudança vira linha no histórico, só com os rótulos.
- [ ] **CA-CND-07** — A conclusão é recusada enquanto falta um obrigatório do atendimento com condição atendida; preenchido, conclui.
- [ ] **CA-CND-08** — O solicitante não vê respostas do atendimento (tela, API, "Meus dados"); a equipe vê; a API aceita lista na seleção múltipla e mostra `audience`; o OpenAPI descreve.
- [ ] **CA-CND-09** — A anonimização substitui os textos do atendimento gravados pela pessoa.
- [ ] **CA-CND-10** — Nenhuma dependência nova; duas migrations aditivas (com a restrição de opções recriada mais ampla); README explica. *Parcial em 2026-11-03 (SF-133): migrations `20261103500000_field_type_multi_select` (só o valor do enum) e `20261103500100_conditional_attendant_fields` (colunas, tabela do histórico, chave composta do controlador no mesmo serviço e `ServiceField_options_check` recriada para aceitar a seleção múltipla); nada é inserido (`integration/conditional-fields-schema.test.ts`).*

## 8. Estratégia de testes

- **Unitários:**
  - validação e normalização da seleção múltipla;
  - avaliação das condições e descarte dos valores;
  - regras de configuração e de integridade;
  - campos obrigatórios na conclusão;
  - formatação.
- **Integração:**
  - configuração no banco, com as recusas de 5.3;
  - abertura com seleção múltipla e condição;
  - gravação dos campos do atendimento, com histórico, concorrência e conclusão bloqueada;
  - visibilidade para o solicitante e para a equipe;
  - API, anonimização e "Meus dados".
- **E2E:**
  1. O administrador cria um campo de seleção múltipla, um campo condicional e um campo obrigatório do atendimento.
  2. O solicitante vê o condicional aparecer ao escolher o valor e abre.
  3. O atendente tenta concluir, é recusado, preenche o campo do atendimento e conclui.
  4. O solicitante não vê o campo do atendimento.

## 9. Riscos

- **Formulário que depende de JavaScript:** mitigado pela regra 5.2.6. Sem JavaScript, tudo aparece com o aviso, e o servidor decide.
- **Configuração que muda durante o preenchimento:** a regra de formulário desatualizado (SPEC de campos, 5.3.3) continua valendo.
- **Valor JSON da seleção múltipla em texto:** a coluna `value` continua texto. Quem lê pela API recebe o texto JSON, e o OpenAPI explica.
- **Bloqueio da conclusão:** um obrigatório do atendimento mal configurado impede concluir. Mitigado pela mensagem fixa, que diz o que falta, e pelo administrador, que pode tornar o campo opcional.

## 10. Tarefas (registradas em `TASKS.md`)

| ID | Tarefa |
|---|---|
| SF-133 | Migrations e domínio (seleção múltipla, condições, público, regras de integridade e da conclusão) |
| SF-134 | Configuração na administração (tipo, público, condição, integridade, auditoria) |
| SF-135 | Abertura com seleção múltipla e campos condicionais (formulário, servidor e API) |
| SF-136 | Campos do atendimento (formulário na fila, gravação, histórico, conclusão, visibilidade, API, anonimização) |
| SF-137 | E2E, README e revisão |

**Ordem:** SF-133 → SF-134 → SF-135 → SF-136 → SF-137.

## 11. Decisões tomadas (2026-11-03)

Funcionalidade aprovada pela responsável; decisões adotadas como recomendadas.

| # | Questão | Decisão | Alternativas |
|---|---|---|---|
| K1 | Seleção múltipla | Tipo novo com caixas de seleção, 2 a 20 opções, guardada como lista JSON na ordem configurada | Mínimo e máximo de marcações configuráveis |
| K2 | Forma da condição | Uma condição por campo, "igual a" ou "contém", um nível só | Várias condições com "e"/"ou"; condições encadeadas |
| K3 | Valor de campo escondido | Descartado sem erro | Recusar o envio |
| K4 | Integridade | Recusar as mudanças que quebrariam uma condição (5.3) | Desligar as condições quebradas automaticamente |
| K5 | Campos do atendimento | Mesmo cadastro, com "Quem preenche"; preenchidos no detalhe da fila, editáveis enquanto a solicitação está aberta ou em atendimento | Cadastro separado; valores imutáveis |
| K6 | Quem vê o atendimento | Só a equipe do setor | Opção por campo "visível ao solicitante" |
| K7 | Obrigatoriedade do atendimento | Cobrada na conclusão | Cobrada ao iniciar; nunca cobrada |
| K8 | Limite | 10 campos ativos por serviço no total | 10 por público |
| K9 | Histórico | Linha com os rótulos alterados, sem valores; sem evento nem notificação | Valores no histórico; evento de webhook |
| K10 | Dados fictícios | Sem mudança | Exemplos na demonstração |
