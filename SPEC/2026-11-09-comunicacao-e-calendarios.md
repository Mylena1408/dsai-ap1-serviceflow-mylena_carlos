# SPEC — Comunicação, importação, relatórios e calendários

**Data:** 2026-11-09
**Status:** Revisada com a responsável em 2026-11-09 ("vamos revisar"), perto do fim da SPEC `2026-11-08-atendimento-dia-a-dia`, como ela pediu ("deixe a spec 2 para quando a spec 1 estiver perto do fim, me avise e revisamos"). Cobre os itens 7 a 10 do levantamento de funcionalidades para a meta. As quatro decisões da revisão estão na seção 8 (K1 a K4); as demais (K5 em diante) foram adotadas como recomendadas e podem ser revistas por ela antes de cada parte. A implementação começa depois da SPEC 1.
**Projeto:** ServiceFlow
**Referências:**
- `SPEC/2026-11-08-atendimento-dia-a-dia.md` (SPEC 1; garantia e exclusões de segurança repetidas aqui);
- `SPEC/2026-11-03-pausa-sla-calendario.md` (calendário da organização, feriados, prazo em horas úteis, pausas);
- `SPEC/2026-11-01-notificacoes-email-preferencias.md` (avisos, categorias de e-mail, preferências);
- `SPEC/2026-11-02-painel-relatorios.md` e `SPEC/2026-11-06-analises-operacionais.md` (painel, períodos, escopo por setor);
- `SPEC/2026-11-07-operacao-e-automacao.md` (configuração portátil: prévia e aplicação);
- `SPEC/2026-11-02-auditoria-lgpd.md` (auditoria administrativa, anonimização);
- `SPEC/2026-10-29-plano-escala-100k.md` (garantia 7.4; meta de linhas).

## 1. Objetivo

A organização já configura setores, serviços e regras, e o atendimento já tem os recursos do dia a dia. Faltam formas de **falar com todos** (avisos e manutenções), de **trazer as pessoas em lote** (importação de usuários), de **receber o resumo do período sem precisar abrir telas** (relatório periódico) e de **respeitar o expediente de cada setor** (calendário por setor). Esta SPEC acrescenta esses recursos em cinco partes independentes:

| Parte | O que acrescenta |
|---|---|
| A — Avisos e manutenção | Avisos com período e público, faixa no topo das telas, janelas de manutenção anunciadas |
| B — Importação de usuários | CSV com prévia linha a linha, aplicação com auditoria, pessoas criadas inativas e sem senha |
| C — Relatório periódico | Resumo semanal e mensal por setor, guardado com histórico, com e-mail opcional |
| D — Calendário por setor | Expediente e feriados próprios de um setor, usados no prazo das solicitações abertas depois |
| E — Complementos | Avisos e calendários na configuração portátil, leitura na API, e o histórico dos relatórios em "Análises" |

## 2. Registro da mudança de escopo e garantia

Nenhum destes recursos estava previsto em SPEC anterior; esta SPEC é o registro que autoriza implementá-los. Todos são genéricos.

**Garantia 7.4 do plano, para todas as partes:** quem não usa um recurso novo não percebe mudança. Sem avisos, a faixa não aparece; sem importação, os usuários são criados como hoje; sem relatório ativo, nada é gerado; setores sem calendário próprio usam o da organização exatamente como hoje; as suítes anteriores passam sem alteração de asserções (exceto listas exatas que esta SPEC amplia, como entidades da auditoria, tipos e categorias de aviso, operações da API e o formato da configuração portátil).

**Fora desta SPEC, por decisão da responsável:** nada muda em autenticação, senhas, sessões, perfis ou permissões. A importação de usuários não define senhas (decisão K1); as pessoas importadas entram inativas e o administrador as ativa e define a senha pela tela que já existe.

## 3. Parte A — Avisos e manutenção programada

### 3.1 Escopo

1. **Avisos:** o administrador cadastra avisos com título, texto curto, nível (informação, atenção), período de exibição e público (todos, um perfil, um setor).
2. **Faixa:** durante o período, o aviso aparece numa faixa no topo das telas de quem está no público; cada pessoa pode dispensar um aviso de nível "informação" (o de "atenção" fica até o fim do período).
3. **Manutenção programada:** um aviso pode ser uma janela de manutenção (início e fim); a faixa aparece com antecedência configurável (padrão 24 horas) e durante a janela, com "Manutenção em andamento" **(decisão K2: só avisa, nada é bloqueado)**.
4. **Histórico:** a página "Avisos" mostra os avisos em vigor e os anteriores (últimos 90 dias) do público da pessoa.

### 3.2 Fora de escopo

- Bloquear aberturas ou o acesso durante a manutenção (K2); avisos por e-mail; avisos para pessoas sem conta.

### 3.3 Regras

1. **Valores:** título de 1 a 80 caracteres, texto de 1 a 500, período com fim depois do início e de no máximo 90 dias; manutenção com fim depois do início e de no máximo 24 horas; antecedência de 0 a 168 horas.
2. **Público:** "todos", um perfil (administrador, gestor, atendente, solicitante) ou um setor (as pessoas daquele setor, de qualquer perfil); um aviso tem um público.
3. **Limite:** até 3 avisos visíveis ao mesmo tempo para uma pessoa, os de "atenção" e as manutenções primeiro, depois os mais recentes.
4. **Dispensa:** guardada por pessoa e aviso; não volta a aparecer para ela; não se aplica a "atenção" nem a manutenção.
5. **Auditoria:** criar, alterar, encerrar antes do fim e apagar um aviso que ainda não começou entram na auditoria.

- *Esclarecimentos registrados em 2026-11-14 (SF-234):* os dados ficam em `Announcement` (título, texto, nível `INFO`/`WARNING`, tipo `NOTICE`/`MAINTENANCE`, público `ALL`/`ROLE`/`SECTOR` com o perfil ou o setor, início, fim, antecedência e quem criou) e `AnnouncementDismissal` (pessoa, aviso e quando dispensou, uma linha por par); a auditoria ganha a entidade `ANNOUNCEMENT`. O banco confere a regra 1 e a 2 por `CHECK`: título e texto sem espaços nas pontas; fim depois do início; aviso de até 90 dias e sem antecedência; manutenção de até 24 horas, com antecedência de 0 a 168 horas e sempre de nível "atenção" (como na regra 4, que não a deixa ser dispensada); o perfil só no público "um perfil" e o setor só no público "um setor". Datas e horas são digitadas no fuso da organização. Para a manutenção, o início e o fim são os da janela, e a faixa vale da antecedência antes do início até o fim. Um aviso "começou" no seu início (para a manutenção, o início da janela): antes disso, pode ser alterado ou apagado (apagar uma manutenção ainda na antecedência é cancelá-la); durante, pode ser alterado ou encerrado, e "encerrar antes do fim" muda o fim para o instante do encerramento; um aviso que já terminou não muda mais. Como só o aviso de "informação" já na tela pode ser dispensado, um aviso que ainda não começou nunca tem dispensas. Criar ou alterar exige um fim ainda no futuro. Na ordem da regra 3, "mais recentes" são os de início mais recente. A antecedência só existe na manutenção; num aviso comum, ela é ignorada.
- *Esclarecimentos registrados em 2026-11-14 (SF-235):* só o administrador cadastra, na seção "Avisos" da administração (como as demais configurações da organização). A lista mostra primeiro os avisos em andamento, depois os programados e por último os encerrados nos últimos 90 dias, cada um com o tipo, o nível, o público, o período (para a manutenção, também o início da faixa) e a situação. O formulário pede título, texto, tipo, nível (só para o aviso comum), público com o perfil ou o setor, início, fim e antecedência (só para a manutenção, padrão 24 horas); o setor do público precisa estar ativo. Ao alterar um aviso em andamento, o início não pode ir para depois do instante da alteração (o aviso continuaria "começado" e poderia ter dispensas). "Encerrar" aparece só no aviso em andamento e "Apagar" só no programado; na auditoria, encerrar é uma alteração do fim ("Fim: … → …") e apagar é "Removeu". A auditoria mostra o tipo, o nível, o público e o perfil pelos nomes, o setor pelo nome e as datas no fuso da organização. Cada recusa tem a sua mensagem.

### 3.4 Critérios de aceitação

- [ ] **CA-AVI-01** — Sem avisos, as telas não mudam.
- [x] **CA-AVI-02** — O administrador cadastra, altera e encerra avisos com os limites da regra 1, com auditoria. *Verificado em 2026-11-14 (SF-234 e SF-235): só o administrador, na seção "Avisos"; os limites da regra 1 recusados pelo formulário e pelo banco, cada um com a sua mensagem; alterar até o fim (sem levar o início de um aviso em andamento para depois de agora), encerrar o que está em andamento e apagar o programado; criar, alterar, encerrar e apagar na auditoria, com o público, o setor e as datas legíveis; gestor e atendente recusados (unitário e integração).*
- [ ] **CA-AVI-03** — A faixa aparece só para o público, no período, com o limite e a ordem da regra 3; a dispensa vale por pessoa.
- [ ] **CA-AVI-04** — A manutenção aparece com a antecedência e durante a janela, sem bloquear nada.
- [x] **CA-AVI-05** — Migration aditiva; nenhuma dependência nova. *Verificado em 2026-11-14 (SF-234): migration `20261114100000_announcements` só acrescenta (três enums, duas tabelas, índices, chaves e `CHECK`s, e o valor `ANNOUNCEMENT` no enum da auditoria); `package.json` sem mudança; cada recusa do banco conferida pelo nome da restrição, inclusive com as colunas opcionais nulas (integração).*

## 4. Parte B — Importação de usuários por CSV

### 4.1 Escopo

1. **Modelo:** o administrador baixa um CSV de exemplo com as colunas `nome`, `email`, `perfil`, `setor`.
2. **Prévia:** ao enviar o arquivo, o sistema mostra cada linha com o resultado previsto (criar, ignorar porque o e-mail já existe, erro com o motivo), sem gravar nada.
3. **Aplicação:** confirmada a prévia, as linhas válidas são criadas numa transação, com uma entrada de auditoria por pessoa e uma da importação **(decisão K1: inativas e sem senha utilizável)**.
4. **Histórico:** as importações ficam registradas (quem, quando, quantas criadas, ignoradas e com erro), com o relatório de erros em CSV.

### 4.2 Fora de escopo

- Senhas no arquivo, convites por e-mail, alterar ou desativar pessoas que já existem, importar permissões ou papéis de acesso.

### 4.3 Regras

1. **Arquivo:** CSV em UTF-8 com separador `;` ou `,`, cabeçalho obrigatório, até 500 linhas e 200 KB; células perigosas para planilhas são lidas como texto.
2. **Linha válida:** nome de 1 a 120 caracteres, e-mail válido e ainda não usado (nem repetido no arquivo), perfil entre os quatro, setor por nome de um setor ativo (obrigatório para atendente e gestor, vazio para solicitante e administrador).
3. **Criação:** cada pessoa entra inativa, com uma senha inutilizável (como a anonimização já faz), e só passa a entrar quando o administrador a ativa e define a senha pela tela que existe hoje.
4. **Mesma prévia:** a aplicação refaz a prévia com o banco do momento; se algo mudou (um e-mail passou a existir), aplica só o que continua válido e o relatório diz o que ficou de fora.

### 4.4 Critérios de aceitação

- [ ] **CA-IMP-01** — Sem importação, criar usuários continua como hoje.
- [ ] **CA-IMP-02** — A prévia mostra o resultado de cada linha com os limites das regras 1 e 2, sem gravar nada.
- [ ] **CA-IMP-03** — A aplicação cria só as linhas válidas, inativas e sem senha, com auditoria e histórico; o relatório de erros sai em CSV.
- [ ] **CA-IMP-04** — Nenhuma regra de senha, sessão, perfil ou permissão muda.

## 5. Parte C — Relatório periódico

### 5.1 Escopo

1. **Conteúdo:** por setor e para a organização, no período (a semana anterior, de segunda a domingo, ou o mês anterior): solicitações abertas, concluídas e canceladas; concluídas no prazo; tempo mediano de atendimento; avaliação média; horas lançadas; as cinco etiquetas mais usadas.
2. **Geração:** o job diário gera, na segunda-feira, o relatório semanal e, no dia 1, o mensal, uma vez por período; o resultado fica guardado (os números, não as solicitações).
3. **Leitura:** gestores leem os do próprio setor; o administrador, todos e o da organização; a página "Relatórios" lista o histórico e mostra cada um.
4. **E-mail (decisão K3):** quem quiser recebe um e-mail curto quando sai o relatório que pode ler, pela categoria nova "Relatórios" das preferências de aviso.

### 5.2 Fora de escopo

- Relatórios personalizados, por atendente, com listas de solicitações ou anexos.

### 5.3 Regras

1. **Uma vez por período:** o par (tipo, período, escopo) é único; rodar o job de novo não duplica.
2. **Números do momento:** o relatório guarda os números calculados na geração; mudanças posteriores nas solicitações não o alteram.
3. **Ativação:** o administrador liga ou desliga o semanal e o mensal (os dois começam desligados); desligar não apaga o histórico.
4. **E-mail:** só aviso no aplicativo e, se a pessoa quiser, e-mail; o conteúdo do e-mail tem só os números principais e o link.

### 5.4 Critérios de aceitação

- [ ] **CA-REL-01** — Sem relatório ativo, nada é gerado e as telas não mudam.
- [ ] **CA-REL-02** — O job gera cada relatório uma vez por período e escopo, com os números do momento.
- [ ] **CA-REL-03** — Cada pessoa lê só os relatórios do seu escopo; o histórico fica na página "Relatórios".
- [ ] **CA-REL-04** — O aviso e o e-mail respeitam a preferência da categoria "Relatórios".

## 6. Parte D — Calendário por setor

### 6.1 Escopo

1. **Calendário próprio:** um setor pode ter dias da semana e horário de expediente próprios; sem isso, usa o da organização.
2. **Feriados do setor:** além dos feriados da organização, um setor pode ter os seus (data, nome, se repete todo ano).
3. **Uso:** o prazo de uma solicitação aberta em horas úteis usa o calendário do setor que a recebeu na abertura **(decisão K4: só as abertas depois; as já abertas mantêm o prazo)**.

### 6.2 Fora de escopo

- Calendário por atendente; turnos; mudar o prazo de solicitações já abertas.

### 6.3 Regras

1. **Quem configura:** o administrador, para qualquer setor; o gestor, para o próprio setor; com auditoria.
2. **Valores:** os mesmos do calendário da organização (dias, início e fim do expediente, fuso da organização).
3. **Cópia na abertura:** a solicitação guarda de qual calendário veio o prazo (o do setor ou o da organização); pausas, retomadas e mudanças de prioridade usam esse mesmo calendário; o encaminhamento para outro setor não troca o calendário (o prazo continua o combinado na abertura).
4. **Sem calendário próprio:** o setor segue o da organização, inclusive as mudanças futuras dele.

### 6.4 Critérios de aceitação

- [ ] **CA-CAL-01** — Setores sem calendário próprio se comportam exatamente como hoje.
- [ ] **CA-CAL-02** — Administrador e gestor configuram o calendário e os feriados do setor, com auditoria.
- [ ] **CA-CAL-03** — Solicitações abertas depois usam o calendário do setor, inclusive nas pausas e mudanças de prioridade; as já abertas não mudam.
- [ ] **CA-CAL-04** — Migration aditiva; nenhuma dependência nova.

## 7. Parte E — Complementos

1. **Configuração portátil versão 3:** inclui avisos futuros e calendários e feriados de setor, aceitando as versões 1 e 2.
2. **API pública (só leitura):** avisos em vigor para o dono do token; o calendário efetivo de um setor.
3. **"Análises":** um bloco com os últimos relatórios periódicos do escopo, ligado à página "Relatórios".

- [ ] **CA-COM-01** — A configuração portátil leva e traz avisos futuros e calendários de setor, aceitando as versões anteriores.
- [ ] **CA-COM-02** — A API e "Análises" mostram os dados novos só a quem já pode lê-los.

## 8. Decisões (2026-11-09)

| # | Questão | Decisão | Alternativa descartada |
|---|---|---|---|
| K1 | Senha dos importados | Inativos e sem senha; o administrador ativa e define pela tela atual (escolha da responsável) | Senha inicial no CSV (guarda senhas num arquivo e mexe no fluxo da conta) |
| K2 | Manutenção | Só avisa (escolha da responsável) | Bloquear aberturas |
| K3 | Relatório periódico | Página com histórico e e-mail opcional (escolha da responsável) | Só página |
| K4 | Calendário por setor | Só as solicitações abertas depois (escolha da responsável) | Recalcular as abertas |
| K5 | Dispensar avisos | Só os de "informação" | Qualquer aviso |
| K6 | Público do aviso | Um público por aviso | Vários públicos |
| K7 | Período do relatório | Semana de segunda a domingo e mês civil | Últimos 7 e 30 dias |
| K8 | Calendário no encaminhamento | Mantém o da abertura | Trocar pelo do setor novo |
| K9 | Quem configura o calendário do setor | Administrador e gestor do setor | Só o administrador |

## 9. Testes

Cada parte segue o padrão das SPECs anteriores: unitários das regras e das telas; integração com o banco real (schema, `CHECK`s, casos de uso, escopo de leitura, transações, job); um E2E por parte. A importação tem testes com arquivos inválidos (separador, cabeçalho, tamanho, células perigosas); o calendário tem testes de prazo com feriado do setor, pausa e mudança de prioridade.

## 10. Tarefas

| Tarefa | Parte | Conteúdo |
|---|---|---|
| SF-234 | A | Migrations e domínio dos avisos |
| SF-235 | A | Cadastro de avisos na administração, com auditoria |
| SF-236 | A | Faixa dos avisos nas áreas, público e limite |
| SF-237 | A | Dispensa por pessoa |
| SF-238 | A | Manutenção programada e antecedência |
| SF-239 | A | Página "Avisos" com o histórico |
| SF-240 | A | Telas e E2E da parte A |
| SF-241 | B | Formato do CSV e domínio da importação |
| SF-242 | B | Prévia linha a linha |
| SF-243 | B | Aplicação com auditoria, pessoas inativas e sem senha |
| SF-244 | B | Histórico das importações e relatório de erros |
| SF-245 | B | Modelo do CSV, telas e E2E da parte B |
| SF-246 | C | Migrations e domínio dos relatórios |
| SF-247 | C | Cálculo dos números do período |
| SF-248 | C | Geração pelo job, uma vez por período |
| SF-249 | C | Página "Relatórios" com escopo e histórico |
| SF-250 | C | Categoria "Relatórios", aviso e e-mail |
| SF-251 | C | Ativação pelo administrador e E2E da parte C |
| SF-252 | D | Migrations e domínio do calendário do setor |
| SF-253 | D | Configuração do calendário e dos feriados do setor |
| SF-254 | D | Prazo da abertura pelo calendário do setor |
| SF-255 | D | Pausas, retomadas e prioridade com o calendário guardado |
| SF-256 | D | Telas e E2E da parte D |
| SF-257 | E | Configuração portátil versão 3 |
| SF-258 | E | API pública: avisos e calendário |
| SF-259 | E | Relatórios em "Análises" e revisão final |

**Ordem:** A → B → C → D → E. **Estimativa:** pela média real da SPEC 1 (de 300 a 450 linhas por tarefa, mais nas tarefas de telas e de regras de prazo), 26 tarefas dariam de 9.000 a 12.000 linhas; para cobrir o que falta à meta (cerca de 15.500 a 16.500 linhas depois da SPEC 1), esta SPEC deve ser aprofundada como a SPEC 1 foi (seção 13 dela), com acréscimos registrados aqui antes de implementar. Os acréscimos serão propostos à responsável quando a parte A começar.
