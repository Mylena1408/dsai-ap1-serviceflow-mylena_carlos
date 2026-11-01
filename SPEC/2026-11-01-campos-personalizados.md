# SPEC — Campos personalizados por serviço

**Data:** 2026-11-01
**Status:** Aprovada em 2026-11-01, com as decisões F1 a F4 da seção 11 conforme propostas.
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-visao-geral.md` (§4: "campos necessários para a solicitação"), `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seções 5, 6.4 e 19; seção 21 como modelo de configuração por serviço), `SPEC/2026-10-29-plano-escala-100k.md` (item 6 e garantia 7.4), `SPEC/2026-11-01-relatorio-fase-2.md`

## 1. Objetivo

Permitir que o administrador defina, para cada serviço, **campos próprios** que o solicitante preenche ao abrir a solicitação (por exemplo, "Número do patrimônio", "Data desejada", "Turno"). Assim a equipe recebe as informações de que precisa de forma estruturada, sem depender só da descrição livre.

## 2. Registro da mudança de escopo

A SPEC principal deixou os "campos personalizados" fora da primeira entrega (seção 5), afirmou que "não há campos de formulário customizados nesta entrega" (seção 6.4) e listou "campos personalizados e validação específica de serviços" entre os pontos para SPECs futuras (seção 19). O item 6 do plano de escala foi aceito em 2026-10-29, condicionado a esta SPEC. Pela garantia 7.4 do plano, **um serviço sem campos personalizados se comporta exatamente como hoje**.

## 3. Escopo

1. Cadastro de campos por serviço pelo administrador: criar, editar, reordenar e desativar.
2. Tipos de campo **(decisão F1)** e suas regras de validação.
3. Exibição dos campos no formulário de abertura, com validação no servidor.
4. Gravação das respostas com snapshot da definição do campo **(decisão F2)**.
5. Exibição das respostas nos detalhes da solicitação, para o solicitante e para o atendente.
6. Um serviço de exemplo com campos no banco fictício (`npm run seed:demo`).

## 4. Fora de escopo

- Campos condicionais (um campo que aparece conforme a resposta de outro).
- Campos de arquivo (os documentos já têm requisitos próprios, seção 21 da SPEC principal).
- Seleção múltipla, número decimal, moeda, e-mail, CPF e outras máscaras.
- Campos herdados do setor ou da categoria, ou modelos de formulário compartilhados entre serviços.
- Editar as respostas depois da abertura **(decisão F3)**.
- Buscar ou filtrar solicitações pelas respostas, e usar as respostas em relatórios (itens 11 e 13).
- Campos preenchidos pelo atendente durante o atendimento.

## 5. Regras

### 5.1 Configuração (somente `ADMIN`)

1. Só o administrador cria, edita, reordena e desativa campos; a autorização é verificada no servidor.
2. Cada campo pertence a um único serviço e tem:
   - **rótulo**: obrigatório, sem espaços nas pontas, até 80 caracteres; único entre os campos **ativos** do mesmo serviço, sem distinguir maiúsculas e minúsculas;
   - **texto de ajuda**: opcional, até 200 caracteres;
   - **tipo** (seção 5.2), que **não muda depois de criado**: para trocar o tipo, o administrador desativa o campo e cria outro;
   - **obrigatoriedade**: obrigatório ou opcional;
   - **ordem de exibição** e estado **ativo/inativo**.
3. Um serviço pode ter **no máximo 10 campos ativos** **(decisão F4)**.
4. Campos são desativados, nunca apagados, porque as respostas guardam a referência. Um campo desativado pode ser reativado, desde que não ultrapasse o limite nem repita o rótulo de outro campo ativo.
5. Mudar a configuração afeta só solicitações futuras. Respostas já gravadas não mudam.
6. Nenhum campo é criado por código de produção, migration ou seed obrigatório. O banco fictício é só para demonstração.

### 5.2 Tipos de campo **(decisão F1)**

| Tipo | Na tela | Configuração extra | Valor aceito |
|---|---|---|---|
| Texto curto | `input` de uma linha | — | Até 200 caracteres, sem quebra de linha |
| Texto longo | `textarea` | — | Até 2.000 caracteres |
| Número inteiro | `input type="number"` | Mínimo e máximo opcionais (mínimo ≤ máximo), entre −1.000.000.000 e 1.000.000.000 | Inteiro dentro dos limites |
| Data | `input type="date"` | — | Data de calendário válida no formato `AAAA-MM-DD`, entre 1900-01-01 e 2100-12-31 |
| Lista de opções | `select` | De 2 a 20 opções, cada uma com até 80 caracteres, sem repetição (sem distinguir maiúsculas e minúsculas) | Exatamente uma das opções vigentes |
| Sim ou não | `select` com "Sim" e "Não" | — | `true` ou `false` |

- Os valores de texto têm os espaços das pontas removidos. Um campo opcional deixado em branco não gera resposta.
- Num campo obrigatório, "em branco" (inclusive só espaços) é recusado. Num campo "Sim ou não" obrigatório, o solicitante precisa escolher uma das duas respostas.
- As opções de uma lista podem ser editadas. Como a resposta guarda o texto escolhido (seção 5.4), editar ou remover uma opção não altera solicitações antigas.

### 5.3 Abertura

1. O formulário de abertura mostra os campos ativos do serviço na ordem configurada, depois da descrição e antes dos documentos, com o rótulo, a indicação de obrigatório e o texto de ajuda.
2. O servidor, com a configuração recarregada do banco no momento do envio:
   - mantém todas as validações atuais da abertura (descrição, serviço disponível, documentos);
   - recusa respostas para campos que não são ativos do próprio serviço;
   - exige todos os campos obrigatórios ativos;
   - valida cada valor pelo tipo (seção 5.2).
3. Se a configuração mudou entre a exibição do formulário e o envio, vale a configuração atual. O envio inconsistente é recusado com uma mensagem fixa pedindo para recarregar a página (o mesmo comportamento dos documentos, seção 21.4.5).
4. Erros de campo aparecem junto do campo, com mensagens fixas que não repetem o valor digitado. Os valores já preenchidos são mantidos no formulário depois de um erro.
   - *Esclarecimento registrado em 2026-11-01 (SF-073):* a descrição e as respostas dos campos são mantidas pelo próprio navegador (o texto digitado nunca vai no endereço; só os identificadores dos campos e códigos fixos de erro). Arquivos anexados **não** podem ser restaurados pelo navegador e precisam ser escolhidos de novo; a mensagem de erro avisa isso quando o serviço exige documentos. Os códigos de erro que já existiam na abertura (`validation`, `attachments`, `unavailable` e outros) continuam os mesmos.
5. A solicitação, o evento inicial, os anexos e as respostas são gravados **na mesma transação**. Se algo falhar, nada é gravado.
6. O cliente não define o identificador da resposta, os snapshots nem as datas.

### 5.4 Respostas **(decisão F2)**

1. Cada resposta guarda: o campo de origem, o **rótulo, o tipo e a posição no momento da abertura** (snapshot) e o valor normalizado em texto (`AAAA-MM-DD` para data, número em base 10, `true`/`false` para sim ou não, o texto da opção escolhida para a lista).
2. As respostas são imutáveis depois da abertura **(decisão F3)**.
3. Os detalhes da solicitação mostram as respostas na ordem do snapshot, com o rótulo do snapshot, num bloco "Informações do serviço". Data aparece como `DD/MM/AAAA`; sim ou não, como "Sim" ou "Não". O bloco não aparece quando não há respostas.
4. As listas (fila e "Minhas solicitações") não mostram as respostas.

### 5.5 Autorização

- Quem vê as respostas: o próprio solicitante e os atendentes ativos do setor da solicitação, com as mesmas regras de acesso dos detalhes que já existem.
- O administrador continua sem acesso às solicitações (seção 10 da SPEC principal).
- Configurar campos: só o administrador.

## 6. Dados (migration somente aditiva)

- Novo enum `ServiceFieldType`: `SHORT_TEXT`, `LONG_TEXT`, `INTEGER`, `DATE`, `SELECT`, `YES_NO`.
- Nova tabela `ServiceField`:
  - `id`, `serviceId`, `label` (`citext`), `helpText` (opcional), `type`, `isRequired`, `options` (lista de texto, vazia fora de `SELECT`), `minValue` e `maxValue` (inteiros opcionais, só em `INTEGER`), `position`, `isActive`, `createdAt`, `updatedAt`;
  - índice único parcial em `(serviceId, label)` entre os ativos;
  - `CHECK`s: rótulo e texto de ajuda dentro dos limites; `options` com 2 a 20 itens só em `SELECT`; `minValue`/`maxValue` só em `INTEGER` e com mínimo ≤ máximo.
- Nova tabela `RequestFieldValue`:
  - `id`, `requestId`, `fieldId`, `labelSnapshot`, `typeSnapshot`, `positionSnapshot`, `value`, `createdAt`;
  - único em `(requestId, fieldId)`; índice em `fieldId`;
  - chaves estrangeiras com `Restrict`, como nos anexos.
- Nenhuma coluna das tabelas existentes muda. Serviços e solicitações existentes ficam sem campos e sem respostas.
- A limpeza do banco de teste (`tests/integration/fixtures.ts` e `scripts/prepare-e2e.ts`) passa a apagar as duas tabelas novas na ordem das chaves estrangeiras.

## 7. Critérios de aceitação

- [x] **CA-FLD-01** — Serviço sem campos: o formulário de abertura e os detalhes ficam como hoje, e todas as suítes anteriores passam sem alteração de asserções. *Verificado em 2026-11-01 (SF-073): serviço sem campos abre como antes, sem respostas; a ação só envia `fieldValues` quando o formulário tem campos, e os testes existentes da abertura passam sem alteração de asserções (unitário, integração e E2E).*
- [x] **CA-FLD-02** — O administrador cria, edita, reordena, desativa e reativa campos; outros perfis são negados no servidor. *Verificado em 2026-11-01 (SF-072): o administrador cria campos dos seis tipos, edita, reordena, desativa e reativa (no fim do formulário); solicitante, atendente e anônimo são negados em todas as operações, sem gravar nada (unitário dos casos de uso e das ações; integração).*
- [x] **CA-FLD-03** — A configuração rejeita: rótulo vazio, longo demais ou repetido entre os ativos do serviço; 11º campo ativo; lista com menos de 2 ou mais de 20 opções, ou com opção repetida; mínimo maior que o máximo; mudança de tipo. *Verificado em 2026-11-01 (SF-072): rótulo vazio, com mais de 80 caracteres ou repetido entre os ativos (ignorando maiúsculas) recusado; 11º campo ativo recusado, também na reativação; lista com 1 ou 21 opções ou opção repetida, mínimo maior que o máximo, limites fora de número, opções fora de lista e tipo desconhecido recusados; edição com outro tipo recusada (unitário e integração).*
- [x] **CA-FLD-04** — A abertura mostra os campos ativos na ordem configurada, com obrigatoriedade e ajuda; campos inativos não aparecem. *Verificado em 2026-11-01 (SF-073): `listPublishedServiceFields` devolve só os ativos, na ordem configurada (integração); o formulário mostra rótulo, obrigatoriedade e ajuda de cada tipo (verificação no navegador).*
- [x] **CA-FLD-05** — O servidor valida cada tipo nas bordas: texto curto com 200 e 201 caracteres e com quebra de linha; texto longo com 2.000 e 2.001; inteiro fora dos limites ou não inteiro; data inexistente (`2026-02-30`) ou fora do intervalo; opção que não está na lista; sim ou não com outro valor. *Verificado em 2026-11-01 (SF-073): bordas de cada tipo recusadas no servidor com o código do campo — 201 caracteres e quebra de linha no texto curto, 2.001 no longo, inteiro fora do limite ou com vírgula, data inexistente ou fora do intervalo, opção fora da lista, sim ou não com outro valor; 200 e 2.000 caracteres aceitos (unitário e integração).*
- [x] **CA-FLD-06** — Campo obrigatório em branco é recusado; campo opcional em branco não gera resposta; resposta para campo de outro serviço, inativo ou inexistente é recusada. *Verificado em 2026-11-01 (SF-073): obrigatório em branco recusado; opcional em branco não gera resposta; resposta para campo inativo, de outro serviço ou inexistente recusada como formulário desatualizado (unitário e integração).*
- [ ] **CA-FLD-07** — Em qualquer recusa, nada é gravado (solicitação, evento, anexos ou respostas), e o formulário mantém os valores digitados. *Parcial em 2026-11-01 (SF-073): nada é gravado em nenhuma recusa, nem arquivo (unitário e integração); a recusa volta só com identificadores e códigos, sem o texto digitado (unitário da ação); no navegador, descrição e respostas voltam preenchidas e o erro aparece junto do campo (teste temporário). Falta o E2E definitivo (SF-075).*
- [x] **CA-FLD-08** — As respostas são gravadas com o snapshot na mesma transação da abertura; mudar o rótulo, as opções ou desativar o campo depois não altera a solicitação já aberta. *Verificado em 2026-11-01 (SF-073): respostas gravadas com rótulo, tipo e posição na mesma transação e no mesmo horário da abertura; mudar rótulo e opções ou desativar o campo depois não altera as respostas (integração).*
- [x] **CA-FLD-09** — O solicitante e os atendentes do setor veem as respostas nos detalhes, formatadas pelo tipo; atendente de outro setor e administrador não acessam. *Verificado em 2026-11-01 (SF-074): solicitante dono e atendente do setor veem as respostas na ordem do snapshot, com os rótulos da abertura mesmo depois de renomear ou desativar o campo; outro solicitante, atendente de outro setor e administrador recebem "não encontrado"; atendente inativo e anônimo são recusados (integração); data como DD/MM/AAAA, sim ou não como "Sim"/"Não" e inteiros agrupados (unitário); bloco nos dois detalhes conferido no navegador.*
- [x] **CA-FLD-10** — Migration aditiva; os dados existentes não mudam. *Verificado em 2026-11-01 (SF-071): migration aplicada sobre dados existentes; serviços e solicitações existentes ficam sem campos e sem respostas (`service-field-schema.test.ts`); suítes anteriores sem alteração de asserções.*

## 8. Estratégia de testes

- **Unitários:** validação da definição do campo (cada regra da seção 5.1 e 5.2); validação e normalização de cada tipo de valor nas bordas; montagem das respostas a partir da configuração; formatação para a tela.
- **Integração:** configuração no banco (limite, unicidade entre ativos, reativação, `CHECK`s); abertura com respostas e snapshot; recusa sem gravar nada; mudança de configuração depois da abertura; acesso aos detalhes.
- **E2E:** o administrador cria um serviço com um campo de cada tipo; o solicitante tenta abrir sem um obrigatório, corrige e abre; o atendente vê as respostas nos detalhes.

## 9. Riscos

- **Formulário de abertura mais complexo:** a abertura já trata documentos em `multipart`. Os campos entram no mesmo envio com nomes próprios (`field.<id>`), e o limite de tamanho atual comporta o maior caso (10 campos × 2.000 caracteres ≈ 20 KB).
- **Configuração que muda durante o preenchimento:** tratada pela recusa com pedido de recarga (5.3.3), sem gravar nada.
- **Expectativa de formulários mais ricos** (campos condicionais, seleção múltipla): ficam fora desta SPEC e podem virar SPECs próprias.

## 10. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-071 | Migration e domínio: definição do campo, validação e normalização de cada tipo |
| SF-072 | Configuração pelo administrador: casos de uso, ações e editor na tela de serviços |
| SF-073 | Abertura com campos: formulário, validação no servidor e gravação na mesma transação |
| SF-074 | Respostas nos detalhes da solicitação (solicitante e atendente) e serviço de exemplo no banco fictício |
| SF-075 | E2E e revisão |

**Ordem:** SF-071 → SF-072 → SF-073 → SF-074 → SF-075.

## 11. Decisões tomadas (2026-11-01)

Decisões da responsável pelo projeto: **todas as propostas aceitas**.

| # | Questão | Decisão | Alternativas descartadas |
|---|---|---|---|
| F1 | Tipos de campo | Os seis tipos da seção 5.2 | Só texto curto e longo; ou acrescentar seleção múltipla e número decimal |
| F2 | Como guardar as respostas | Tabela própria com snapshot do rótulo, do tipo e da posição | Uma coluna JSON na solicitação |
| F3 | Editar as respostas depois da abertura | Não; ficam imutáveis, como os anexos | O solicitante edita enquanto a solicitação estiver aberta, com registro no histórico |
| F4 | Limite de campos ativos por serviço | 10 | 5; ou 20 |
