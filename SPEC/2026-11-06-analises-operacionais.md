# SPEC — Análises operacionais: painel do atendente, tendências, SLA detalhado e desempenho da equipe

**Data:** 2026-11-06
**Status:** Aprovada em 2026-11-06. A responsável pediu "funcionalidades de análises como dashboards para uso dos profissionais desta aplicação web" e marcou as quatro partes propostas: painel do atendente, tendências no tempo, SLA e tempos detalhados, e desempenho por atendente. As decisões A1 a A9 da seção 11 foram adotadas como recomendadas; a responsável pode rever qualquer uma.
**Projeto:** ServiceFlow
**Referências:**
- `SPEC/2026-11-02-painel-relatorios.md`: painel existente, período e indicadores. Esta SPEC amplia o "fora de escopo" daquela.
- `SPEC/2026-11-01-sla-prioridades.md`: situação do prazo e `completedLate`.
- `SPEC/2026-11-01-fluxos-configuraveis.md`: etapas.
- `SPEC/2026-11-03-pausa-sla-calendario.md`: pausas.
- `SPEC/2026-10-31-comentarios.md`: comentários e notas internas.
- `SPEC/2026-11-02-auditoria-lgpd.md`: dados pessoais.

## 1. Objetivo

O painel atual mostra **totais do período** ao administrador e ao gestor. Esta SPEC acrescenta análises para quem trabalha no dia a dia:

1. **Painel do atendente:** a fila do setor em números, para o atendente decidir o que pegar primeiro, e o próprio resultado no período.
2. **Tendências:** como as solicitações evoluem dia a dia ou semana a semana — entrada, saída, pendências acumuladas e cumprimento do prazo.
3. **SLA e tempos detalhados:** onde o tempo é gasto:
   - primeira resposta;
   - cada etapa do fluxo;
   - pausas;
   - prazo por serviço e por prioridade;
   - horários de maior procura.
4. **Desempenho da equipe:** números por atendente, para o gestor distribuir o trabalho.

## 2. Registro da mudança de escopo

A SPEC do painel deixou fora de escopo "painel para solicitantes e atendentes" e "indicadores por pessoa". Esta SPEC inclui:
- o painel do **atendente**, que mostra só o setor dele e os próprios números;
- os **indicadores por pessoa**, visíveis **só** ao gestor do setor e ao administrador, com as salvaguardas da seção 5.6.

O painel do **solicitante** continua fora.

Nada do que existe muda:
- o painel atual e a exportação CSV ficam iguais;
- as regras de leitura de cada solicitação não mudam;
- nenhuma tela de análise tem link para solicitações;
- não há migration.

## 3. Escopo

1. Página **"Meu painel"** do atendente, em `/queue/dashboard` **(decisão A1)**.
2. Página **"Análises"**:
   - para o administrador, na seção `/admin?section=analytics`, com filtro de setor;
   - para o gestor, em `/approvals/analytics`, só com o próprio setor **(decisão A2)**.

   Ela tem três blocos: Tendências, SLA e tempos, e Desempenho da equipe.
3. O mesmo filtro de período do painel atual: 7, 30 ou 90 dias, ou um intervalo de até 366 dias, contado no fuso `America/Sao_Paulo`.
4. Gráficos em **SVG gerado no servidor** e barras em HTML e CSS, cada um com uma tabela equivalente, **sem dependência nova** **(decisão A3)**.

## 4. Fora de escopo

- Painel do solicitante.
- Metas e alertas sobre indicadores; relatórios agendados ou por e-mail.
- Exportação das análises novas, como CSV de tendências ou da equipe. A exportação existente continua.
- Comparar atendentes entre setores numa classificação. A tabela da equipe é por setor e em ordem alfabética **(decisão A7)**.
- Tabelas de agregação, cache ou histórico de indicadores: tudo é calculado na visita.
- Avaliação de satisfação: não há esse dado.

## 5. Regras

### 5.1 Quem vê o quê **(decisões A1, A2 e A7)**

| Perfil | Meu painel | Análises: Tendências e SLA | Análises: Desempenho da equipe |
|---|---|---|---|
| Atendente ativo com setor ativo | Sim, do setor atual e dos próprios números | Não | Não |
| Gestor ativo com setor ativo | Não | Só do setor atual | Só dos atendentes do setor atual |
| Administrador | Não | Organização inteira ou um setor | Por setor; sem filtro, todas as pessoas com o setor de cada uma |
| Solicitante | Não | Não | Não |

Regras de acesso:
- Atendente ou gestor sem setor ativo vê a página vazia, com o aviso "Você não está ligado a um setor ativo".
- Quem não tem acesso é levado para a própria página inicial, como no painel atual.
- Todo recorte é decidido no servidor, a partir da sessão. O gestor e o atendente não escolhem o setor.

### 5.2 Período e intervalos dos gráficos **(decisão A4)**

O período é o mesmo do painel atual (`parseReportPeriod`), com os mesmos erros e o mesmo período padrão de 30 dias. As séries são agrupadas assim:
- **por dia**, em períodos de até 31 dias;
- **por semana**, de segunda a domingo, em períodos maiores. A primeira e a última semana podem ser parciais, e o rótulo diz o intervalo.

Todos os dias são contados no fuso `America/Sao_Paulo`.

### 5.3 Meu painel (atendente) **(decisão A1)**

**Fila agora** (setor atual, sem depender do período):

| Indicador | Regra |
|---|---|
| Sem responsável | Abertas ou em atendimento, sem responsável e sem aprovação pendente |
| Comigo | Abertas ou em atendimento com o atendente como responsável |
| Próximas do vencimento / Vencidas / Prazo pausado | Mesmas regras do painel atual, no setor |
| Por prioridade | Abertas ou em atendimento, por prioridade (Urgente, Alta, Normal, Baixa), com barras |
| Por etapa | Em atendimento, pelo nome da etapa atual; "Sem etapa" quando o serviço não tem fluxo |

**Meu período** (solicitações do setor atual em que o atendente é o responsável):

| Indicador | Regra |
|---|---|
| Concluídas por mim | Concluídas no período com o atendente como responsável **(decisão A5)** |
| Tempo até a conclusão | Média e mediana das anteriores, da abertura à conclusão |
| Concluídas no prazo | Percentual, entre as anteriores, das que tinham prazo |
| Respostas que escrevi | Comentários **não internos** do atendente no período, em solicitações do setor |

Ao lado de cada número de "Meu período" aparece o total do setor no período, para dar referência, **sem nomes de colegas**.

### 5.4 Tendências **(decisão A4)**

Para cada intervalo (dia ou semana) do período, no recorte autorizado:

| Série | Regra |
|---|---|
| Abertas | Solicitações abertas no intervalo |
| Concluídas | Concluídas no intervalo, pela data de conclusão (mesma regra do painel) |
| Pendentes ao fim | Solicitações cujo **último evento de status** até o fim do intervalo é "Aberta" ou "Em atendimento". Assim, reaberturas e cancelamentos contam certo |
| No prazo | Percentual das concluídas no intervalo que tinham prazo e terminaram nele. Sem nenhuma com prazo, o ponto fica vazio, e a linha não liga pontos vazios |

Gráficos:
- **Abertas × Concluídas:** colunas lado a lado por intervalo.
- **Pendentes ao fim:** linha.
- **No prazo (%):** linha de 0 a 100.

São três gráficos separados, cada um com o seu eixo; **nunca** dois eixos no mesmo gráfico.

### 5.5 SLA e tempos **(decisão A6)**

Recorte autorizado e período:

1. **Primeira resposta:**
   - É o tempo da abertura até a primeira ação da equipe que o solicitante enxerga: o primeiro comentário não interno de um atendente, ou o início do atendimento (evento de status para "Em atendimento"), o que vier primeiro.
   - Vale para as solicitações abertas no período. Mostra a média, a mediana e quantas ainda estão sem resposta.
2. **Tempo por etapa:**
   - Vale para as solicitações concluídas no período que tiveram etapas.
   - O tempo de cada etapa vai da entrada nela (evento de etapa) até o próximo evento de etapa ou até a conclusão.
   - Agrupado por **serviço · etapa**, com os nomes registrados, mostrando média, mediana e quantidade.
   - Ordem: serviço, depois a ordem em que as etapas aparecem.
3. **Pausas:**
   - Considera as solicitações concluídas no período.
   - Mostra quantas tiveram pausa e o tempo pausado médio entre elas.
   - O tempo de uma pausa ainda aberta é contado até a conclusão.
4. **No prazo por serviço** e **no prazo por prioridade:**
   - Concluídas no período que tinham prazo.
   - Mostra o percentual no prazo e a quantidade, em barras.
   - Grupos com menos de 3 concluídas aparecem com o aviso "poucos dados".
5. **Quando as solicitações chegam:**
   - Abertas no período, por dia da semana × hora (0 a 23), no fuso de São Paulo.
   - É uma grade de 7 × 24 em que a cor fica mais forte quanto maior a quantidade, com o número no texto de apoio e numa tabela equivalente.

### 5.6 Desempenho da equipe **(decisões A5, A7 e A8)**

1. Uma linha por pessoa **atendente** do setor do recorte, ativa ou não, que no período:
   - foi responsável por alguma solicitação concluída; ou
   - é responsável por alguma aberta ou em atendimento.
   O administrador sem filtro vê todas as pessoas, com o setor de cada uma.
2. Colunas:
   - concluídas no período;
   - tempo médio até a conclusão;
   - percentual no prazo, entre as concluídas com prazo;
   - pendentes agora, ou seja, abertas ou em atendimento como responsável.
3. **Ordem alfabética do nome, não uma classificação.** Não há destaque de "melhor" ou "pior".
4. Pessoa inativa aparece com "(inativa)". Pessoa anonimizada aparece com o nome anonimizado, já trocado pela anonimização.
5. Aviso fixo no bloco: "Use estes números para distribuir o trabalho. Eles não medem a complexidade de cada solicitação e não devem ser o único critério para avaliar uma pessoa."
6. O bloco não mostra descrição, solicitante nem conteúdo. Ele usa só contagens e tempos.

### 5.7 Gráficos e acessibilidade **(decisão A3)**

- **Tecnologia:** SVG gerado no servidor, ou barras em HTML e CSS. Sem JavaScript no cliente e sem biblioteca nova.
- **Equivalência:** cada gráfico tem título e uma tabela com os mesmos números, então nenhuma informação depende só da cor ou do desenho.
- **Cores:**
  - séries em ordem fixa, validadas para daltonismo com o validador da skill de visualização;
  - grade em escala de uma única cor;
  - texto sempre na cor de texto.
- **Detalhes de cada ponto:** cada ponto, coluna ou célula tem `<title>` com o valor, que o navegador mostra ao passar o mouse.
- **Celular:** o gráfico ocupa a largura disponível, sem rolagem horizontal da página; a grade de horários rola só dentro do próprio bloco.

### 5.8 Cálculo **(decisão A9)**

- Tudo é calculado a cada visita, por consultas de agregação no PostgreSQL, atrás de uma porta (`AnalyticsReader`) com implementação Prisma e outra em memória para os testes unitários.
- **Nenhuma tabela nova, nenhuma migration.** Se um índice for necessário, ele entra numa migration **aditiva** registrada na tarefa, com backup antes de aplicar no Neon.

## 6. Dados

Nenhuma mudança no banco. As tabelas usadas são:
- `Request`;
- `RequestStatusEvent`;
- `RequestComment` (só `authorId`, `isInternal` e `createdAt`; nunca o texto);
- `RequestStageEvent`;
- `RequestSlaPause` (só as datas);
- `User` (nome, perfil, setor e situação).

## 7. Critérios de aceitação

- [ ] **CA-ANL-01** — Sem uso das páginas novas, nada muda: o painel atual, o CSV, as regras de leitura e todas as suítes anteriores passam sem alteração de asserções.
- [ ] **CA-ANL-02** — Acesso conforme 5.1:
  - o atendente vê só "Meu painel", do próprio setor;
  - o gestor vê "Análises" só do próprio setor;
  - o administrador vê a organização ou um setor;
  - o solicitante não vê nenhuma página;
  - sem setor ativo, aparece o aviso, e nenhuma solicitação é lida.
- [ ] **CA-ANL-03** — "Fila agora" e "Meu período" seguem 5.3, inclusive "sem responsável" excluindo aprovação pendente e "respostas" excluindo notas internas.
- [ ] **CA-ANL-04** — As séries de 5.4 usam dias até 31 dias e semanas de segunda a domingo acima disso, no fuso de São Paulo. As pendentes seguem o último evento de status, considerando reabertura e cancelamento.
- [ ] **CA-ANL-05** — A primeira resposta segue 5.5.1: comentário não interno de atendente ou início do atendimento; nota interna e comentário do solicitante não contam.
- [ ] **CA-ANL-06** — O tempo por etapa, as pausas e o prazo por serviço e por prioridade seguem 5.5.2 a 5.5.4, com o aviso "poucos dados".
- [ ] **CA-ANL-07** — A grade dia × hora conta as solicitações abertas no fuso de São Paulo, inclusive perto da meia-noite.
- [ ] **CA-ANL-08** — A tabela da equipe segue 5.6: só atendentes do recorte, ordem alfabética, inativos marcados, aviso fixo, sem conteúdo das solicitações. O atendente nunca vê números de colegas.
- [ ] **CA-ANL-09** — Os gráficos seguem 5.7: sem dependência nova, sem eixo duplo, tabela equivalente e paleta validada.
- [ ] **CA-ANL-10** — Nenhuma migration e nenhuma dependência nova (salvo índice aditivo registrado). Nenhuma página de análise tem link para uma solicitação.

## 8. Estratégia de testes

- **Unitários:**
  - intervalos dia e semana, inclusive semanas parciais e o fuso;
  - média, mediana e percentuais;
  - montagem das séries com pontos vazios;
  - grade dia × hora;
  - geometria dos gráficos SVG, como escalas, pontos e linha interrompida;
  - casos de uso com o leitor em memória e a autorização de cada perfil;
  - telas renderizadas.
- **Integração** (banco de teste):
  - solicitações com reabertura, cancelamento, etapas, pausas, comentários internos e públicos, prioridades e responsáveis diferentes;
  - recortes do atendente, do gestor e do administrador;
  - horários perto da meia-noite em São Paulo.
- **E2E:**
  - o atendente abre "Meu painel" e vê os números do banco fictício;
  - o gestor abre "Análises" do setor;
  - o administrador filtra por setor;
  - o solicitante não abre as páginas.

## 9. Riscos

- **Uso dos números por pessoa como avaliação:** mitigado pela visibilidade restrita, pela ordem alfabética, pelo aviso fixo e pela ausência de classificação.
- **Desempenho:** "pendentes ao fim" consulta os eventos de status para cada intervalo, até 53 semanas. Mitigado pelo limite de 366 dias, pela agregação no banco e pelos índices existentes por solicitação. Se a medição mostrar lentidão, entra um índice aditivo, registrado.
- **Leitura errada de gráficos:** mitigado pela tabela equivalente, pelo eixo único, pelos títulos que dizem a regra e pelo "poucos dados".

## 10. Tarefas (registradas em `TASKS.md`)

- **SF-144** — Domínio das análises: intervalos, séries, estatísticas e grade (unitários).
- **SF-145** — Leitor Prisma e casos de uso com autorização (unitários e integração).
- **SF-146** — Componentes de gráfico SVG e barras, com paleta validada (unitários).
- **SF-147** — "Meu painel" do atendente.
- **SF-148** — "Análises" do administrador e do gestor: Tendências, SLA e tempos, e Desempenho da equipe.
- **SF-149** — E2E, README e revisão.

## 11. Decisões tomadas (2026-11-06)

- **A1 — Painel do atendente com o setor e os próprios números:** é o que ajuda a decidir o próximo atendimento, sem expor colegas.
- **A2 — Análises numa página separada do painel atual:** o painel continua leve. As análises têm muito mais consultas e só carregam quando abertas.
- **A3 — SVG no servidor, sem biblioteca:** mantém a regra de não adicionar dependências e funciona sem JavaScript. A tabela equivalente cobre a acessibilidade.
- **A4 — Dia até 31 dias e semana acima disso:** até 31 pontos por dia ainda são legíveis; acima disso, a semana evita uma série com até 366 pontos.
- **A5 — "Por mim" é o responsável atual da solicitação concluída:** o responsável fica gravado depois da conclusão. É simples e coincide com quem a fila mostra.
- **A6 — Primeira resposta é o que o solicitante enxerga:** nota interna não conta como resposta.
- **A7 — Desempenho em ordem alfabética, por setor, sem classificação:** reduz o uso como ranking e respeita a decisão anterior de não medir produtividade de forma comparativa.
- **A8 — Aviso fixo sobre o uso dos números:** deixa claro na própria tela o limite de interpretação, por cuidado com a LGPD e com as relações de trabalho.
- **A9 — Cálculo na visita, sem tabelas novas:** mesmo princípio do painel atual. O volume do projeto permite.
