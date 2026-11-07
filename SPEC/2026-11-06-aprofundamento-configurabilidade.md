# SPEC — Aprofundamento da configurabilidade

**Data:** 2026-11-06
**Status:** Aprovada em 2026-11-06. A responsável aprovou os cinco itens do grupo "aprofundar o que torna o sistema configurável" (campos, aprovações, fluxos, permissões e escalonamento). As decisões G1 a G20 da seção 10 foram adotadas como recomendadas e podem ser revistas por ela antes do início de cada parte.
**Projeto:** ServiceFlow
**Referências:**
- `SPEC/2026-11-01-campos-personalizados.md` (seção 4: "número decimal", "máscaras", "buscar pelas respostas" fora de escopo);
- `SPEC/2026-11-03-campos-condicionais-atendimento.md` (condição de um campo: regras 5.2 e 5.3);
- `SPEC/2026-11-01-aprovacoes.md` (seção 4: "vários níveis", "delegação, substituição de gestor ausente ou prazo para aprovar", "aprovação por condição" fora de escopo);
- `SPEC/2026-11-01-fluxos-configuraveis.md` (seção 4: "etapas com responsável, prazo", "ramificações", "filtro da fila por etapa" fora de escopo);
- `SPEC/2026-11-01-permissoes-configuraveis.md` (seção 4: "papéis criados pelo administrador", "permissões temporárias" fora de escopo);
- `SPEC/2026-11-06-escalonamento.md` (decisão E3: "regras configuráveis e escalonamento antes do vencimento" para uma SPEC futura);
- `SPEC/2026-10-31-busca-filtros-paginacao.md` (busca por texto, regra 5.2);
- `SPEC/2026-10-29-plano-escala-100k.md` (garantia 7.4; meta de linhas).

## 1. Objetivo

O ServiceFlow já é configurável em campos, aprovações, fluxos, permissões e escalonamento, mas cada SPEC desses recursos deixou de fora partes que organizações reais costumam pedir. Esta SPEC acrescenta essas partes, em cinco blocos independentes:

| Parte | O que acrescenta |
|---|---|
| A — Campos | Número decimal; formatos validados (e-mail, telefone, CPF, CNPJ, CEP); busca pelas respostas |
| B — Aprovações | Até 3 níveis; ausência do gestor com substituto; prazo para aprovar; aprovação só quando uma condição é atendida |
| C — Fluxos | Responsável e prazo por etapa; etapas condicionais; filtro da fila por etapa |
| D — Permissões | Papéis criados pelo administrador; permissões e papéis com validade |
| E — Escalonamento | Regras por setor antes do vencimento e dias depois dele, com ações e destinatários escolhidos |

## 2. Registro da mudança de escopo e garantia

Cada item estava explicitamente fora de escopo de uma SPEC anterior (ver referências). Esta SPEC é o registro que autoriza implementá-los.

**Garantia 7.4 do plano, para todas as partes:** quem não usa um recurso novo não percebe mudança. Serviços sem os campos novos, sem níveis, sem prazo e sem condição de aprovação; etapas sem responsável, prazo ou condição; usuários sem papel e sem validade; setores sem regras de escalonamento: todos se comportam exatamente como hoje, e as suítes anteriores passam sem alteração de asserções (exceto listas exatas que a própria SPEC amplia, como tipos de campo ou entidades da auditoria).

**Limite do agendamento:** o job agendado roda **uma vez por dia** (`/api/cron/daily`, 06:00 UTC, `vercel.json`). Por isso, todos os prazos novos desta SPEC são contados em **dias** e os avisos de atraso saem no job diário **(decisão G1)**. As telas calculam "atrasada" na hora da leitura, então mostram o estado exato mesmo antes do job.

## 3. Parte A — Campos

### 3.1 Escopo

1. Novo tipo **Número decimal**.
2. Novos tipos com formato validado: **E-mail**, **Telefone**, **CPF**, **CNPJ** e **CEP** **(decisão G2)**.
3. A busca das listas ("Minhas solicitações" e "Fila do meu setor") passa a procurar também nas respostas dos campos **(decisão G3)**.
   - *Correção registrada em 2026-11-06 (SF-163):* a primeira versão desta SPEC incluía "Aprovações", mas essa lista não tem campo de busca (só o filtro "pendentes/todas", SPEC de aprovações 5.7). Pôr busca nela seria uma funcionalidade nova, ligada à paginação que a SF-160 deixou para decisão. A busca pelas respostas vale para as duas listas que já têm busca; "Aprovações" fica fora desta SPEC.

### 3.2 Fora de escopo

- Moeda com símbolo, porcentagem, máscaras definidas pelo administrador (expressões regulares) e formatos de outros países.
- Consulta externa (por exemplo, CEP que preenche o endereço, CPF na Receita).
- Filtro estruturado por campo (escolher um campo e um valor); relatórios pelas respostas.
- Busca sem acento e por relevância (continuam fora, como na SPEC de busca).

### 3.3 Regras

1. **Número decimal:**
   - configuração: **casas decimais** de 1 a 4 (obrigatório) e mínimo e máximo opcionais (mínimo ≤ máximo), entre −1.000.000.000 e 1.000.000.000;
   - entrada: aceita vírgula ou ponto como separador decimal, sem separador de milhar; mais casas que o configurado é recusado (não arredonda);
   - resposta normalizada com ponto e exatamente as casas configuradas (`1234.50`); exibida no padrão brasileiro (`1.234,50`).
2. **Formatos:**

   | Tipo | Aceita | Grava (normalizado) | Exibe |
   |---|---|---|---|
   | E-mail | Até 254 caracteres, uma `@`, domínio com ponto, sem espaços | Em minúsculas | Como gravado |
   | Telefone | 10 ou 11 dígitos, com DDD de 11 a 99; ignora espaços, parênteses, hífen e `+55` inicial | Só os dígitos | `(91) 98765-4321` ou `(91) 3201-7000` |
   | CPF | 11 dígitos com dígitos verificadores válidos; recusa os 11 iguais | Só os dígitos | `123.456.789-09` |
   | CNPJ | 14 dígitos com dígitos verificadores válidos; recusa os 14 iguais | Só os dígitos | `12.345.678/0001-95` |
   | CEP | 8 dígitos | Só os dígitos | `66075-110` |

   Pontuação na entrada é aceita e removida. Mensagens de erro fixas, sem repetir o valor digitado (regra 5.3.4 da SPEC de campos).
3. Os tipos novos funcionam nos dois públicos (solicitante e atendimento), podem ser obrigatórios e **não** podem ser controladores de condição (o controlador continua sendo lista, sim ou não ou seleção múltipla).
4. **Dados pessoais:** respostas de CPF, CNPJ, telefone e e-mail seguem as regras das respostas que já existem: entram em "Meus dados" do solicitante e são apagadas na anonimização. Não há tratamento novo, porque todas as respostas já são tratadas como pessoais.
5. **Busca pelas respostas (decisão G3):**
   - o termo (2 a 100 caracteres, regra 5.2 da SPEC de busca) também é procurado, sem distinguir maiúsculas, no valor gravado das respostas;
   - CPF, CNPJ, telefone e CEP: se o termo, sem pontuação, tiver só dígitos, a busca compara com os dígitos gravados, então `123.456` encontra o CPF `12345678909`;
   - o solicitante só encontra pelas respostas que ele pode ver (as que ele deu, sem autor de gravação do atendimento, como na CA-CND-08); a equipe encontra também pelas do atendimento;
   - o escopo de cada lista não muda: a busca nunca mostra solicitação que o leitor não veria sem ela.

### 3.4 Dados

- Enum `ServiceFieldType` ganha `DECIMAL`, `EMAIL`, `PHONE`, `CPF`, `CNPJ` e `CEP` (migration só com os valores, separada, como na seleção múltipla).
- `ServiceField` ganha `decimalPlaces` (inteiro opcional), `minDecimal` e `maxDecimal` (`numeric(14,4)` opcionais), com `CHECK`: casas só no decimal e obrigatórias nele; limites decimais só no decimal; mínimo ≤ máximo.
- Índice para a busca nas respostas, se a medição com o volume da SF-160 (`serviceflow_perf`) mostrar a busca acima de 1 s; a escolha do índice fica registrada em `NOTES.md`. *Medido na SF-163: 0,71 s no pior caso; nenhum índice foi criado.*

### 3.5 Critérios de aceitação

- [x] **CA-CMP-01** — O administrador cria campos decimais com casas e limites; a configuração recusa casas fora de 1 a 4, mínimo maior que o máximo e limites fora da faixa. *Verificado em 2026-11-06 (SF-161 a SF-163): validação da configuração (unitário e banco); criação e alteração pelo caso de uso, com limites normalizados e auditoria (integração); pela tela, o administrador cria um decimal com 2 casas e limites com vírgula, e a lista mostra "2 casas decimais; de 0,00 a 1.500,50" (E2E `field-formats.spec.ts`).*
- [x] **CA-CMP-02** — Na abertura e no atendimento, o decimal aceita vírgula ou ponto, recusa casas a mais e valores fora dos limites, grava normalizado e exibe no padrão brasileiro. *Verificado em 2026-11-06 (SF-161 a SF-163): regra das respostas (unitário); abertura e atendimento pelo caso de uso (integração); pela tela, "10,255" é recusado com "Use no máximo 2 casas decimais." e "1234,5" aparece como "1.234,50" nos detalhes (E2E).*
- [x] **CA-CMP-03** — E-mail, telefone, CPF, CNPJ e CEP aceitam os valores válidos com ou sem pontuação, recusam os inválidos (incluindo dígitos verificadores errados e sequências iguais), gravam normalizados e exibem formatados. *Verificado em 2026-11-06 (SF-161 a SF-163): regras dos cinco tipos (unitário); abertura pelo caso de uso e pela API (integração); pela tela, CPF com dígito errado e telefone sem DDD são recusados com mensagens fixas que não repetem o valor (o endereço não contém o CPF), e as respostas aparecem como "529.982.247-25" e "(91) 98765-4321" (E2E).*
- [x] **CA-CMP-04** — Os tipos novos não podem ser controladores de condição; nas demais regras de campo (rótulo, limite de 10, desativação, condição como dependente, API, OpenAPI) funcionam como os tipos atuais. *Verificado em 2026-11-06 (SF-161 a SF-163): os tipos novos não são aceitos como controladores (unitário e integração); configuração pela tela (E2E), API e OpenAPI (integração).*
- [x] **CA-CMP-05** — A busca encontra solicitações pelas respostas, inclusive por dígitos parciais de CPF, CNPJ, telefone e CEP; o solicitante não encontra pelas respostas do atendimento; nenhuma lista mostra solicitação fora do escopo do leitor. *Verificado em 2026-11-06 (SF-163): "Minhas solicitações" e a fila encontram por respostas de texto e por dígitos com pontuação ("529.982.247", "(91) 98765"); `%` e `_` continuam literais; a solicitante não encontra pela resposta do atendimento, que a atendente encontra; outro solicitante e outro setor nunca aparecem (integração `request-answer-search.test.ts`); pela tela, a busca pelo CPF e pelo telefone acha a solicitação (E2E). "Aprovações" não tem busca: ver a correção em 3.1.3.*
- [x] **CA-CMP-06** — Migrations aditivas; campos e respostas existentes não mudam; a busca com o volume da SF-160 responde em até 1 s. *Verificado em 2026-11-06 (SF-161 e SF-163): migrations aditivas (SF-161). No banco `serviceflow_perf` (98.014 solicitações, com 196.029 respostas geradas para a medição: um CPF e um texto por solicitação), a busca mais lenta levou 0,71 s na fila e 0,50 s em "Minhas solicitações"; antes da busca nas respostas, 0,36 s e 0,14 s. Fica abaixo de 1 s sem índice novo.*

## 4. Parte B — Aprovações

### 4.1 Escopo

1. **Níveis:** um serviço que exige aprovação pode ter de 1 a 3 níveis, cada um decidido pelos gestores de um setor escolhido **(decisão G4)**.
2. **Ausência do gestor:** um período em que outro gestor, escolhido como substituto, também decide as aprovações do setor do ausente **(decisão G5)**.
3. **Prazo para aprovar:** dias por nível; o atraso aparece nas telas e gera aviso no job diário **(decisão G6)**.
4. **Aprovação por condição:** o serviço exige aprovação só quando uma resposta do solicitante atende a uma condição **(decisão G7)**.

### 4.2 Fora de escopo

- Níveis paralelos (todos ao mesmo tempo) ou que exigem mais de um gestor por nível.
- Aprovação ou rejeição automática quando o prazo vence **(decisão G6)**.
- Aprovador escolhido pelo nome (pessoa específica) em vez do setor.
- Condições com mais de um critério ou com operadores além dos da regra 5.2 da SPEC de campos condicionais.
- Delegação feita pelo administrador em nome do gestor sem registro de período.

### 4.3 Regras

1. **Configuração dos níveis (só quem configura o serviço: administrador ou `SECTOR_SERVICES`):**
   - com "Exige aprovação" marcado, o serviço tem a lista de níveis; o nível 1 é, por padrão, o setor do próprio serviço, que é o comportamento atual;
   - cada nível aponta para um setor **ativo**; o mesmo setor não se repete em níveis seguidos;
   - quem tem `SECTOR_SERVICES` configura os níveis dos serviços do próprio setor e pode escolher qualquer setor ativo para um nível: o nível só define quem aprova e não dá a quem configura acesso ao outro setor.
2. **Cópia na abertura:** a solicitação guarda a lista de setores dos níveis (como já guarda "exige aprovação"). Mudar o serviço depois não altera solicitações abertas.
3. **Andamento:**
   - a aprovação começa no nível 1; aprovar um nível passa ao seguinte; aprovar o último deixa a aprovação *aprovada* e o atendimento pode começar (regra 5.3 da SPEC de aprovações);
   - rejeitar em qualquer nível cancela a solicitação, como hoje;
   - cada nível tem a sua decisão registrada, com quem decidiu, quando e a observação;
   - o prazo do SLA conta a partir da aprovação do **último** nível (decisão A3 mantida).
4. **Quem decide cada nível:** gestor ativo do setor do nível, ou o substituto de um gestor ausente desse setor (regra 5). Um mesmo gestor pode decidir mais de um nível, se for de setores diferentes (por ser substituto). A primeira decisão do nível vale; a concorrência segue a regra 5.4 da SPEC de aprovações.
5. **Ausência (decisão G5):**
   - o próprio gestor (ou o administrador) registra: início e fim (datas, até 90 dias), e o substituto, que precisa ser outro gestor **ativo**;
   - durante o período (datas inclusivas, no fuso da organização), o substituto vê e decide as aprovações dos níveis do setor do ausente, só as que exigem aprovação (decisão A4 mantida), e recebe as notificações de "Aprovação pendente";
   - o ausente continua podendo decidir; a ausência não bloqueia ninguém;
   - períodos do mesmo gestor não se sobrepõem; o substituto não pode estar ausente em todo o período; cancelar uma ausência futura ou em curso é permitido;
   - a decisão do substituto registra "por substituição de …" no histórico.
6. **Prazo (decisão G6):**
   - opcional, por serviço: de 1 a 30 dias corridos para cada nível;
   - o prazo de um nível começa quando ele fica pendente; a solicitação guarda o vencimento do nível atual;
   - vencido, a tela mostra "Aprovação atrasada" (gestor, solicitante e equipe); o job diário avisa, uma vez por nível, os gestores do setor do nível e os substitutos em vigor ("Aprovação atrasada: …");
   - nada é decidido automaticamente;
   - "Análises" mostra quantas aprovações atrasaram no período.
7. **Condição (decisão G7):**
   - com "Exige aprovação" marcado, o serviço pode ter **uma** condição: um campo do solicitante, ativo, do tipo lista, sim ou não ou seleção múltipla, e um valor (igual a, ou contém, como nos campos condicionais);
   - na abertura, a solicitação exige aprovação só se a condição for atendida pelas respostas; sem condição, exige sempre (como hoje);
   - as regras de integridade da SPEC de campos condicionais (5.3) valem para o campo usado na condição da aprovação: não se desativa o campo nem se remove a opção usada enquanto a condição existir.
8. **Eventos:** cada decisão de nível grava `request.approval_decided` com o número do nível; não há tipo de evento novo **(decisão G8)**. A API e os webhooks passam a mostrar o nível.

### 4.4 Dados

- `Service`: `approvalSectorIds uuid[]` (padrão vazio = só o setor do serviço), `approvalDeadlineDays` (inteiro opcional, 1 a 30), `approvalConditionFieldId` e `approvalConditionValue` (opcionais, campo do mesmo serviço, chave composta como a dos campos condicionais).
- `Request`: `approvalSectorIdsSnapshot uuid[]`, `approvalLevel` (inteiro opcional, nível pendente, começando em 1), `approvalDueAt` (opcional), `approvalOverdueNotifiedAt` (opcional). `CHECK` de coerência com `approvalState`.
- `RequestApproval`: deixa de ser única por solicitação e passa a ser única por (`requestId`, `level`); ganha `level` (padrão 1 para as linhas existentes) e `onBehalfOfId` (opcional, o gestor ausente). A troca do índice único é a única mudança não aditiva e preserva todos os dados.
- Nova tabela `ManagerAbsence` (`managerId`, `substituteId`, `startsOn`, `endsOn`, `createdById`, `createdAt`, `cancelledAt`), com `CHECK` do período e índice por gestor e datas.

### 4.5 Critérios de aceitação

- [ ] **CA-APM-01** — Serviço com aprovação e sem níveis extra, prazo ou condição funciona como hoje; as decisões existentes aparecem como nível 1.
- [ ] **CA-APM-02** — A configuração aceita de 1 a 3 níveis com setores ativos, recusa setor inativo e o mesmo setor em níveis seguidos; a solicitação guarda a cópia dos níveis.
- [ ] **CA-APM-03** — Cada nível é decidido só por gestor (ou substituto em vigor) do setor do nível; aprovar avança, aprovar o último libera o atendimento e inicia o SLA; rejeitar em qualquer nível cancela; decisões simultâneas no mesmo nível gravam uma só.
- [ ] **CA-APM-04** — O gestor registra e cancela ausências com substituto; o sistema recusa período maior que 90 dias, sobreposto, substituto inativo, não gestor ou o próprio gestor; durante o período o substituto vê, decide e é notificado; fora dele, não.
- [ ] **CA-APM-05** — Com prazo, cada nível ganha vencimento ao ficar pendente; vencido, as telas mostram o atraso e o job avisa uma vez por nível os gestores e substitutos; nada é decidido sozinho.
- [ ] **CA-APM-06** — Com condição, a solicitação só exige aprovação quando a resposta atende à condição; as regras de integridade protegem o campo e a opção usados.
- [ ] **CA-APM-07** — A linha do tempo, a API e os webhooks mostram o nível e a substituição; "Análises" conta as aprovações atrasadas.
- [ ] **CA-APM-08** — Migrations com dados preservados (decisões existentes viram nível 1); nenhuma dependência nova.

## 5. Parte C — Fluxos

### 5.1 Escopo

1. **Responsável da etapa:** uma etapa pode indicar um atendente, que recebe a solicitação ao entrar nela **(decisão G9)**.
2. **Prazo da etapa:** meta em dias por etapa, com aviso de atraso **(decisão G10)**.
3. **Etapas condicionais:** uma etapa entra no fluxo da solicitação só quando uma resposta do solicitante atende a uma condição **(decisão G11)**.
4. **Filtro da fila por etapa.**

### 5.2 Fora de escopo

- Ramificação escolhida pelo atendente no meio do atendimento (caminhos alternativos), etapas paralelas e condições sobre campos do atendimento.
- Prazo de etapa somado ao SLA ou que muda o vencimento da solicitação.
- Responsável de etapa em outro setor, e equipe (mais de uma pessoa) por etapa.
- Relatórios por etapa além do que "Análises" já mostra.

### 5.3 Regras

1. **Responsável da etapa (decisão G9):**
   - opcional; precisa ser atendente ativo do setor do serviço no momento em que é configurado;
   - entra na cópia do fluxo no início do atendimento, junto com o nome (decisão W3 mantida);
   - ao entrar numa etapa (início, avanço ou retorno) que tem responsável na cópia, a solicitação passa para ele se ele ainda for atendente ativo do setor **atual** da solicitação; caso contrário, o responsável atual continua e o histórico registra "responsável da etapa indisponível";
   - a troca grava `request.assignment_changed` e a notificação de atribuição, como uma transferência feita por quem moveu a etapa;
   - etapa sem responsável não muda o responsável.
2. **Prazo da etapa (decisão G10):**
   - opcional, de 1 a 30 dias corridos, copiado no início;
   - ao entrar na etapa, a solicitação guarda o vencimento da etapa;
   - vencido, a fila e o detalhe mostram "Etapa atrasada"; o job diário avisa uma vez, por entrada na etapa, o responsável (ou, sem responsável, a equipe do setor);
   - a pausa "aguardando o solicitante" não pausa o prazo da etapa **(decisão G12)**;
   - o prazo da etapa não muda o SLA.
3. **Etapas condicionais (decisão G11):**
   - uma etapa pode ter **uma** condição sobre um campo do solicitante (mesmos tipos e operadores dos campos condicionais);
   - no início do atendimento, a cópia inclui só as etapas sem condição ou com a condição atendida, na ordem;
   - se nenhuma etapa entrar, a solicitação fica sem fluxo, como um serviço sem etapas;
   - as regras de integridade (5.3 da SPEC de campos condicionais) protegem o campo e a opção usados;
   - o limite de 8 etapas ativas continua contando todas, com ou sem condição.
4. **Filtro da fila por etapa:**
   - a fila ganha o filtro "Etapa", com os nomes das etapas atuais das solicitações em atendimento do setor, e a opção "Sem etapa";
   - o filtro entra na URL e combina com os outros, como na SPEC de busca.
5. **Transferência entre setores:** responsáveis de etapa da cópia que não forem do setor novo são ignorados (regra 1); o prazo da etapa continua.

### 5.4 Dados

- `ServiceStage`: `assigneeId` (opcional), `targetDays` (opcional, 1 a 30), `conditionFieldId` e `conditionValue` (opcionais, campo do mesmo serviço).
- `Request`: `stageAssigneeIdsSnapshot` e `stageTargetDaysSnapshot` (listas paralelas à cópia dos nomes, com o mesmo tamanho, verificado por `CHECK`), `stageDueAt` e `stageOverdueNotifiedAt` (opcionais).
- Índice para o filtro por etapa, se a medição com volume mostrar necessidade.

### 5.5 Critérios de aceitação

- [ ] **CA-ETP-01** — Etapas sem responsável, prazo ou condição funcionam como hoje.
- [ ] **CA-ETP-02** — A configuração aceita responsável (atendente ativo do setor), prazo (1 a 30) e condição válida, e recusa os demais; quem tem `SECTOR_SERVICES` configura como o administrador.
- [ ] **CA-ETP-03** — Ao entrar numa etapa com responsável, a solicitação passa para ele, com histórico, evento e notificação; com o responsável indisponível, nada muda e o histórico registra.
- [ ] **CA-ETP-04** — Com prazo, a etapa ganha vencimento ao entrar; vencido, as telas mostram o atraso e o job avisa uma vez por entrada; o SLA não muda.
- [ ] **CA-ETP-05** — A cópia inclui só as etapas com condição atendida; sem nenhuma, a solicitação fica sem fluxo; as regras de integridade protegem o campo usado.
- [ ] **CA-ETP-06** — O filtro por etapa (incluindo "Sem etapa") funciona com a busca e os outros filtros e fica na URL.
- [ ] **CA-ETP-07** — Migrations aditivas; solicitações existentes ficam com listas paralelas coerentes com a cópia.

## 6. Parte D — Permissões

### 6.1 Escopo

1. **Papéis:** o administrador cria papéis com um nome e um conjunto das permissões existentes, e atribui papéis a usuários **(decisão G13)**.
2. **Validade:** permissões individuais e atribuições de papel podem ter data de fim **(decisão G14)**.

### 6.2 Fora de escopo

- Permissões novas além das três da tabela 5.1 da SPEC de permissões, permissões em outros setores e permissões para solicitantes ou administradores.
- Papéis que removem regras de perfil; hierarquia de papéis.
- Pedido de permissão pelo próprio usuário com aprovação.

### 6.3 Regras

1. **Papéis (decisão G13):**
   - nome obrigatório, até 60 caracteres, único entre os ativos; descrição opcional até 200; de 1 a 3 permissões;
   - só o administrador cria, edita, desativa e reativa; um papel desativado deixa de ter efeito em todos os usuários, sem apagar as atribuições;
   - as permissões efetivas de uma pessoa são a **união** das individuais e das dos papéis ativos atribuídos, filtrada pelo perfil (tabela 5.1: o que o perfil não pode receber fica "sem efeito", como hoje);
   - todas as regras de efeito, setor e releitura a cada operação (5.2 e 5.3 da SPEC de permissões) valem igual.
2. **Validade (decisão G14):**
   - ao conceder uma permissão ou atribuir um papel, o administrador pode informar a data de fim (até 365 dias à frente);
   - depois do fim (fim do dia, no fuso da organização), a permissão ou o papel deixa de valer na operação seguinte, sem job;
   - a tela mostra "vence em …" e "vencida em …"; renovar é conceder de novo com nova data.
3. **Histórico:** criar, editar e desativar papéis entra na auditoria administrativa; atribuir e retirar papéis entra no histórico do usuário, com quem fez, quando e a validade.

### 6.4 Dados

- Nova tabela `AccessRole` (`id`, `name` `citext`, `description`, `permissions Permission[]`, `isActive`, datas), com `CHECK` do nome e de 1 a 3 permissões sem repetição.
- Nova tabela `UserAccessRole` (`userId`, `roleId`, `assignedById`, `assignedAt`, `expiresAt` opcional), única por (`userId`, `roleId`).
- Nova tabela `UserAccessRoleEvent` (atribuído ou retirado, com a validade).
- `UserPermission` ganha `expiresAt` (opcional); `UserPermissionEvent` ganha `expiresAt` (opcional).
- Enum da auditoria ganha `ACCESS_ROLE`.

### 6.5 Critérios de aceitação

- [ ] **CA-PAP-01** — Sem papéis e sem validade, as permissões funcionam como hoje.
- [ ] **CA-PAP-02** — Só o administrador cria, edita, desativa e reativa papéis; a configuração recusa nome vazio, longo ou repetido e papel sem permissão; as mudanças entram na auditoria.
- [ ] **CA-PAP-03** — Atribuir um papel dá as suas permissões na operação seguinte (respeitando o perfil e o setor); retirar ou desativar o papel tira na operação seguinte.
- [ ] **CA-PAP-04** — Permissão e papel com data de fim deixam de valer depois dela, sem novo login; a tela mostra a validade; data no passado ou além de 365 dias é recusada.
- [ ] **CA-PAP-05** — O histórico do usuário mostra atribuições e retiradas de papéis com a validade.
- [ ] **CA-PAP-06** — Migration aditiva; nenhuma dependência nova.

## 7. Parte E — Escalonamento

### 7.1 Escopo

Regras de escalonamento por setor, **além** da opção "Escalar solicitações vencidas" que já existe **(decisão G15)**:

1. **Gatilhos:** "próximo do vencimento" ou "vencida há N dias" (N de 1 a 30).
2. **Ações:** subir a prioridade um nível e/ou atribuir a um atendente escolhido.
3. **Destinatários do aviso:** gestores do setor, equipe do setor e/ou pessoas escolhidas (atendentes ou gestores ativos do setor).

### 7.2 Fora de escopo

- Gatilhos em horas (o job é diário, decisão G1) e gatilhos por outra condição (prioridade, serviço, campo).
- Escalonamento para outro setor (já existe o encaminhamento manual entre setores).
- Recalcular o vencimento (decisão E4 mantida).

### 7.3 Regras

1. Só o administrador configura, na seção "Setores"; até 5 regras por setor **(decisão G16)**; a mesma combinação de gatilho e N não se repete no setor; cada regra tem pelo menos uma ação ou um destinatário.
2. O job diário aplica cada regra **uma vez por solicitação e por vencimento**: uma reabertura com novo prazo pode escalar de novo; durante a pausa, nada é escalado (regras E da SPEC de escalonamento mantidas).
3. **Ações:**
   - subir a prioridade segue a regra E2 (até Urgente) e não recalcula o vencimento;
   - atribuir passa a solicitação ao atendente escolhido se ele for ativo do setor atual; senão, a atribuição é ignorada e registrada; atribuir não acontece se a solicitação estiver concluída ou cancelada;
   - a atribuição grava `request.assignment_changed` e notifica como uma transferência, com o sistema como autor **(decisão G17)**.
4. **Avisos:** notificação `sla.escalated` aos destinatários escolhidos, com o nome da regra, seguindo a preferência de e-mail "Prazos"; ninguém recebe o mesmo aviso duas vezes na mesma execução.
5. Cada aplicação de regra fica no bloco "Escalonamentos" do detalhe, com o gatilho e as ações feitas; "Análises" passa a separar as escaladas por gatilho.
6. Regras se aplicam ao setor **atual** da solicitação; mudar ou apagar regras não desfaz escalonamentos já feitos.

### 7.4 Dados

- Nova tabela `SectorEscalationRule` (`sectorId`, `trigger` `DUE_SOON` ou `OVERDUE_DAYS`, `overdueDays` opcional, `raisePriority`, `assignToId` opcional, `notifyManagers`, `notifyTeam`, `notifyUserIds uuid[]`, `isActive`, datas), com `CHECK`s da combinação.
- `RequestEscalation` ganha `trigger` (padrão `OVERDUE` para as linhas existentes), `ruleId` opcional, `assignedToId` opcional e a chave do vencimento (`dueAt` da solicitação no momento), com índice único para não repetir a regra no mesmo vencimento.
- Mudanças das regras entram na auditoria administrativa.

### 7.5 Critérios de aceitação

- [ ] **CA-ESR-01** — Setor sem regras se comporta como hoje, com ou sem a opção de vencidas ligada.
- [ ] **CA-ESR-02** — O administrador cria, edita, desativa e apaga regras; a configuração recusa mais de 5, combinação repetida, N fora de 1 a 30, regra sem ação nem destinatário e destinatário de outro setor; outros perfis são recusados; as mudanças entram na auditoria.
- [ ] **CA-ESR-03** — O job aplica "próximo do vencimento" e "vencida há N dias" uma vez por solicitação e vencimento; não aplica durante a pausa; aplica de novo depois de reabertura com novo prazo; duas execuções simultâneas não duplicam.
- [ ] **CA-ESR-04** — As ações sobem a prioridade e atribuem ao atendente ativo do setor; atendente indisponível é ignorado e registrado.
- [ ] **CA-ESR-05** — Os destinatários escolhidos recebem um aviso cada, conforme a preferência de e-mail.
- [ ] **CA-ESR-06** — O detalhe mostra cada aplicação com gatilho e ações; "Análises" separa por gatilho.
- [ ] **CA-ESR-07** — Migration aditiva; escalonamentos existentes ficam com gatilho "vencida".

## 8. Testes

Cada parte segue o padrão das SPECs anteriores, em três camadas:
- **Unitários:** validações de configuração e dos tipos novos; regras de níveis, ausência, prazos, condições, união de permissões e validade; planejamento de notificações e ações do escalonamento.
- **Integração (banco real):** schema e `CHECK`s; casos de uso com perfis e setores; concorrência nas decisões, no avanço de etapa e no job; leitura com escopo; auditoria.
- **E2E:** um percurso por parte, pela tela (campos novos na abertura e busca; dois níveis com substituto; fluxo com etapa condicional e responsável; papel com validade; regra de escalonamento aplicada pela rota protegida do job).
- **Volume:** busca pelas respostas e filtro por etapa medidos no banco `serviceflow_perf` da SF-160.

## 9. Tarefas

| Tarefa | Parte | Conteúdo |
|---|---|---|
| SF-161 | A | Migrations e domínio: decimal e formatos, validação, normalização e exibição |
| SF-162 | A | Configuração, abertura, atendimento, API e OpenAPI dos tipos novos |
| SF-163 | A | Busca pelas respostas nas três listas, medição com volume, E2E |
| SF-164 | B | Migrations e domínio: níveis, cópia, decisão por nível, condição |
| SF-165 | B | Ausência e substituto: cadastro, leitura, decisão e notificações |
| SF-166 | B | Prazo de aprovação: vencimento por nível, job, telas e análises |
| SF-167 | B | Telas, API, webhooks e E2E das aprovações |
| SF-168 | C | Migrations e domínio: responsável, prazo e condição das etapas, cópia |
| SF-169 | C | Movimento com responsável da etapa, prazo, job e notificações |
| SF-170 | C | Filtro por etapa, telas, medição e E2E |
| SF-171 | D | Migrations e domínio: papéis, união de permissões, validade |
| SF-172 | D | Telas de papéis e de validade, histórico, auditoria e E2E |
| SF-173 | E | Migrations, domínio e configuração das regras de escalonamento |
| SF-174 | E | Aplicação no job, ações, avisos, telas, análises e E2E |

**Ordem:** A → B → C → D → E. A parte A vem primeiro porque não depende de nada; B e C reaproveitam a regra de condição dos campos; D e E são independentes e ficam por último por serem menores. Cada parte termina com todas as suítes aprovadas e com registro em `NOTES.md` das linhas novas (aplicação e testes, separadas).

**Estimativa:** de 9.000 a 14.000 linhas `added` no total, pela média medida em 2026-11-06 (cerca de 1.200 linhas por funcionalidade, com as de banco e regras chegando a 2.600).

## 10. Decisões tomadas (2026-11-06)

Adotadas como recomendadas; podem ser revistas pela responsável antes do início de cada parte.

| # | Questão | Decisão | Alternativa descartada |
|---|---|---|---|
| G1 | Unidade dos prazos novos | Dias, com aviso no job diário | Horas (o job roda uma vez por dia; um prazo em horas avisaria com até 24 h de atraso) |
| G2 | Quais formatos | E-mail, telefone, CPF, CNPJ e CEP, fixos no código | Expressão regular definida pelo administrador (difícil de validar e de explicar) |
| G3 | Busca pelas respostas | No mesmo campo "Buscar" das listas | Filtro separado por campo e valor |
| G4 | Níveis de aprovação | 1 a 3 níveis em sequência, cada um por setor | Aprovador escolhido pelo nome; níveis paralelos |
| G5 | Gestor ausente | Período com substituto, que soma ao ausente | Substituto que bloqueia o ausente; delegação sem período |
| G6 | Prazo vencido | Só avisa e mostra; nada automático | Aprovar ou rejeitar automaticamente |
| G7 | Aprovação por condição | Uma condição sobre campo do solicitante, como nos campos condicionais | Condições com vários critérios ou sobre valores numéricos |
| G8 | Eventos das aprovações | Mesmo `request.approval_decided`, com o nível | Tipos novos (exigiriam recriar as restrições da outbox e dos webhooks) |
| G9 | Responsável da etapa | Atribui ao entrar, se ainda for do setor | Só sugerir o responsável |
| G10 | Prazo da etapa | Meta em dias, com aviso; sem efeito no SLA | Somar ao SLA |
| G11 | Ramificações | Etapas condicionais decididas no início | Caminhos escolhidos pelo atendente no meio do atendimento |
| G12 | Pausa e prazo da etapa | A pausa não pausa a etapa | Pausar também a etapa (mais regras, pouco ganho) |
| G13 | Papéis | Conjuntos das três permissões existentes, somados às individuais | Papéis substituindo as permissões individuais |
| G14 | Validade | Data de fim, verificada a cada operação | Job que revoga e registra a revogação |
| G15 | Escalonamento configurável | Regras extras; a opção de vencidas fica como está | Trocar a opção por regras (exigiria converter dados e mudaria o comportamento atual) |
| G16 | Limite de regras | 5 por setor | Sem limite |
| G17 | Autor da atribuição automática | O sistema | Um usuário técnico |
| G18 | Integridade das condições | As regras 5.3 da SPEC de campos condicionais valem para aprovação e etapas | Regras próprias de cada parte |
| G19 | Quem configura níveis, prazos e etapas | Quem já configura o serviço (administrador ou `SECTOR_SERVICES`) | Só o administrador |
| G20 | Ordem das partes | A → B → C → D → E | Por tamanho |
