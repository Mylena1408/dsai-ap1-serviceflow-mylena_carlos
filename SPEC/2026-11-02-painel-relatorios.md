# SPEC — Painel, indicadores e relatórios

**Data:** 2026-11-02
**Status:** Aprovada em 2026-11-02, com as decisões R1 a R5 da seção 11 conforme propostas. **Concluída em 2026-11-02** (SF-097 a SF-101; CA-DASH-01 a 10 verificados).
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-visao-geral.md` (§13 Dashboard e relatórios; §14, último critério), `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seção 10 e seção 19, "dashboard, indicadores e relatórios"), `SPEC/2026-11-01-sla-prioridades.md` (situação do prazo e `completedLate`), `SPEC/2026-11-01-aprovacoes.md` (perfil Gestor), `SPEC/2026-11-01-permissoes-configuraveis.md` (K3: setor da pessoa), `SPEC/2026-10-29-plano-escala-100k.md` (item 11, garantia 7.4 e risco "dependências novas"), `SPEC/2026-11-01-relatorio-fase-3.md` (seção 8)

## 1. Objetivo

Hoje cada pessoa vê solicitações uma a uma: o solicitante, as suas; o atendente, a fila do setor; o gestor, as que exigem aprovação. Ninguém tem uma visão **consolidada**. Esta SPEC cria um **painel de indicadores** e uma **exportação CSV**, para que o administrador acompanhe a organização e o gestor acompanhe o próprio setor, cumprindo o último critério da visão geral (§14): "informações consolidadas das solicitações puderem ser apresentadas em dashboard ou relatórios".

## 2. Registro da mudança de escopo

- A SPEC principal (seção 10) não dá ao administrador leitura de solicitações, e o gestor só lê as que exigem aprovação (ou todas do setor com a permissão "Ver todas as solicitações do setor"). Esta SPEC acrescenta uma leitura **só de números agregados e de colunas mínimas** (seção 5.4), sem abrir o detalhe de nenhuma solicitação: as regras de leitura do detalhe não mudam.
- Pela garantia 7.4 do plano, nada do que existe muda: o painel é uma tela nova, calculada a partir dos dados atuais, **sem migration**.

## 3. Escopo

1. Painel de indicadores para o administrador (organização inteira, com filtro por setor) e para o gestor (só o próprio setor) **(decisão R1)**.
2. Indicadores da visão geral §13, com período escolhido **(decisão R2)**.
3. Gráficos de barras simples, sem dependência nova **(decisão R3)**.
4. Exportação CSV das solicitações do mesmo recorte, com colunas mínimas **(decisão R4)**.
5. Cálculo sob demanda, direto das tabelas atuais **(decisão R5)**.

## 4. Fora de escopo

- Painel para solicitantes e atendentes.
- Indicadores por pessoa (ranking ou produtividade de atendentes).
- Relatórios agendados, envio por e-mail, PDF ou planilha `.xlsx`.
- Painéis configuráveis pelo usuário; metas e alertas sobre indicadores.
- Tabelas de agregação, cache ou histórico de indicadores.
- Exportar descrição, comentários, notas internas, respostas de campos, documentos, observações de aprovação ou dados do solicitante.

## 5. Regras

### 5.1 Quem vê **(decisão R1)**

| Perfil | Recorte | Onde |
|---|---|---|
| Administrador | Todas as solicitações; filtro opcional por setor | Seção "Painel" da administração (`/admin?section=dashboard`) |
| Gestor | Só as solicitações do **setor atual** do gestor (mesmo critério de K3), exijam aprovação ou não | Página "Painel do setor" na área do gestor (`/approvals/dashboard`) |
| Solicitante e atendente | Não veem; a rota e a exportação recusam | — |

O setor de uma solicitação é o registrado na abertura (`sectorId`), como na fila. Um gestor sem setor ativo vê o painel vazio com o aviso "Você não está ligado a um setor ativo". Toda verificação é feita no servidor; o cliente não escolhe o recorte além do filtro de setor do administrador.

### 5.2 Período **(decisão R2)**

- Opções: **últimos 7 dias**, **últimos 30 dias** (padrão), **últimos 90 dias** ou **intervalo de datas** (início e fim inclusivos, no máximo 366 dias, fim não posterior a hoje).
- Dias contados no fuso `America/Sao_Paulo`. Os critérios ficam na URL, como na busca da fila.
- Datas inválidas, intervalo invertido ou maior que 366 dias são recusados com mensagem junto do filtro, e o painel mostra o período padrão.

### 5.3 Indicadores **(decisão R2)**

**Situação atual** (não depende do período; todas as solicitações do recorte):

| Indicador | Regra |
|---|---|
| Abertas | Status "Aberta" (inclui as que aguardam aprovação) |
| Aguardando aprovação | Abertas com aprovação pendente |
| Em atendimento | Status "Em atendimento" |
| Próximas do vencimento | Abertas ou em atendimento na situação "próximo do vencimento" da SPEC de SLA |
| Vencidas | Abertas ou em atendimento na situação "vencido" |

**No período** (solicitações do recorte):

| Indicador | Regra |
|---|---|
| Abertas no período | Data de abertura no período |
| Concluídas no período | Data de conclusão no período |
| Canceladas no período | Data de cancelamento no período |
| Tempo até a conclusão | Média e mediana, em horas, da abertura à conclusão, das concluídas no período (reabertas contam da abertura original) |
| Concluídas no prazo | Percentual das concluídas no período **com prazo** que terminaram dentro dele (`completedLate` falso); sem nenhuma com prazo, mostra "sem prazo definido" |
| Por categoria | Abertas no período, agrupadas pela categoria registrada na abertura |
| Por setor | Abertas no período, agrupadas pelo setor (só para o administrador sem filtro de setor) |
| Por status atual | Abertas no período, agrupadas pelo status atual |

- Categorias e setores aparecem pelo nome registrado na abertura, para que renomear ou desativar não apague o histórico. Grupos ordenados do maior para o menor; empate, por nome.
- Sem solicitações no recorte, cada indicador mostra 0 (ou "—" para tempos e percentuais) e o painel diz "Nenhuma solicitação no período".
- *Esclarecido em 2026-11-02 (SF-097): tempos em horas com uma casa decimal; percentual no prazo em número inteiro, arredondado; barras proporcionais ao maior grupo.*

### 5.4 Exportação CSV **(decisão R4)**

- Botão "Exportar CSV" no painel; baixa as solicitações **abertas no período** do mesmo recorte e período, pela rota `/api/reports/requests.csv`, que repete toda a verificação de acesso.
- Colunas, nesta ordem: código curto, serviço, categoria, setor, status, prioridade, aprovação, etapa atual, responsável (nome), aberta em, concluída em, cancelada em, vencimento, situação do prazo, concluída no prazo.
- **Nunca** inclui descrição, comentários, notas, respostas de campos, documentos, observações de aprovação, nem nome ou e-mail do solicitante.
- Formato: UTF-8 com BOM, separador `;`, datas em `AAAA-MM-DD HH:MM` no fuso `America/Sao_Paulo`, nomes de status em português. Campos que começam com `=`, `+`, `-`, `@`, tabulação ou retorno recebem um apóstrofo na frente (proteção contra fórmulas em planilhas).
- Limite de **10.000 linhas**; acima disso a exportação é recusada com a mensagem "Escolha um período menor".
- Nome do arquivo: `serviceflow-solicitacoes-<início>-a-<fim>.csv`.
- *Esclarecido em 2026-11-02 (SF-097): linhas terminadas em CRLF; o valor que tem `;`, aspas ou quebra de linha vai entre aspas; células sem valor (sem aprovação, sem etapa, sem responsável, datas ausentes) ficam vazias; "Concluída no prazo" é "Sim" ou "Não" só para concluídas com prazo, vazia nas demais.*

### 5.5 Gráficos **(decisão R3)**

Os agrupamentos (por categoria, setor e status) aparecem como **barras horizontais em HTML e CSS**, com o número escrito ao lado de cada barra e uma tabela equivalente acessível. **Nenhuma dependência nova.**

### 5.6 Cálculo **(decisão R5)**

Os números são calculados a cada visita por consultas de agregação no PostgreSQL sobre as tabelas existentes, atrás de uma porta (`DashboardReader`) com implementação Prisma e uma em memória para os testes unitários. Nenhuma tabela nova, nenhuma migration.

### 5.7 Autorização (complementa as SPECs anteriores)

| Operação | Quem pode |
|---|---|
| Ver o painel da organização e exportar | Só o administrador |
| Ver o painel do setor e exportar | Gestor ativo, só do setor atual |
| Ver o detalhe de uma solicitação a partir do painel | Ninguém: o painel não tem links para solicitações; as regras de leitura não mudam |

## 6. Dados

Nenhuma mudança no banco. Se as consultas exigirem índice, ele entra numa migration **aditiva** registrada na tarefa correspondente.

## 7. Critérios de aceitação

- [x] **CA-DASH-01** — Sem uso do painel, nada muda: telas, regras de leitura e suítes anteriores passam sem alteração de asserções. *Verificado em 2026-11-02 (SF-101): o painel é uma tela nova, sem migration; nenhum teste existente antes da SPEC foi alterado e todas as suítes anteriores passam; as telas existentes continuam iguais (os rótulos movidos para `src/shared` são reexportados pelos arquivos antigos).*
- [x] **CA-DASH-02** — O administrador vê os indicadores da organização inteira e pode filtrar por um setor; o gestor vê só os do seu setor atual; solicitante e atendente são recusados na página e na exportação. *Parcial em 2026-11-02 (SF-098): nos casos de uso, o administrador lê a organização ou um setor (inclusive inativo; setor desconhecido é recusado com aviso), o gestor só o setor atual (o setor da URL é ignorado; sem setor ativo, painel vazio sem ler solicitações), e atendente e solicitante são recusados antes de qualquer leitura, também na exportação (unitário e integração). Faltam as telas (SF-099).* *Verificado em 2026-11-02 (SF-099): além dos casos de uso (SF-098), o administrador vê a seção "Painel" com o filtro de setor (inativos marcados) e o gestor vê "Painel do setor" só com o próprio setor, sem filtro de setor; o atendente que abre `/admin?section=dashboard` ou `/approvals/dashboard` é levado para `/queue`; o gestor sem setor ativo vê o aviso (unitário da tela e navegador).*
- [x] **CA-DASH-03** — Os indicadores de situação atual (5.3) contam corretamente abertas, aguardando aprovação, em atendimento, próximas do vencimento e vencidas. *Verificado em 2026-11-02 (SF-098): abertas, aguardando aprovação, em atendimento, próximas do vencimento e vencidas, com as mesmas regras da situação do prazo e do filtro da fila, para a organização e por setor (integração no banco).*
- [x] **CA-DASH-04** — Os indicadores do período contam abertas, concluídas e canceladas por data de abertura, conclusão e cancelamento, com dias no fuso `America/Sao_Paulo`. *Verificado em 2026-11-02 (SF-098): abertas, concluídas e canceladas contadas pela data de abertura, conclusão e cancelamento; uma solicitação aberta às 23:59 de 31/10 em São Paulo conta em outubro e outra aberta à meia-noite de 01/11 não (unitário do período e integração).*
- [x] **CA-DASH-05** — Tempo até a conclusão (média e mediana) e percentual concluído no prazo seguem 5.3, inclusive sem solicitações e sem prazo definido. *Verificado em 2026-11-02 (SF-098): média e mediana da abertura à conclusão (inclusive de solicitação aberta antes do período), em horas com uma casa, e percentual inteiro no prazo entre as concluídas com prazo; sem concluídas, "—"; sem prazo, "sem prazo definido" (unitário e integração).*
- [x] **CA-DASH-06** — Os agrupamentos por categoria, setor e status usam os nomes registrados na abertura e a ordem de 5.3. *Verificado em 2026-11-02 (SF-098): grupos por categoria, setor e status atual pelos nomes registrados na abertura, do maior para o menor e empate por nome; o grupo por setor só aparece para o administrador sem filtro de setor (unitário e integração).*
- [x] **CA-DASH-07** — O período padrão é 30 dias; 7, 90 e intervalo de datas funcionam; datas inválidas, invertidas ou acima de 366 dias são recusadas com mensagem. *Verificado em 2026-11-02 (SF-099): o período padrão é "Últimos 30 dias"; 7, 90 e intervalo de datas funcionam pela URL; datas inválidas, invertidas, futuras ou acima de 366 dias aparecem com a mensagem do motivo e "Mostrando os últimos 30 dias" (unitário do período, dos casos de uso e da tela).*
- [x] **CA-DASH-08** — O CSV traz exatamente as colunas e o formato de 5.4, só do recorte autorizado, com proteção contra fórmulas e limite de 10.000 linhas. *Verificado em 2026-11-02 (SF-100): a rota devolve o CSV das 15 colunas de 5.4 (BOM, `;`, CRLF, datas de São Paulo, proteção contra fórmulas) como anexo `serviceflow-solicitacoes-<início>-a-<fim>.csv`, só do recorte autorizado (administrador: organização ou setor; gestor: o próprio setor mesmo com outro na URL); mais de 10.000 linhas, período ou setor inválido são recusados com mensagem (unitário, integração e download no navegador).*
- [x] **CA-DASH-09** — O CSV e o painel nunca trazem descrição, comentários, notas, respostas, documentos, observações nem dados do solicitante. *Parcial em 2026-11-02 (SF-099): o painel mostra só números e nomes de grupos, sem nenhum link para solicitações nem conteúdo (unitário da tela). Falta o CSV (SF-100).* *Verificado em 2026-11-02 (SF-100): além do painel (SF-099), o CSV não traz descrição, nome nem e-mail do solicitante, mesmo com esses dados no banco (unitário do domínio e integração da rota).*
- [x] **CA-DASH-10** — Nenhuma dependência nova e nenhuma migration (salvo índice aditivo registrado). *Verificado em 2026-11-02 (SF-101): `package.json`, `package-lock.json` e `prisma/` sem mudança desde a SPEC; nenhuma dependência nova e nenhuma migration (nenhum índice foi necessário).*

## 8. Estratégia de testes

- **Unitários:** período (opções, limites, fuso); cálculo de média, mediana e percentual; ordenação dos grupos; montagem e escape do CSV; casos de uso com a porta em memória e a autorização de cada perfil.
- **Integração:** consultas de agregação sobre o banco de teste, com solicitações em vários status, setores, categorias, prazos e datas (inclusive perto da meia-noite em São Paulo); recorte do gestor; rota de exportação.
- **E2E:** o administrador abre o painel, vê os números do banco fictício, filtra por setor e baixa o CSV; o gestor vê só o próprio setor; o atendente não abre o painel.

## 9. Riscos

- **Exposição de dados:** mitigação: só números e colunas mínimas; nenhum dado do solicitante nem conteúdo; recorte verificado no servidor também na exportação.
- **Desempenho com muitos dados:** mitigação: agregação no banco, índices existentes por setor e data, limite de período e de linhas no CSV.
- **Fórmulas maliciosas no CSV:** mitigação: prefixo de apóstrofo (5.4).
- **Fuso horário:** mitigação: contagem por dia sempre em `America/Sao_Paulo`, com testes perto da meia-noite.

## 10. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-097 | Domínio: período, cálculos (média, mediana, percentual), ordenação dos grupos e montagem do CSV |
| SF-098 | Porta `DashboardReader`, consultas Prisma e casos de uso com autorização |
| SF-099 | Seção "Painel" na administração e página "Painel do setor" do gestor |
| SF-100 | Rota de exportação CSV |
| SF-101 | E2E e revisão |

**Ordem:** SF-097 → SF-098 → SF-099 → SF-100 → SF-101.

## 11. Decisões tomadas (2026-11-02)

Decisões da responsável pelo projeto: **todas as propostas aceitas**.

| # | Questão | Decisão | Alternativas descartadas |
|---|---|---|---|
| R1 | Quem vê o painel | Administrador (organização, com filtro por setor) e gestor (só o próprio setor) | Também o atendente (painel do setor); só o administrador |
| R2 | Indicadores e período | Os da visão geral §13 (tabela 5.3), com 7, 30 ou 90 dias ou intervalo de até 366 dias | Também indicadores por atendente; sem escolha de período (sempre 30 dias) |
| R3 | Gráficos | Barras em HTML e CSS, sem dependência nova | Biblioteca de gráficos (ex.: Recharts), dependência nova |
| R4 | Exportação | CSV com colunas mínimas, sem dados do solicitante, até 10.000 linhas | Incluir nome do solicitante e descrição; sem exportação |
| R5 | Cálculo | Sob demanda, por agregação no banco, sem migration | Tabela de indicadores diários preenchida pelo job diário |
