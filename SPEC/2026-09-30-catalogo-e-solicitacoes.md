# SPEC — Catálogo configurável e ciclo básico de solicitações

**Data:** 2026-09-30  
**Status:** Aprovada  
**Projeto:** ServiceFlow  
**Referência:** `SPEC/2026-09-30-visao-geral.md`

## 1. Objetivo

Entregar a base funcional do ServiceFlow para uma organização: permitir que um administrador configure setores, categorias, serviços e usuários; que solicitantes encontrem serviços ativos e abram solicitações; e que atendentes da área responsável acompanhem e concluam essas solicitações por um ciclo de status fixo.

Esta entrega estabelece entidades, permissões, persistência e histórico mínimos para que funcionalidades posteriores possam ser especificadas e desenvolvidas sobre uma base coerente. Não implementa os recursos avançados descritos na visão geral.

## 2. Contexto

Solicitações internas precisam de um ponto de entrada comum, de um responsável organizacional e de estados que possam ser acompanhados. Nesta entrega, o catálogo é configurado pela organização e não contém setores ou serviços fixos no código.

A instalação atende uma única organização. A configuração administrativa e o ciclo básico de solicitações são os limites desta SPEC. Os perfis são mutuamente exclusivos: cada usuário ativo possui exatamente um perfil, sem herança implícita de permissões entre perfis.

## 3. Atores e permissões

### 3.1 Administrador

- É provisionado no sistema por um procedimento inicial seguro, sem credenciais embutidas no código ou repositório.
- Pode criar, consultar, editar e desativar usuários, setores, categorias e serviços, respeitadas as regras desta SPEC.
- Pode alterar a própria senha pelo fluxo de autogerenciamento descrito na alteração aprovada de 2026-10-06; isso não substitui nem amplia as operações administrativas de usuários.
- Não pode abrir solicitações em nome de outros usuários, consultar solicitações ou mudar seus status por possuir o perfil de administrador.
- Não pode remover ou desativar o último administrador ativo.

### 3.2 Solicitante

- Pode consultar o catálogo publicado, abrir solicitações para si próprio e consultar somente as solicitações que abriu.
- Pode alterar somente a própria senha pelo fluxo de autogerenciamento descrito na alteração aprovada de 2026-10-06.
- Não pode configurar catálogo ou usuários, nem alterar o status de uma solicitação.
- Não possui setor associado para fins de autorização.

### 3.3 Atendente

- É associado a exatamente um setor ativo por vez.
- Pode consultar solicitações do setor ao qual está associado e avançar seus status conforme o fluxo definido nesta SPEC.
- Pode alterar somente a própria senha pelo fluxo de autogerenciamento descrito na alteração aprovada de 2026-10-06.
- Não pode configurar setores, categorias, serviços ou usuários, nem consultar solicitações de outros setores.
- Não possui atribuição individual de solicitações; solicitações abertas e em atendimento ficam na fila do setor e podem ser tratadas por qualquer atendente ativo desse setor.

O perfil é um campo obrigatório e exclusivo do usuário: `ADMIN`, `REQUESTER` ou `ATTENDANT`. Uma conta não combina permissões de perfis diferentes. Um administrador que também precise solicitar serviços deverá usar uma conta separada de solicitante.

## 4. Escopo

- Autenticação de usuários provisionados pelo administrador ou pelo procedimento inicial de bootstrap.
- Alteração autenticada da própria senha por usuários com perfil `ADMIN`, `REQUESTER` ou `ATTENDANT`, conforme a alteração aprovada de 2026-10-06.
- Administração de usuários, com perfil e estado ativo/inativo.
- Cadastro, consulta, edição e desativação lógica de setores, categorias e serviços.
- Associação de cada serviço a uma categoria e a um setor responsável.
- Catálogo visível a solicitantes contendo somente serviços disponíveis.
- Abertura de solicitação com descrição livre e dados históricos imutáveis do serviço no momento da abertura.
- Consulta das próprias solicitações pelo solicitante.
- Fila de solicitações por setor para atendentes.
- Transição de status de Aberta para Em atendimento e de Em atendimento para Concluída.
- Histórico de criação e de todas as transições de status, com ator e instante.
- Interface web responsiva suficiente para executar os fluxos acima.
- Requisitos documentais configuráveis por serviço e anexos de documentos PDF, DOCX e TXT na abertura de solicitações, com consulta e download autorizados, conforme a alteração aprovada de 2026-10-16 (seção 21).

## 5. Fora de escopo

Não fazem parte desta entrega:

- SLA, prazos de atendimento, alertas ou priorização;
- aprovação;
- campos personalizados;
- anexos — **item fora do escopo inicial; passa a ser autorizado, nos limites da seção 21, pela alteração aprovada de 2026-10-16**. Anexos fora daquele recorte (por exemplo, em comentários, após a abertura ou por atendentes) continuam fora de escopo;
- comentários ou conversas;
- notificações;
- dashboard ou relatórios;
- fluxos configuráveis por serviço;
- atribuição individual de solicitações;
- reabertura ou cancelamento;
- integrações externas, provedores externos de mensagens ou pagamentos;
- aplicativo mobile nativo;
- múltiplas organizações na mesma instalação.

Esses itens exigem SPECs próprias antes de qualquer implementação correspondente.

## 6. Entidades e seus relacionamentos

Todas as entidades persistidas possuem identificador UUID e datas em UTC. Datas de criação e atualização são geradas pelo servidor. Registros de configuração e usuários são desativados logicamente; não são apagados fisicamente por operações normais da aplicação.

### 6.1 Usuário (`User`)

Campos mínimos:

- `id` (UUID, chave primária);
- `name` (obrigatório, não vazio);
- `email` (obrigatório, único sem distinção entre maiúsculas e minúsculas);
- `role` (obrigatório: `ADMIN`, `REQUESTER` ou `ATTENDANT`);
- `sector_id` (nulo para administrador e solicitante; obrigatório para atendente);
- `password_hash` (credencial armazenada somente como hash pela camada de autenticação; nunca retornada à interface);
- `is_active` (booleano);
- `created_at`, `updated_at`.

O atendente pertence a exatamente um setor. A associação é feita pelo administrador e deve apontar para um setor existente. Um atendente não pode estar associado a setor inativo. Ao desativar ou mudar o setor de um atendente, aplicam-se as proteções para solicitações pendentes descritas nas regras de negócio.

### 6.2 Setor (`Sector`)

Campos mínimos: `id`, `name` (obrigatório e não vazio), `is_active`, `created_at`, `updated_at`.

Um setor possui zero ou mais serviços e usuários atendentes. Solicitações abertas a partir de serviços associados a ele mantêm o identificador e o nome do setor de origem como snapshot.

### 6.3 Categoria (`Category`)

Campos mínimos: `id`, `name` (obrigatório e não vazio), `is_active`, `created_at`, `updated_at`.

Uma categoria possui zero ou mais serviços. Solicitações mantêm o identificador de referência quando disponível e o nome da categoria como snapshot histórico.

### 6.4 Serviço (`Service`)

Campos mínimos: `id`, `name` (obrigatório e não vazio), `description` (obrigatória e não vazia), `category_id` (obrigatório), `sector_id` (obrigatório), `is_active`, `created_at`, `updated_at`.

Cada serviço pertence a exatamente uma categoria e a exatamente um setor responsável. Não há campos de formulário customizados nesta entrega.

### 6.5 Solicitação (`Request`)

Campos mínimos:

- `id` (UUID, chave primária);
- `requester_id` (obrigatório, referência ao usuário solicitante);
- `service_id` (obrigatório, referência ao serviço de origem, preservada sem exclusão física);
- `sector_id` (obrigatório, setor responsável na abertura; usado para autorização e fila);
- `service_name_snapshot` (obrigatório);
- `service_description_snapshot` (obrigatório);
- `category_id_snapshot` (obrigatório, identificador da categoria no momento da abertura);
- `category_name_snapshot` (obrigatório);
- `sector_name_snapshot` (obrigatório);
- `description` (obrigatória, descrição fornecida pelo solicitante);
- `status` (obrigatório: `OPEN`, `IN_PROGRESS` ou `COMPLETED`);
- `created_at`, `updated_at`, `completed_at` (nulo até a conclusão).

A solicitação pertence a um solicitante, foi criada a partir de um serviço e mantém o setor de atendimento da abertura. Os snapshots preservam os dados exibidos e as relações relevantes da configuração no instante da criação. O solicitante é preservado pela referência ao usuário; contas referenciadas não são apagadas fisicamente.

### 6.6 Evento de histórico (`RequestStatusEvent`)

Campos mínimos: `id`, `request_id`, `actor_id`, `from_status` (nulo somente na criação), `to_status`, `occurred_at`.

Cada evento pertence a uma solicitação e referencia o usuário que realizou a operação. Eventos são somente de acréscimo: não podem ser editados ou apagados pela aplicação. Não incluem comentário ou observação livre.

### 6.7 Relacionamentos

- `Sector 1:N User` para usuários com perfil `ATTENDANT`.
- `Sector 1:N Service`.
- `Category 1:N Service`.
- `User 1:N Request` como solicitante.
- `Service 1:N Request` como serviço de origem.
- `Sector 1:N Request` como setor responsável registrado na abertura.
- `Request 1:N RequestStatusEvent`.
- `User 1:N RequestStatusEvent` como ator dos eventos.

Restrições relacionais devem impedir referências inexistentes. Os registros relacionados a solicitações não podem ser apagados fisicamente enquanto houver referências.

## 7. Regras de negócio

1. Somente usuários ativos podem autenticar e executar operações.
2. Não há cadastro público. Contas são criadas pelo administrador ou pelo bootstrap inicial.
3. E-mails são normalizados para comparação e devem ser únicos sem distinção entre maiúsculas e minúsculas.
4. Um usuário possui exatamente um perfil. Somente atendentes possuem `sector_id`; atendentes precisam ter um setor ativo.
5. O administrador não recebe permissões operacionais sobre solicitações implicitamente.
6. Só é possível criar uma solicitação para serviço ativo, cuja categoria e setor também estejam ativos no momento da criação.
7. A descrição da solicitação deve conter texto não vazio após remoção de espaços nas extremidades e ter no máximo 10.000 caracteres. O limite é obrigatório e deve ser aplicado no servidor e na interface.
8. O status inicial é `OPEN`. O solicitante não pode escolher nem alterar o status.
9. Cada transição autorizada e válida atualiza a solicitação e cria o evento de histórico correspondente na mesma transação.
10. Repetir uma operação de transição já concluída ou tentar uma transição inválida não deve alterar a solicitação nem criar evento.
11. Solicitações e eventos não são apagáveis por operações da aplicação.
12. Desativar um usuário impede novos logins e operações, mas preserva solicitações e eventos já registrados.
13. Deve permanecer ao menos um administrador ativo. A aplicação rejeita a desativação, rebaixamento ou mudança de estado que deixe zero administradores ativos.
14. Não se permite mudar o setor de um atendente nem desativar sua conta quando ele for o último atendente ativo daquele setor com solicitações `OPEN` ou `IN_PROGRESS`. O administrador deve primeiro manter outro atendente ativo no setor ou concluir as solicitações pendentes por um atendente autorizado.
15. Uma solicitação não é atribuída a uma pessoa. Qualquer atendente ativo do setor registrado na solicitação pode efetuar sua próxima transição.
16. Renomear ou editar um serviço, categoria ou setor afeta a configuração atual e futuras solicitações; não altera os snapshots das solicitações já criadas.
17. Mudanças em `service.sector_id` aplicam-se somente a solicitações futuras. Solicitações existentes permanecem no setor registrado em `Request.sector_id`.
18. Operações concorrentes sobre a mesma solicitação devem validar o status atual no momento da gravação. No máximo uma transição válida pode ser aplicada a partir de um mesmo estado.
19. A alteração de senha pelo fluxo de autogerenciamento exige sessão autenticada, valida a senha atual, exige nova senha com pelo menos 12 caracteres e confirmação idêntica, e identifica o usuário exclusivamente pela sessão validada no servidor. O fluxo é permitido aos três perfis, altera somente a conta da sessão e persiste somente o hash Argon2id da nova senha. Senhas e confirmação não podem ser registradas em logs nem armazenadas em texto puro. O fluxo não aceita `userId` do cliente para selecionar a conta e mantém a sessão autenticada após sucesso.

## 8. Fluxo completo da solicitação

1. O administrador cria ou ativa setores e categorias.
2. O administrador cria ou ativa serviços, associando cada serviço a uma categoria e a um setor ativos.
3. O administrador provisiona um solicitante e um ou mais atendentes. Cada atendente é associado a exatamente um setor ativo.
4. O solicitante autentica e consulta o catálogo. A interface apresenta somente serviços ativos associados a categoria e setor ativos.
5. O solicitante seleciona um serviço e envia uma descrição obrigatória.
6. O servidor confirma identidade, perfil, estado ativo do usuário, disponibilidade atual do serviço/categoria/setor e validade da descrição. Em uma transação, cria a solicitação com status `OPEN`, copia os dados de snapshot e cria o evento inicial (`from_status = null`, `to_status = OPEN`).
7. O solicitante consulta a solicitação na própria lista e vê seu status atual. Não acessa solicitações de terceiros.
8. Um atendente ativo associado ao setor gravado na solicitação consulta a fila do setor e inicia o atendimento, mudando `OPEN` para `IN_PROGRESS`.
9. O mesmo atendente ou outro atendente ativo do mesmo setor conclui o atendimento, mudando `IN_PROGRESS` para `COMPLETED`.
10. Cada mudança atualiza `updated_at`, registra um evento com ator, estado anterior, novo estado e horário UTC; na conclusão, define também `completed_at`.

Não há ação de solicitante ou administrador para intervir no fluxo após sua criação. Não há transições além das descritas na seção 9.

## 9. Estados e transições permitidas

Estados persistidos:

- `OPEN` (Aberta): criada e aguardando início do atendimento;
- `IN_PROGRESS` (Em atendimento): atendimento iniciado;
- `COMPLETED` (Concluída): atendimento encerrado.

Transições permitidas:

| Estado atual | Estado seguinte | Ator autorizado | Efeito |
| --- | --- | --- | --- |
| inexistente | `OPEN` | Solicitante autenticado, na criação | Cria solicitação, snapshot e evento inicial |
| `OPEN` | `IN_PROGRESS` | Atendente ativo do setor da solicitação | Atualiza estado e acrescenta evento |
| `IN_PROGRESS` | `COMPLETED` | Atendente ativo do setor da solicitação | Atualiza estado, define `completed_at` e acrescenta evento |

Todas as demais transições são proibidas, inclusive `OPEN` para `COMPLETED`, retorno para estado anterior, reabertura e cancelamento. Solicitações concluídas são terminais.

## 10. Regras de autorização por perfil

A autorização é aplicada no servidor em toda leitura ou mutação protegida. Ocultar botões ou páginas não é controle de acesso.

| Operação | Administrador | Solicitante | Atendente |
| --- | --- | --- | --- |
| Criar/editar/desativar usuários e configuração | Permitido | Negado | Negado |
| Consultar catálogo publicado | Negado nesta entrega | Permitido | Negado nesta entrega |
| Abrir solicitação para si | Negado | Permitido | Negado |
| Listar/consultar solicitação | Negado | Somente se for o solicitante | Somente se `Request.sector_id` for seu setor atual |
| Mudar status | Negado | Negado | Somente no setor atual e conforme transições permitidas |
| Consultar histórico de solicitação | Negado | Somente se for o solicitante | Somente se a solicitação pertencer ao seu setor atual |

A negação do acesso do administrador a solicitações é intencional nesta primeira entrega: o perfil administra configuração, não conteúdo operacional. Uma futura SPEC pode alterar esse modelo.

Antes de executar cada operação, o servidor deve verificar:

- sessão autenticada e usuário ainda ativo;
- perfil necessário à operação;
- propriedade do recurso pelo solicitante ou correspondência do setor do atendente, quando aplicável;
- estado atual da solicitação e validade da transição;
- estado ativo e relações válidas de serviço, categoria e setor na abertura;
- que identificadores de ator, solicitante e setor usados na persistência vêm da sessão e de relações validadas no servidor, nunca de valores fornecidos livremente pelo cliente.

Falhas de autorização não podem revelar dados de solicitações ou configuração restrita. A resposta pode ser de recurso não encontrado ou acesso negado, desde que o comportamento seja consistente e não exponha a existência de dados alheios.

## 11. Regras para setores, categorias e serviços

### Setores

- Nome obrigatório e não vazio; nomes de setores ativos devem ser únicos sem distinção entre maiúsculas e minúsculas.
- Setor pode ser editado e desativado, mas não apagado fisicamente.
- A desativação é rejeitada enquanto houver serviço ativo associado ou solicitação não concluída (`OPEN` ou `IN_PROGRESS`) registrada para o setor.
- Um setor inativo não pode receber novos atendentes nem serviços ativos. Solicitações concluídas e seu histórico continuam consultáveis por seus solicitantes.

### Categorias

- Nome obrigatório e não vazio; nomes de categorias ativas devem ser únicos sem distinção entre maiúsculas e minúsculas.
- Categoria pode ser editada e desativada, mas não apagada fisicamente.
- A desativação é rejeitada enquanto houver serviço ativo associado.
- Categoria inativa não pode ser usada por serviço ativo e seus serviços não aparecem no catálogo enquanto permanecer inativa.

### Serviços

- Nome e descrição obrigatórios e não vazios; categoria e setor obrigatórios.
- Um serviço só pode ser ativado quando sua categoria e seu setor estiverem ativos.
- Um serviço ativo fica indisponível para novas solicitações assim que ele, sua categoria ou seu setor estiver inativo.
- Desativar serviço é permitido mesmo que existam solicitações associadas. Isso impede novas solicitações, mas não remove, oculta ou bloqueia o atendimento das já criadas.
- Serviço pode ser editado; mudanças valem para novas solicitações. Serviço referenciado não pode ser apagado fisicamente.
- Reativar categoria ou setor não reativa serviços que tenham sido desativados individualmente. A disponibilidade depende de cada entidade estar ativa e de todas as relações requeridas também estarem ativas.

As validações de desativação e ativação devem ocorrer no servidor e ser atômicas em relação à gravação, para evitar a criação de solicitação contra configuração que se tornou indisponível durante a operação.

## 12. Regras para preservação do contexto histórico

No momento da criação, a solicitação deve armazenar, em campos próprios imutáveis:

- identificador do serviço de origem;
- nome e descrição do serviço;
- identificador e nome da categoria;
- identificador do setor responsável e seu nome.

Além dos snapshots, `Request.sector_id` mantém a área responsável original para roteamento e autorização. Editar o serviço para outro setor não migra solicitações existentes. Renomear ou desativar serviço, categoria ou setor não modifica os snapshots nem apaga solicitações ou eventos.

A referência ao serviço permanece válida porque entidades referenciadas não são fisicamente apagadas. Se a camada de dados permitir remoção administrativa fora da aplicação, a integridade referencial deve impedir apagar registros relacionados. Os snapshots são a fonte para exibir como o serviço e a organização eram apresentados quando a solicitação foi aberta; os registros atuais da configuração são fonte apenas para operações atuais.

Os eventos de status são imutáveis e preservam o identificador do ator. Usuários referenciados por solicitações ou eventos também não são fisicamente apagados pela aplicação.

## 13. Dados obrigatórios da solicitação

Para aceitar a criação, o servidor exige:

- usuário solicitante autenticado, ativo e com perfil `REQUESTER`;
- `service_id` existente e atualmente disponível;
- descrição não vazia após remoção de espaços periféricos, com máximo de 10.000 caracteres;
- dados de snapshot obtidos da configuração validada no servidor;
- identificador gerado, status inicial `OPEN` e horários gerados pelo servidor.

O cliente não pode definir `requester_id`, `sector_id`, snapshots, status, eventos, `created_at` ou `completed_at`. Esses valores são derivados da sessão, do serviço e das relações carregadas e validadas pelo servidor. Prioridade não é coletada nesta entrega.

## 14. Histórico de alterações de status

Gerar um evento nas seguintes situações:

1. **Criação:** evento com `from_status = null`, `to_status = OPEN`, ator igual ao solicitante e horário do servidor.
2. **Início do atendimento:** evento com `from_status = OPEN`, `to_status = IN_PROGRESS`, ator igual ao atendente autenticado.
3. **Conclusão:** evento com `from_status = IN_PROGRESS`, `to_status = COMPLETED`, ator igual ao atendente autenticado.

A gravação do evento e a atualização de status pertencem à mesma transação: ambas são confirmadas ou ambas são revertidas. Eventos não são criados para tentativas inválidas, negadas, repetidas ou para alterações de dados de usuário/configuração. A ordenação é por `occurred_at` e, em caso de empate, por identificador estável do evento.

## 15. Critérios de aceitação verificáveis

- [ ] Um administrador autenticado consegue criar, editar e desativar setores, categorias, serviços e usuários dentro das restrições desta SPEC.
- [ ] A aplicação rejeita e-mails duplicados sem distinção entre maiúsculas e minúsculas e usuários inconsistentes com perfil/setor.
- [ ] Um atendente não pode ser criado sem setor ativo; o servidor impede mudança ou desativação que deixe solicitações pendentes sem atendente ativo no setor.
- [ ] O catálogo do solicitante exibe apenas serviços ativos cuja categoria e setor também estejam ativos.
- [ ] A aplicação rejeita ativar serviço com categoria ou setor inativo e rejeita desativar categoria/setor que viole as dependências definidas.
- [ ] Um solicitante ativo consegue abrir uma solicitação somente com descrição válida e serviço disponível; campos de identidade, status, setor, snapshots e datas são definidos pelo servidor.
- [ ] A solicitação criada tem estado `OPEN`, snapshots corretos de serviço/categoria/setor e exatamente um evento inicial coerente.
- [ ] Editar ou desativar serviço, categoria ou setor não muda snapshots nem eventos de solicitações existentes; desativar serviço não impede o atendimento das solicitações existentes.
- [ ] Um solicitante consegue consultar suas solicitações e histórico e não consegue consultar solicitações de outro solicitante, mesmo requisitando diretamente seus identificadores à API.
- [ ] Um atendente consegue consultar e avançar solicitações do próprio setor e não consegue consultar ou alterar solicitações de outro setor.
- [ ] Administrador, solicitante e usuário não autenticado não conseguem executar transições de status; um administrador não obtém acesso operacional apenas pelo seu perfil.
- [ ] Somente `OPEN → IN_PROGRESS` e `IN_PROGRESS → COMPLETED` são aceitas; transições inválidas, repetidas, concorrentes ou após conclusão não alteram o registro nem criam evento.
- [ ] Cada transição válida grava exatamente um evento imutável com ator, estados e horário UTC; concluir também define `completed_at`.
- [ ] Usuário inativo não autentica nem executa operações; desativação não apaga solicitações ou eventos e a aplicação preserva ao menos um administrador ativo.
- [ ] Um usuário autenticado de cada perfil (`ADMIN`, `REQUESTER` e `ATTENDANT`) consegue alterar somente a própria senha, informando a senha atual, uma nova senha com no mínimo 12 caracteres e sua confirmação idêntica.
- [ ] Senha atual incorreta, nova senha abaixo do mínimo ou confirmação divergente não altera a credencial persistida; a operação identifica a conta apenas pela sessão server-side e não aceita `userId` enviado pelo cliente.
- [ ] Após alteração válida, somente o hash Argon2id da nova senha é persistido, a senha em texto puro não é registrada nem exibida, a sessão permanece autenticada e a nova senha permite autenticação subsequente.
- [ ] Os critérios de aceitação de documentos exigidos por serviço (CA-DOC-01 a CA-DOC-22, seção 21.12) são atendidos.
- [ ] A suíte automatizada cobre as regras de negócio, autorização, persistência e o percurso web completo definido nesta SPEC.

## 16. Estratégia de testes

### Testes unitários

- validação e normalização de e-mail;
- combinações válidas de perfil e setor;
- regras de ativação/desativação de setor, categoria e serviço;
- validação de descrição e disponibilidade de serviço;
- matriz de transições de status, incluindo estados terminais;
- decisões de autorização para administrador, solicitante e atendente;
- criação de snapshots a partir da configuração vigente.
- política de senha da alteração de senha própria: comprimento mínimo, confirmação e rejeição da senha atual incorreta.

### Testes de integração

Usar PostgreSQL de teste e testar persistência, relações, restrições e transações:

- provisionar usuários e configuração e abrir solicitação;
- verificar snapshots, setor de roteamento e evento inicial;
- executar transições e verificar eventos, timestamps e `completed_at`;
- comprovar rollback conjunto quando a gravação de evento ou solicitação falha;
- verificar efeitos de edição e desativação sobre solicitações existentes e sobre novas solicitações;
- testar concorrência de duas transições a partir do mesmo estado;
- impedir exclusão física de registros referenciados e impedir desativação do último administrador/atendente necessário;
- verificar persistência exclusiva do hash após alteração de senha, rejeição dos casos inválidos sem mudança da credencial e impossibilidade de escolher outra conta por ID de cliente.

### Testes de autorização

- acesso de solicitante a recurso próprio e tentativa de acesso a recurso alheio;
- acesso de atendente no próprio setor e tentativa em outro setor;
- tentativa por usuário inativo, não autenticado ou com perfil incorreto;
- tentativa de forjar no cliente `requester_id`, setor, status, snapshots, ator ou datas;
- acesso do administrador às operações de configuração e negação de acesso operacional às solicitações;
- alteração de senha própria autorizada para os três perfis; usuário não autenticado, conta inativa ou tentativa de forjar `userId` não altera nenhuma credencial.

### Testes ponta a ponta

Cobrir no navegador: autenticação de usuários provisionados, configuração pelo administrador, publicação de serviço, abertura e acompanhamento pelo solicitante, atendimento e conclusão por atendente autorizado, negação de operações proibidas e alteração da própria senha com confirmação de sucesso sem logout e rejeição de senha atual incorreta ou confirmação divergente.

### Documentos exigidos por serviço

A estratégia de testes específica dos requisitos documentais e anexos (unitários, integração, autorização e E2E) está definida na seção 21.13 e complementa as subseções acima.

## 17. Decisões técnicas iniciais

- Aplicação web em **Next.js (App Router) e TypeScript**, organizada como monólito modular.
- **PostgreSQL** como banco relacional e **Prisma** para esquema, migrações e acesso a dados.
- **Vitest** para testes unitários/integração e **Playwright** para testes ponta a ponta.
- Autenticação com biblioteca mantida compatível com Next.js (recomendação inicial: Auth.js com credenciais locais); senhas armazenadas somente com hash Argon2id. Sessões devem ser protegidas, validadas no servidor e invalidadas para usuários desativados. Não haverá cadastro público ou provedor externo nesta entrega.
- Verificações de autorização e validações de negócio são executadas no servidor em cada operação, além das validações de interface.
- Mudanças de status, criação de solicitação e evento correspondente são transacionais. Integridade relacional, índices para filas por setor e consultas por solicitante devem ser definidos no esquema.
- A implementação não deve adicionar dependências até que esta SPEC seja aprovada e a compatibilidade técnica seja verificada. Versões de ferramentas e detalhes de execução serão registrados antes ou durante a inicialização técnica, sem ampliar o escopo funcional.

## 18. Dependências da implementação

- Aprovação desta SPEC antes do início do código correspondente.
- Decisão registrada sobre biblioteca e configuração concreta de autenticação/sessões compatível com a stack aprovada.
- Ambiente local e de teste com PostgreSQL e configuração de conexão externa ao repositório.
- Estratégia segura de bootstrap do primeiro administrador, sem credenciais versionadas.
- Esquema e migrações para entidades, índices, restrições únicas e chaves estrangeiras desta SPEC.
- Política de backup e recuperação do banco definida para o ambiente de execução antes de uso com dados reais; não altera o escopo funcional.
- Ambiente de testes automatizados e execução dos testes relacionados antes de considerar a entrega concluída.

## 19. Pontos que deverão ser tratados em SPECs futuras

Cada item abaixo permanece fora desta entrega e requer SPEC própria antes de implementação:

- fluxos configuráveis por serviço e etapas adicionais;
- aprovação, responsáveis e decisões de aprovação;
- campos personalizados e validação específica de serviços;
- comentários e conversas; anexos fora do recorte aprovado na seção 21 (anexos em comentários, inclusão ou substituição após a abertura, anexos enviados por atendentes, outros formatos e arquivos acima dos limites definidos);
- ferramentas MCP de consulta a documentos (requisito futuro registrado na seção 21.11);
- SLA, vencimento, prioridades e alertas;
- notificações por canais internos ou provedores externos;
- dashboard, indicadores e relatórios;
- atribuição individual de atendentes e transferências;
- reabertura e cancelamento de solicitações;
- integrações externas e eventual aplicação mobile nativa;
- suporte a múltiplas organizações e isolamento entre organizações;
- políticas mais detalhadas de retenção, exportação e anonimização de dados.

Recuperação de senha, redefinição por terceiro, recuperação por e-mail e alteração da senha de outra pessoa pelo fluxo de autogerenciamento continuam explicitamente fora de escopo e exigem SPEC própria.

## 20. Alteração aprovada — 2026-10-06 — Autogerenciamento da própria senha

Esta alteração aprova, para a primeira entrega, a capacidade de usuários autenticados alterarem a própria senha. Ela complementa as regras de atores e permissões, o escopo, as regras de negócio, os critérios de aceitação e os testes das seções anteriores; não altera as demais permissões nem as operações administrativas já existentes.

### Regra funcional e de segurança

1. `REQUESTER`, `ATTENDANT` e `ADMIN` podem acessar a opção “Alterar senha” quando autenticados e ativos.
2. O formulário solicita senha atual, nova senha e confirmação da nova senha. A nova senha deve ter pelo menos 12 caracteres; a confirmação deve corresponder exatamente à nova senha.
3. A operação server-side obtém a identidade exclusivamente da sessão autenticada e carrega a credencial atual dessa conta. Não aceita `userId` ou outro identificador de conta fornecido pelo cliente para selecionar o usuário.
4. A senha atual deve ser verificada pela camada de autenticação existente. A nova senha deve ser processada pela mesma camada segura de hash já usada pela aplicação (Argon2id) e somente seu hash pode ser persistido.
5. Senha atual, nova senha e confirmação nunca são exibidas depois do envio, incluídas em mensagens de erro, registradas em logs ou armazenadas em texto puro. A credencial atual não pode ser modificada quando a senha atual for incorreta, a senha nova não atender ao mínimo ou a confirmação divergir.
6. Após sucesso, a confirmação é exibida e a sessão permanece autenticada. O fluxo de administrador serve exclusivamente para sua própria conta e não substitui a administração de usuários existente.
7. Recuperação ou redefinição por terceiro, inclusive por e-mail, não é incluída.

### Política mínima definida

A SPEC não possuía política de senha além de exigir valor não vazio nos fluxos de provisionamento/edição existentes. Para esta capacidade, fica definido o mínimo verificável de 12 caracteres para a nova senha. Esta aprovação não altera retroativamente os requisitos dos fluxos existentes de bootstrap ou administração de usuários.

### Critérios de aceitação e testes adicionados

Os três critérios de autogerenciamento estão incluídos na seção 15. As seções 16 (testes unitários, integração, autorização e E2E) foram ampliadas para verificar perfis permitidos, identidade exclusivamente server-side, hash persistido, ausência de alteração nos casos inválidos, permanência da sessão e novo login com a senha alterada.

## 21. Alteração aprovada — 2026-10-16 — Documentos exigidos por serviço

### 21.1 Registro da mudança de escopo

Anexos estavam **explicitamente fora do escopo inicial** desta SPEC (seções 5 e 19). Esta alteração passa a **autorizá-los** no recorte descrito a seguir: o administrador configura, por serviço, os documentos exigidos; o solicitante anexa os arquivos correspondentes na abertura da solicitação; atendentes autorizados e o próprio solicitante consultam e baixam esses arquivos. O foco inicial de uso são serviços de RH, mas a capacidade é genérica e vale para qualquer serviço cadastrado.

Esta alteração complementa as seções 4, 5, 15, 16 e 19. Não altera o ciclo de status (seção 9), a matriz de autorização existente (seção 10) nem as demais regras, exceto onde indicado abaixo. Nenhuma implementação foi realizada no registro desta alteração.

### 21.2 Requisitos documentais por serviço (configuração)

1. Somente `ADMIN` pode criar, editar, reordenar e desativar requisitos documentais de um serviço. A autorização é verificada no servidor.
2. Cada requisito documental pertence a exatamente um serviço e possui:
   - **nome**: obrigatório, não vazio após remoção de espaços periféricos, máximo de 120 caracteres; único entre os requisitos ativos do mesmo serviço, sem distinção entre maiúsculas e minúsculas;
   - **obrigatoriedade**: obrigatório ou opcional, definido pelo administrador;
   - **formatos aceitos**: subconjunto não vazio de `PDF`, `DOCX` e `TXT`;
   - **ordem de exibição** e estado **ativo/inativo**.
3. A configuração é específica de cada serviço. Não há requisitos herdados de setor ou categoria, nem conjunto padrão para todos os serviços de um setor.
4. Um serviço pode ter **zero** requisitos documentais. Nesse caso, a abertura funciona exatamente como antes desta alteração e não aceita anexos.
5. Um serviço pode ter no máximo **5 requisitos ativos** (justificativa na seção 21.6).
6. Requisitos são desativados logicamente. Requisito referenciado por anexo não pode ser apagado fisicamente.
7. Criar, editar ou desativar requisitos afeta somente solicitações futuras. Solicitações existentes e seus anexos não são alterados.
8. Nenhum setor, serviço ou requisito documental é cadastrado no código de produção, em migrations ou em seeds obrigatórios.

### 21.3 Exemplos configuráveis para serviços de RH

Os exemplos abaixo ilustram como uma organização **pode** configurar serviços de RH. Não são dados do sistema, não são criados automaticamente e sua obrigatoriedade não é fixada no código: o administrador decide, por serviço, quais documentos existem e quais são obrigatórios ou opcionais. Os serviços de RH não são presumidos iguais entre si.

| Serviço de exemplo | Documentos de exemplo |
| --- | --- |
| Férias | Requerimento de férias; documento de autorização |
| Declaração | Solicitação da declaração; documento de identificação, quando necessário |
| Alteração cadastral | Formulário de alteração; comprovante relacionado ao dado alterado |
| Escalas | Documento da escala; formulário de solicitação de alteração |
| Outros serviços | Documentos definidos pelo administrador |

Esses exemplos podem ser usados em testes e demonstrações apenas com conteúdo sintético.

### 21.4 Abertura de solicitação com anexos

1. Ao consultar um serviço com requisitos ativos, o solicitante vê a lista de documentos solicitados, com nome, indicação de obrigatório/opcional e formatos aceitos.
2. O solicitante pode anexar **um arquivo por requisito**. Cada arquivo é associado pelo cliente a um requisito do serviço; o servidor valida essa associação.
3. Antes de aceitar a solicitação, o servidor, com a configuração recarregada do banco:
   - confirma as regras já existentes de abertura (seções 7, 11 e 13);
   - confirma que cada arquivo referencia um requisito **ativo do próprio serviço** e que não há dois arquivos para o mesmo requisito;
   - rejeita qualquer arquivo enviado para serviço sem requisitos ativos;
   - confirma que todos os requisitos **obrigatórios** ativos possuem arquivo;
   - valida quantidade, tamanho individual, tamanho total, nome do arquivo e **tipo real** do conteúdo (seção 21.7), e que o formato detectado está entre os aceitos pelo requisito.
4. Se qualquer validação falhar, a solicitação **não é criada**, nenhum anexo é vinculado e nenhum evento de histórico é registrado. A resposta informa o problema com mensagem fixa, sem ecoar conteúdo de arquivo.
5. Se a configuração do serviço mudar entre a exibição do formulário e o envio, prevalece a configuração vigente no servidor; o envio inconsistente é rejeitado e o solicitante deve recarregar o formulário.
6. A criação da solicitação, do evento inicial e dos registros de anexo ocorre em uma única transação de banco. Os objetos são gravados no armazenamento antes dessa transação; se ela falhar, a aplicação tenta remover os objetos gravados (compensação). Nunca pode existir registro de anexo apontando para objeto inexistente; objeto órfão decorrente de falha da compensação não pode ser acessível por nenhuma rota e deve ser identificável para limpeza operacional.
7. Anexos não podem ser incluídos, substituídos ou removidos depois da abertura nesta alteração.
8. O cliente não define identificador do anexo, chave de armazenamento, tipo detectado, tamanho, hash, autor do envio, datas ou snapshots do requisito.

### 21.5 Atendimento e consulta dos anexos

1. Anexos ficam vinculados à solicitação e são imutáveis pela aplicação.
2. Autorização de leitura de metadados e download, verificada no servidor em **cada** requisição, com usuário autenticado e ativo:

| Perfil | Listar metadados e baixar anexos |
| --- | --- |
| Atendente | Somente se `Request.sector_id` da solicitação for o seu setor atual (mesma regra da seção 10) |
| Solicitante | Somente anexos das solicitações que ele abriu |
| Administrador | Negado (o perfil não possui acesso operacional, seção 10) |
| Não autenticado ou inativo | Negado |

3. O download ocorre por rota da aplicação que recebe somente identificadores, carrega solicitação e anexo do banco, confirma que o anexo pertence à solicitação e aplica a autorização acima antes de ler o objeto. Usuário não autorizado que acesse a rota diretamente recebe a mesma resposta de recurso não encontrado/negado definida na seção 10, sem revelar a existência do anexo.
4. Não são usadas URLs públicas nem URLs permanentes para documentos. A chave de armazenamento nunca é enviada ao cliente.
5. A resposta de download usa `Content-Type` derivado do formato detectado (não do informado no envio), `Content-Disposition: attachment` com nome sanitizado, `X-Content-Type-Options: nosniff` e `Cache-Control: private, no-store`.
6. Desativar ou editar o serviço, seus requisitos, sua categoria ou seu setor não apaga anexos, não altera seus metadados e não muda o histórico das solicitações anteriores. Os anexos de solicitações existentes continuam consultáveis pelos mesmos perfis autorizados, inclusive após conclusão.

### 21.6 Limites de tamanho e quantidade

| Limite | Valor | Justificativa |
| --- | --- | --- |
| Requisitos ativos por serviço | 5 | Os exemplos de RH usam 2 documentos; 5 dá margem sem permitir formulários extensos e limita a quantidade de arquivos por envio |
| Arquivos por solicitação | 5 (no máximo um por requisito) | Decorre do limite de requisitos |
| Tamanho por arquivo | 2 MiB (2.097.152 bytes) | Suficiente para formulários e documentos digitalizados comuns em PDF/DOCX/TXT; mantém o download pela rota autorizada abaixo do limite de corpo de resposta das funções do Vercel |
| Tamanho total por solicitação | 4 MiB (4.194.304 bytes) | O envio passa por função do Vercel, cujo corpo de requisição é limitado a cerca de 4,5 MB; 4 MiB deixa margem para a descrição (até 10.000 caracteres) e o overhead do `multipart/form-data` |
| Arquivo vazio | Rejeitado | Arquivo sem conteúdo não comprova documento |
| Nome original do arquivo | Até 255 caracteres após sanitização | Evita nomes abusivos; o nome é apenas informativo |

Os limites são validados no servidor (fonte de verdade) e informados na interface. O limite de corpo das Server Actions (1 MB por padrão no Next.js) deverá ser ajustado de forma compatível na implementação. Os limites da plataforma de hospedagem foram reconfirmados na SF-030 em 2026-10-16 e mantidos sem alteração; o cálculo de margem e o valor de configuração definido estão na seção 21.15. Arquivos maiores exigiriam upload direto ao armazenamento e uma nova alteração de SPEC.

### 21.7 Validação do tipo real do arquivo

A extensão e o MIME informados pelo navegador não são suficientes e não decidem a aceitação. O servidor inspeciona o conteúdo:

- **PDF**: o conteúdo começa com a assinatura `%PDF-`.
- **DOCX**: o conteúdo é um ZIP válido (assinatura `PK\x03\x04`) contendo `[Content_Types].xml` e `word/document.xml`, cujo tipo do documento principal é o de documento Word sem macros. Documentos com macros (`.docm` ou tipo `macroEnabled`) são rejeitados. A inspeção deve limitar o número de entradas e o tamanho descompactado lido, para evitar abuso de compressão.
- **TXT**: conteúdo UTF-8 válido (BOM opcional), sem bytes nulos e sem caracteres de controle além de tabulação, CR e LF.

A extensão do nome do arquivo (`.pdf`, `.docx`, `.txt`, sem distinção de maiúsculas) deve corresponder ao formato detectado, e o formato detectado deve constar entre os aceitos pelo requisito. Qualquer divergência rejeita o envio. Varredura antivírus não faz parte desta alteração e fica registrada como risco/possível evolução.

### 21.8 Armazenamento

**Infraestrutura analisada em 2026-10-16:** aplicação Next.js 16 publicada no Vercel; PostgreSQL hospedado no Supabase acessado via Prisma; nenhuma infraestrutura de armazenamento de arquivos; o sistema de arquivos das funções do Vercel é efêmero e não pode guardar documentos.

**Solução recomendada:** bucket **privado** do **Supabase Storage**, no mesmo provedor já usado pelo banco.

- O bucket não é público. O acesso ocorre **somente no servidor**, com credencial de serviço armazenada em variável de ambiente do Vercel e dos ambientes locais, nunca versionada e nunca exposta ao cliente (sem prefixo `NEXT_PUBLIC_`).
- O download é intermediado pela rota autorizada da seção 21.5; o cliente não recebe URL do armazenamento. URLs assinadas não são usadas nesta alteração.
- Ambientes de desenvolvimento, teste e produção usam buckets distintos. Testes de integração não podem usar o bucket de produção; podem usar um bucket isolado de teste ou um adaptador de armazenamento em memória/local, desde que o adaptador real tenha cobertura específica.
- O acesso ao armazenamento fica atrás de uma interface própria (adaptador) para não acoplar regras de negócio ao provedor.
- A integração deve preferir a API HTTP do provedor sem nova dependência; se uma dependência se mostrar necessária, ela deve ser justificada e registrada antes de ser adicionada.
- A política de backup e recuperação ainda pendente (seção 18) passa a abranger também os objetos do bucket.

**Alternativas consideradas:** (a) conteúdo em coluna binária no PostgreSQL — sem novo serviço e com transação única, mas aumenta banco e backups e consome a cota do banco; fica como alternativa caso o Supabase Storage seja inviável; (b) Vercel Blob — exigiria um novo provedor e a confirmação de suporte a armazenamento privado com o mesmo nível de controle; (c) sistema de arquivos local — incompatível com o Vercel.

A escolha do provedor foi confirmada na SF-030 em 2026-10-16 (seção 21.15). Qualquer mudança futura de provedor deve atender às regras desta seção e da seção 21.5 e ser registrada como alteração desta SPEC.

### 21.9 Metadados e entidades

**Requisito documental (`ServiceDocumentRequirement`):** `id`, `service_id`, `name`, `is_required`, `accepted_formats` (subconjunto não vazio de `PDF`, `DOCX`, `TXT`), `position`, `is_active`, `created_at`, `updated_at`. Relação `Service 1:N ServiceDocumentRequirement`.

**Anexo da solicitação (`RequestAttachment`):** registro imutável com

- `id` (UUID), `request_id`, `requirement_id` (referência ao requisito de origem);
- `requirement_name_snapshot` e `requirement_required_snapshot` (como o requisito estava na abertura);
- `original_filename` (sanitizado), `detected_format`, `content_type` (derivado do formato detectado), `size_bytes`, `sha256`;
- `storage_key` (opaca, gerada pelo servidor a partir de identificadores aleatórios, sem nome de arquivo nem dados pessoais);
- `uploaded_by_id` (o solicitante da sessão), `created_at`.

Relações: `Request 1:N RequestAttachment`, `ServiceDocumentRequirement 1:N RequestAttachment`, `User 1:N RequestAttachment` como autor do envio. Restrições relacionais impedem referências inexistentes e exclusão física de registros referenciados. Deve existir unicidade de `(request_id, requirement_id)`.

### 21.10 Logs e privacidade

- O conteúdo dos arquivos nunca é registrado em logs, mensagens de erro, respostas de erro ou telemetria.
- Logs não incluem nome original do arquivo, chave de armazenamento nem credenciais do armazenamento. Podem incluir identificadores, formato detectado, tamanho e código de erro.
- Erros do provedor de armazenamento são convertidos em mensagens fixas, seguindo o padrão de erros existente.
- Fixtures de testes usam somente conteúdo sintético gerado nos próprios testes (por exemplo, PDF mínimo, DOCX mínimo e TXT fictício). Não incluir dados pessoais nem documentos reais no repositório.

### 21.11 Integração MCP (requisito futuro, não implementado)

MCP não é implementado nesta alteração. Fica registrado como requisito para qualquer SPEC futura: ferramentas MCP que consultem ou baixem documentos devem usar as mesmas operações server-side e as mesmas verificações desta SPEC — usuário autenticado e ativo, perfil, propriedade pelo solicitante e setor atual do atendente. Uma ferramenta MCP não pode usar credencial de serviço do armazenamento, acesso direto ao banco ou qualquer outro caminho que contorne a autorização por perfil, propriedade ou setor, nem ampliar o acesso de um perfil.

### 21.12 Critérios de aceitação

- [ ] **CA-DOC-01** — Um administrador consegue criar, editar, reordenar e desativar requisitos documentais de um serviço, definindo nome, obrigatoriedade e formatos aceitos entre PDF, DOCX e TXT; solicitante, atendente e usuário não autenticado são negados no servidor.
- [ ] **CA-DOC-02** — O servidor rejeita requisito com nome vazio ou acima de 120 caracteres, nome duplicado entre requisitos ativos do mesmo serviço (sem distinção de maiúsculas), formatos vazios ou fora de PDF/DOCX/TXT e um sexto requisito ativo no mesmo serviço.
- [ ] **CA-DOC-03** — Requisitos de um serviço não aparecem nem são aceitos em outro serviço, inclusive de mesmo setor ou categoria.
- [ ] **CA-DOC-04** — Não há setores, serviços ou requisitos documentais criados por código de produção, migration ou seed obrigatório.
- [ ] **CA-DOC-05** — Um serviço sem requisitos ativos permite abrir solicitação sem anexos, com o mesmo comportamento anterior à alteração, e rejeita qualquer arquivo enviado.
- [ ] **CA-DOC-06** — Ao abrir um serviço com requisitos, o solicitante vê cada documento com nome, obrigatoriedade e formatos aceitos.
- [ ] **CA-DOC-07** — A solicitação não é criada quando falta arquivo para requisito obrigatório; é criada quando todos os obrigatórios estão presentes, mesmo sem os opcionais.
- [ ] **CA-DOC-08** — O servidor rejeita arquivo associado a requisito inexistente, inativo ou de outro serviço, e dois arquivos para o mesmo requisito.
- [ ] **CA-DOC-09** — O servidor aceita PDF, DOCX e TXT válidos quando o formato é aceito pelo requisito, e rejeita formato não aceito pelo requisito.
- [ ] **CA-DOC-10** — Arquivo com extensão ou MIME informado que não corresponde ao conteúdo real (por exemplo, executável renomeado para `.pdf`, `.docm` renomeado para `.docx`, binário renomeado para `.txt`) é rejeitado.
- [ ] **CA-DOC-11** — Arquivo vazio, arquivo acima de 2 MiB, total acima de 4 MiB ou mais de 5 arquivos são rejeitados no servidor, independentemente da validação da interface.
- [ ] **CA-DOC-12** — Em qualquer rejeição, nenhuma solicitação, evento ou registro de anexo é persistido, e objetos eventualmente gravados no armazenamento são removidos pela compensação ou ficam inacessíveis por qualquer rota.
- [ ] **CA-DOC-13** — Em envio aceito, a solicitação, o evento inicial e os anexos são persistidos de forma atômica; cada anexo tem metadados completos (seção 21.9) e o cliente não consegue definir chave, tipo detectado, tamanho, hash, autor ou datas.
- [ ] **CA-DOC-14** — Um atendente ativo do setor registrado na solicitação lista e baixa seus anexos; o conteúdo baixado é idêntico ao enviado (mesmo SHA-256).
- [ ] **CA-DOC-15** — O solicitante lista e baixa somente anexos das próprias solicitações.
- [ ] **CA-DOC-16** — Atendente de outro setor, outro solicitante, administrador, usuário inativo e usuário não autenticado não obtêm metadados nem conteúdo, inclusive acessando diretamente a rota de download com identificadores válidos, e recebem resposta que não revela a existência do anexo.
- [ ] **CA-DOC-17** — A rota recusa anexo cujo identificador não pertence à solicitação informada na URL.
- [ ] **CA-DOC-18** — Nenhuma resposta ao cliente contém URL pública, URL permanente ou chave do armazenamento; downloads retornam `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` e `Cache-Control: private, no-store`.
- [ ] **CA-DOC-19** — Editar ou desativar requisito, serviço, categoria ou setor não remove anexos, não altera seus metadados e snapshots e não impede o acesso autorizado aos anexos de solicitações anteriores.
- [ ] **CA-DOC-20** — Logs e mensagens de erro produzidos nos fluxos de envio e download não contêm conteúdo de arquivo, nome original, chave de armazenamento ou credencial do armazenamento.
- [ ] **CA-DOC-21** — O armazenamento usado é privado, acessado apenas pelo servidor com credencial fora do repositório, e os ambientes de teste não usam o armazenamento de produção.
- [ ] **CA-DOC-22** — As fixtures de teste contêm somente conteúdo sintético, sem dados pessoais ou documentos reais.

### 21.13 Estratégia de testes

**Unitários:** validação de requisito (nome, formatos, limite de 5); detecção de tipo real para PDF, DOCX, DOCX com macros, ZIP que não é DOCX, TXT válido, TXT com bytes nulos ou UTF-8 inválido, e extensão divergente; limites de tamanho e quantidade; sanitização do nome de arquivo; regra de correspondência arquivo/requisito e obrigatórios; política de autorização de anexos para os três perfis e para usuários inativos; ausência de dados sensíveis em mensagens de erro.

**Integração (PostgreSQL de teste e armazenamento isolado ou adaptador de teste):** CRUD de requisitos com unicidade e limite; abertura com e sem requisitos; rejeições sem persistência; atomicidade e compensação quando a transação falha após gravar objetos; snapshots preservados após editar/desativar requisito e serviço; impossibilidade de exclusão física de requisito referenciado; integridade do conteúdo por SHA-256.

**Autorização:** download e listagem por atendente do setor, atendente de outro setor (inclusive após mudança de setor), solicitante dono, outro solicitante, administrador, inativo e não autenticado; anexo de outra solicitação na URL; tentativa de forjar chave de armazenamento, tipo, autor ou requisito de outro serviço.

**E2E:** administrador configura requisitos de um serviço de exemplo; solicitante vê a lista, é impedido de enviar sem documento obrigatório e envia com sucesso; atendente do setor baixa o anexo; acesso direto à rota por usuário não autorizado é negado.

### 21.14 Dependências e pontos em aberto para a implementação

- ~~Confirmar o provedor de armazenamento (seção 21.8)~~ — confirmado na SF-030 (seção 21.15). Permanece pendente criar os buckets privados por ambiente e configurar as credenciais fora do repositório (seção 21.15.7).
- Migration aditiva para as novas entidades, sem alterar dados existentes.
- Ajuste do limite de corpo das Server Actions compatível com a seção 21.6, reconfirmando os limites vigentes do Vercel.
- Definição de procedimento operacional para limpeza de objetos órfãos e inclusão do bucket na política de backup e recuperação.
- Retenção e exclusão de documentos permanecem fora de escopo e seguem como ponto futuro da seção 19.

### 21.15 Confirmação técnica do armazenamento (SF-030 — 2026-10-16)

Esta subseção registra a verificação feita na SF-030 contra a documentação oficial vigente. Ela **confirma** a recomendação da seção 21.8 e **mantém** os limites da seção 21.6. Não altera requisitos funcionais. Nada foi implementado nem provisionado.

#### 21.15.1 Fatos verificados

| Fato | Fonte oficial | Consequência |
| --- | --- | --- |
| O corpo de **requisição e de resposta** de uma Vercel Function é limitado a **4,5 MB**; acima disso a função retorna `413 FUNCTION_PAYLOAD_TOO_LARGE` | Vercel — *Functions Limits* (atualizada em 2026-08-24) | O envio de todos os arquivos de uma solicitação, somado a descrição e overhead, precisa caber em 4,5 MB |
| Respostas em streaming não estão sujeitas a esse limite; para envios maiores, a Vercel recomenda upload direto do navegador ao armazenamento | Vercel KB — *How do I bypass the 4.5MB body size limit* | Download de até 2 MiB cabe na resposta mesmo sem streaming; upload direto só seria necessário com limites maiores |
| Server Actions aceitam por padrão 1 MB; `serverActions.bodySizeLimit` conta o corpo HTTP bruto, inclusive o overhead do `multipart/form-data` (estimativa da documentação: 10–20 KB) | Next.js 16.3.8 — `serverActions.md` e guia de Server Actions (em `node_modules/next/dist/docs/`) | É necessário configurar `bodySizeLimit` acima de 4 MiB e abaixo de 4,5 MB |
| Buckets são privados por padrão; em bucket privado o download só ocorre pelo endpoint autenticado (`/storage/v1/object/authenticated/{bucket}/{path}`) ou por URL assinada temporária | Supabase — *Storage Buckets*, *Serving assets* | Sem URL pública; o servidor baixa pelo endpoint autenticado |
| O bucket pode ter `fileSizeLimit` e `allowedMimeTypes`; uploads fora das restrições são rejeitados | Supabase — *Creating buckets*; *File limits* (limite global de 50 MB no plano Free) | Restrição no bucket serve como defesa adicional; o limite global não restringe os 2 MiB |
| Chaves secretas (`sb_secret_...`) e a `service_role` legada ignoram RLS e dão acesso irrestrito às APIs de Storage **de todo o projeto**; chaves secretas não funcionam em navegador (resposta 401); a `service_role` legada está em descontinuação até o fim de 2026; podem existir várias chaves secretas revogáveis individualmente | Supabase — *API keys*; *Storage Access Control* | Usar chave secreta nova e exclusiva do componente; bucket separado **não** isola a credencial dentro do mesmo projeto |
| Sem políticas RLS em `storage.objects`, o Storage não permite operações para clientes não privilegiados | Supabase — *Storage Access Control* | Não criar políticas RLS para o bucket; somente o servidor acessa |
| Variáveis do tipo **Secret** na Vercel são somente escrita após salvas, podem ter valor distinto por ambiente e são mascaradas nos logs de build | Vercel — *Config and Secret environment variables* (atualizada em 2026-08-28) | A credencial do armazenamento deve ser cadastrada como Secret, com valor próprio em Production |

#### 21.15.2 Decisão arquitetural confirmada

- **Armazenamento:** Supabase Storage, bucket **privado**, sem políticas RLS para `anon`/`authenticated`, acessado **somente** por código server-side (runtime Node.js) com **chave secreta** `sb_secret_` dedicada ao ServiceFlow. A `service_role` legada não deve ser usada.
- **Upload intermediado pelo servidor:** o navegador envia os arquivos à Server Action de abertura; o servidor valida tudo antes de gravar no armazenamento. Não há upload direto do navegador ao Storage.
- **Download intermediado pelo servidor:** rota da aplicação autoriza e repassa o conteúdo; o cliente nunca recebe URL do Storage.
- **Alternativas rejeitadas:** upload direto com URL de upload assinada (válida por até 2 horas segundo a documentação do Supabase) — exigiria validar o conteúdo depois de gravado, geraria órfãos por desenho e entregaria um token ao cliente, sem necessidade porque os limites cabem no corpo da função; download por URL assinada — funciona para qualquer portador do link durante a validade e pode vazar por histórico ou compartilhamento, sem necessidade porque 2 MiB cabem na resposta da função; PostgreSQL `bytea` e Vercel Blob mantidos como alternativas, conforme a seção 21.8.

#### 21.15.3 Verificação dos limites (sem alteração)

Considerando o limite da Vercel de forma conservadora como 4.500.000 bytes (a documentação escreve "4.5 MB" sem definir se é base decimal ou binária):

| Componente | Pior caso |
| --- | --- |
| Arquivos (total) | 4.194.304 bytes (4 MiB) |
| Descrição (10.000 unidades de texto; até 3 bytes UTF-8 cada) | 30.000 bytes |
| Overhead multipart, nomes de arquivo, identificadores e campos | ~20.000 bytes (estimativa da documentação do Next.js) |
| **Total estimado** | **~4.244.304 bytes** |

- **Configuração definida para a SF-034:** `serverActions.bodySizeLimit` = **4.456.448 bytes** (`'4.25mb'`, 4,25 MiB). Fica abaixo de 4.500.000 bytes e deixa 262.144 bytes acima dos 4 MiB de arquivos para descrição e overhead.
- Download de um arquivo de até 2 MiB fica abaixo do limite de resposta; streaming é permitido, mas não é exigido.
- **Conclusão:** os limites de 2 MiB por arquivo, 4 MiB por solicitação, 5 arquivos e 5 requisitos ativos são compatíveis e **não foram alterados**. Como o limite da Server Action barra o corpo antes da validação de negócio, a interface deve validar os tamanhos antes do envio, para dar mensagem útil; a validação do servidor continua sendo a fonte de verdade.

#### 21.15.4 Fluxo de upload, validação e persistência

1. A Server Action de abertura (runtime Node.js) confirma sessão, usuário ativo e perfil `REQUESTER` antes de ler os arquivos.
2. Lê o `FormData`, rejeita quantidade acima de 5, arquivo vazio, arquivo acima de 2 MiB e total acima de 4 MiB.
3. Carrega serviço, categoria, setor e requisitos ativos do banco; valida a correspondência arquivo/requisito e os obrigatórios (seção 21.4).
4. Para cada arquivo: lê os bytes, detecta o tipo real (seção 21.7), confere extensão e formatos aceitos, sanitiza o nome e calcula o SHA-256. Nenhum dado é gravado até aqui.
5. Gera no servidor o UUID da solicitação e de cada anexo. A chave de armazenamento é `requests/{requestId}/{attachmentId}`, sem nome de arquivo ou dado pessoal.
6. Grava cada objeto no bucket com a chave secreta, `Content-Type` derivado do formato detectado e **sem sobrescrita** (upsert desligado).
7. Abre a transação de banco: rechecagem da disponibilidade do serviço (como hoje), criação da solicitação, do evento inicial e dos anexos.
8. Sucesso: confirma a transação e retorna somente dados de exibição.

#### 21.15.5 Falhas e compensação

- **Falha antes do passo 6:** nada é gravado.
- **Falha ao gravar um objeto:** remove os objetos já gravados nessa tentativa, não abre a transação e retorna mensagem fixa.
- **Falha da transação:** remove os objetos gravados nessa tentativa (compensação) e retorna mensagem fixa.
- **Falha da compensação:** o erro é registrado somente com um identificador de correlação, a quantidade de objetos e o código do erro, sem chave de armazenamento, nome de arquivo ou conteúdo. O objeto fica **inacessível**, porque a rota de download só lê objetos referenciados por um registro de anexo no banco.
- **Limpeza de órfãos:** procedimento operacional, a ser implementado em tarefa posterior, que lista objetos sob `requests/` cujo `requestId` não exista no banco e que tenham mais de 24 horas (para não atingir criações em andamento) e os remove. Não remove objetos referenciados.
- **Invariante:** como os objetos são gravados antes do commit, não existe registro de anexo apontando para objeto inexistente.

#### 21.15.6 Fluxo de download

1. Rota GET da aplicação (runtime Node.js, sem cache) recebe somente `requestId` e `attachmentId`.
2. Confirma sessão e usuário ativo, carrega a solicitação e o anexo **filtrando pelos dois identificadores**, e aplica a autorização da seção 21.5 (propriedade do solicitante ou setor atual do atendente). Em qualquer negação responde da mesma forma que um recurso inexistente.
3. Lê o objeto pelo endpoint autenticado do Storage com a chave secreta, confere o tamanho com o metadado e devolve o conteúdo com os cabeçalhos da seção 21.5. Divergência ou erro do Storage gera resposta de erro fixa, sem detalhes do provedor.

#### 21.15.7 Separação de ambientes e credenciais

- Como a chave secreta dá acesso a **todos** os buckets do projeto Supabase, a credencial de produção precisa ficar em um **projeto Supabase exclusivo de produção** (ou outro arranjo que impeça uma credencial não produtiva de ler os documentos de produção). Desenvolvimento e teste podem compartilhar um projeto não produtivo, com buckets distintos.
- Nomes de bucket definidos: `serviceflow-documents` (produção), `serviceflow-documents-dev` (desenvolvimento), `serviceflow-documents-test` (teste). O adaptador de teste deve recusar bucket cujo nome não termine em `-test`, seguindo a proteção já usada para o banco `_test`.
- Configuração de cada bucket: `public = false`; `fileSizeLimit` = 2 MiB; `allowedMimeTypes` = `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/plain`. Essas restrições são defesa adicional; a validação de conteúdo do servidor continua obrigatória porque a documentação não informa se o Storage inspeciona o conteúdo ou só o `Content-Type`.
- Variáveis de ambiente server-side (nomes definidos; serão adicionados aos arquivos de exemplo somente na tarefa de implementação, com valores vazios): `DOCUMENT_STORAGE_URL` (Config), `DOCUMENT_STORAGE_BUCKET` (Config) e `DOCUMENT_STORAGE_SECRET_KEY` (**Secret**, valor distinto em Production). Para testes: `TEST_DOCUMENT_STORAGE_URL`, `TEST_DOCUMENT_STORAGE_BUCKET` e `TEST_DOCUMENT_STORAGE_SECRET_KEY`, sem fallback para as variáveis de produção/desenvolvimento. Nenhuma pode ter prefixo `NEXT_PUBLIC_`.
- Testes automatizados usam por padrão o adaptador em memória; testes do adaptador real rodam somente quando as variáveis `TEST_DOCUMENT_STORAGE_*` estiverem configuradas.
- O módulo que lê a chave secreta só pode ser importado por código server-side.

#### 21.15.8 Dependência

O upload, o download e a remoção de objetos devem usar a API HTTP do Storage via `fetch`, sem nova dependência. Rotas observadas: `POST /storage/v1/object/{bucket}/{path}` (upload, documentada na referência de self-hosting do Storage) e `GET /storage/v1/object/authenticated/{bucket}/{path}` (download, documentada no guia *Serving assets*). A rota de remoção e os detalhes de cabeçalho devem ser confirmados na SF-033. Se a API HTTP se mostrar inviável, a adoção de `@supabase/supabase-js` deve ser justificada e registrada antes.

#### 21.15.9 Limitações da verificação

- O provisionamento **não foi feito**: buckets, chaves secretas e variáveis de ambiente não foram criados, e a negação de leitura anônima não foi testada contra um bucket real. Isso exige acesso às contas Supabase e Vercel pelo responsável e fica pendente na SF-030.
- Não foi possível verificar o estado atual das contas: se produção já usa um projeto Supabase separado e qual o plano contratado.
- A documentação da Vercel não define se "4.5 MB" é base decimal ou binária; adotou-se o valor menor (4.500.000 bytes).
- A documentação do Supabase não informa se `allowedMimeTypes` verifica o conteúdo ou apenas o `Content-Type`.
- A rota HTTP de upload foi confirmada na referência de self-hosting, não na referência da plataforma hospedada; a rota de remoção não foi confirmada.

#### 21.15.10 Fontes oficiais consultadas em 2026-10-16

- Vercel — Functions Limits: https://vercel.com/docs/functions/limitations
- Vercel — How do I bypass the 4.5MB body size limit of Vercel Functions: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
- Vercel — Config and Secret environment variables: https://vercel.com/docs/environment-variables/sensitive-environment-variables
- Supabase — Storage Buckets (fundamentals): https://supabase.com/docs/guides/storage/buckets/fundamentals
- Supabase — Creating buckets: https://supabase.com/docs/guides/storage/buckets/creating-buckets
- Supabase — File limits: https://supabase.com/docs/guides/storage/uploads/file-limits
- Supabase — Storage Access Control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase — Serving assets from Storage: https://supabase.com/docs/guides/storage/serving/downloads
- Supabase — Understanding API keys: https://supabase.com/docs/guides/api/api-keys
- Supabase — Self-hosting Storage API, Upload a new object: https://supabase.com/docs/reference/self-hosting-storage/upload-a-new-object
- Next.js 16.3.8 (local, versão instalada) — `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md` e `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`

## 22. Alteração aprovada — 2026-10-29 — Modo de demonstração sem senha

Alteração solicitada pela responsável pelo projeto para uso didático. Ela **altera** as regras de autenticação das seções anteriores conforme descrito aqui; o restante da SPEC permanece válido.

### 22.1 Decisões aprovadas

1. A tela `/login` continua existindo, mas o acesso **não exige e-mail nem senha**.
2. A tela oferece três botões: **Entrar como Administrador**, **Entrar como Solicitante** e **Entrar como Atendente**. Cada botão inicia uma sessão com uma conta de demonstração do perfil escolhido.
3. Vale **em todos os ambientes**, inclusive na publicação da Vercel. Não há variável de ambiente para desligar o modo.
4. O formulário de e-mail e senha permanece disponível na mesma tela, como alternativa secundária, para contas criadas no painel administrativo e para os testes existentes.

### 22.2 Contas de demonstração

| Perfil | Nome | E-mail |
|---|---|---|
| `ADMIN` | Administrador (demonstração) | `demo.administrador@serviceflow.demo` |
| `REQUESTER` | Solicitante (demonstração) | `demo.solicitante@serviceflow.demo` |
| `ATTENDANT` | Atendente (demonstração) | `demo.atendente@serviceflow.demo` |

- São usuários reais do banco, criados no primeiro acesso de cada perfil. Os acessos seguintes reutilizam a mesma conta e a reativam, restauram o perfil e, no caso do atendente, o setor, se tiverem sido alterados no painel.
- O atendente de demonstração pertence ao setor ativo **"Setor de demonstração"**, criado no primeiro acesso se não existir.
- A senha dessas contas é um hash Argon2id de um valor aleatório descartado: elas não podem ser usadas pelo formulário de e-mail e senha.
- O sistema continua genérico: nenhum setor ou serviço além do setor de demonstração é criado automaticamente.

### 22.3 O que não muda

- Autorização por perfil e por setor no servidor, sessões JWT, recarga do usuário a cada leitura de sessão e todas as regras de negócio.
- O bootstrap do primeiro administrador continua disponível.

### 22.4 Riscos aceitos

- Na Vercel, **qualquer pessoa com o endereço entra como administrador** e pode ver, criar, alterar e desativar dados. A publicação deve conter somente dados fictícios.
- O perfil passa a ser escolhido pelo cliente no login de demonstração. A asserção "does not expose role or sector as credential fields" de `tests/unit/modules/auth/config.test.ts`, que protegia o contrário, é atualizada por esta alteração.

### 22.5 Critérios de aceitação

- [ ] **CA-DEMO-01** — `/login` exibe os três botões; cada um leva à área do perfil (`/admin`, `/catalog`, `/queue`) sem pedir e-mail ou senha.
- [ ] **CA-DEMO-02** — Repetir o acesso de um perfil reutiliza a mesma conta (nenhum usuário duplicado).
- [ ] **CA-DEMO-03** — O atendente de demonstração fica vinculado a um setor ativo e vê a fila desse setor.
- [ ] **CA-DEMO-04** — Um perfil inválido enviado ao login de demonstração é recusado sem criar sessão.
- [ ] **CA-DEMO-05** — As contas de demonstração não autenticam pelo formulário de e-mail e senha.
- [ ] **CA-DEMO-06** — O login por e-mail e senha continua funcionando para as demais contas; lint, typecheck, build e as suítes unitária, de integração e E2E passam.
