# ServiceFlow

Plataforma configurável para gerenciamento de solicitações de serviços internos.

## Estado do projeto

- SF-001 a SF-025 estão concluídas.
- SF-026 continua incompleta: a medição oficial de 2026-10-06 é de 8.903 linhas contabilizáveis, abaixo da meta acadêmica de 100.000. Não se deve inflar a contagem com código artificial nem implementar funcionalidades fora da SPEC para tentar atingir a meta.
- SF-027 está concluída: os procedimentos documentados foram verificados com instalação limpa das dependências e execução das suites e verificações de qualidade.
- SF-028 foi revisada, mas permanece não concluída porque SF-026 continua incompleta e a política operacional de backup/recuperação ainda depende de definição e teste de restauração.
- SF-029: implementação da alteração da própria senha; testes manuais concluídos com sucesso. A validação automatizada de integração permanece pendente devido à indisponibilidade do setup PostgreSQL/Prisma Client.
- Os fluxos E2E completos da primeira entrega já foram implementados e executados com sucesso.
- Documentos exigidos por serviço (SPEC principal, seção 21): configuração (SF-032), validação de arquivos (SF-033), abertura com documentos (SF-034), consulta e download autorizados (SF-035) e testes E2E (SF-036) concluídos em 2026-10-31. O armazenamento real no Supabase (SF-030) ainda não foi provisionado: sem ele, envios com arquivo são recusados.

## Requisitos e stack

- Node.js 24.21.0 (mínimo suportado pelo Next.js: 20.9.0).
- npm 11.19.0.

Essas versões foram usadas nas validações do projeto. A stack inclui Next.js 16.3.8, React 19.2.8, TypeScript 5, PostgreSQL com Prisma 6.16.0, Auth.js com Argon2id, Vitest e Playwright com Chromium.

## Desenvolvimento

Instale as dependências e inicie o servidor:

```bash
npm ci
npx prisma generate
npm run dev
```

A aplicação fica disponível publicamente em:

**[Acessar o ServiceFlow](https://dsai-ap1-serviceflow-6ae1.vercel.app/login)**

Para execução local, use `http://localhost:3000`. Para usar as telas protegidas, configure o banco e crie o primeiro administrador conforme as instruções abaixo.

No Windows PowerShell, se a política de execução bloquear os launchers `npm.ps1` ou `npx.ps1`, use os equivalentes `npm.cmd` e `npx.cmd` (por exemplo, `npm.cmd run dev`); não é necessário alterar a política do sistema.

## Variáveis de ambiente

O runtime do Next.js e o Prisma usam `DATABASE_URL` para conectar ao PostgreSQL. Crie um arquivo local ignorado pelo Git (`.env.local` para Next.js; `.env` também é lido pelo Prisma CLI) a partir do exemplo:

```powershell
Copy-Item .env.example .env
```

Conteúdo esperado no arquivo local:

Inclua também `AUTH_SECRET=<segredo gerado localmente>`; gere-o pelo comando abaixo e não reutilize valores entre ambientes.

```env
NODE_ENV=development
DATABASE_URL=postgresql://serviceflow:change-me@localhost:5432/serviceflow_dev
```

- O arquivo `.env` real deve permanecer fora do Git.
- A URL do banco deve usar o protocolo `postgresql://` ou `postgres://`.
- O banco deve ser criado previamente em uma instância local do PostgreSQL e o nome do schema/database deve refletir o ambiente escolhido.
- Gere `AUTH_SECRET` localmente com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` e mantenha o valor somente no arquivo de ambiente ignorado pelo Git. Use um valor independente e protegido para cada ambiente.
- Nunca versione arquivos `.env`, `.env.local` ou `.env.test.local`, nem registre valores reais de conexão ou segredos.

### Armazenamento de documentos

Os arquivos anexados ficam num bucket **privado** do Supabase Storage, acessado só pelo servidor (SPEC principal, seção 21.15). Configure no arquivo local, sem prefixo `NEXT_PUBLIC_`:

```env
DOCUMENT_STORAGE_URL=https://<projeto>.supabase.co
DOCUMENT_STORAGE_BUCKET=serviceflow-documents-dev
DOCUMENT_STORAGE_SECRET_KEY=<chave sb_secret_ exclusiva do ServiceFlow>
```

- Sem essas variáveis, serviços sem documentos exigidos funcionam normalmente, mas envios com arquivo são recusados com a mensagem "Não foi possível guardar os documentos agora". Isso inclui os serviços de RH do `npm run seed:demo`, que têm documento obrigatório.
- Depois de configurar as variáveis, crie e verifique o bucket com `npm run storage:provision` (ou `npm run storage:provision -- test` para `TEST_DOCUMENT_STORAGE_*`). O comando deixa o bucket privado, com limite de 2 MiB e só PDF, DOCX e TXT. Em seguida grava um arquivo sintético, confirma que a leitura anônima é negada e o remove. Não cria políticas RLS.
- Com `TEST_DOCUMENT_STORAGE_*` em `.env.test.local`, `npm run test:integration` também testa o adaptador real contra o bucket de teste; sem essas variáveis, esse teste é pulado.
- **Job diário (`/api/cron/daily`, agendado no `vercel.json`):** grava os alertas de prazo, processa eventos pendentes e faz as limpezas. Exige a variável `CRON_SECRET` (Secret, com pelo menos 16 caracteres) na Vercel; sem ela, a rota responde 401 e não faz nada. Para rodar localmente: `curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/daily`.
- Na Vercel, cadastre `DOCUMENT_STORAGE_SECRET_KEY` como variável **Secret**, com valor próprio em Production. A chave de produção deve pertencer a um projeto Supabase exclusivo de produção (seção 21.15.7).

## Autenticação

A autenticação usa Auth.js com credenciais locais e sessões JWT em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção. Senhas são verificadas com Argon2id. A callback de sessão consulta o usuário atual no PostgreSQL a cada leitura, atualiza perfil/setor e descarta sessões de contas inativas; os helpers em `src/server/authorization/` aplicam as permissões server-side sem confiar em perfil ou setor enviados pelo cliente. Usuários autenticados podem alterar a própria senha em `/account/password`, informando a senha atual e uma nova senha com pelo menos 12 caracteres e confirmação idêntica; a conta é identificada pela sessão e somente o hash Argon2id é persistido. Não há cadastro público, recuperação de senha nem credencial padrão; o primeiro administrador é provisionado manualmente pelo procedimento seguro de bootstrap abaixo.

### Primeiro administrador

Com `DATABASE_URL` configurada no ambiente local (`.env.local` ou outro arquivo reconhecido pelo Next.js), execute `npm run bootstrap:admin` uma única vez em um terminal interativo. O comando pergunta nome e e-mail e solicita a senha duas vezes sem ecoá-la; não aceita credenciais por argumentos nem variáveis de ambiente. Ele recusa a operação se já houver qualquer administrador, armazena somente o hash Argon2id e não funciona como seed recorrente. Não execute o bootstrap apontando para o banco de testes.

## PostgreSQL local

Para desenvolvimento local, crie uma instância PostgreSQL e o banco indicado por `DATABASE_URL`. Por exemplo:

```bash
createdb serviceflow_dev
```

Em seguida, configure a URL local correspondente. O ambiente de integração e E2E deve usar outra base física terminada em `_test`; não use o banco de desenvolvimento ou produção para fixtures.

## Prisma

O esquema fica em `prisma/schema.prisma` e as migrations versionadas ficam em `prisma/migrations/`. O Prisma Client é usado somente no servidor. Após uma instalação limpa (`npm ci`), gere o cliente antes de executar a aplicação ou os testes unitários. Valide também o esquema:

```bash
npx prisma validate
npx prisma generate
```

Para aplicar migrations existentes em um banco configurado:

```bash
npx prisma migrate deploy
```

`npx prisma migrate status` consulta o estado das migrations. Use `npx prisma migrate dev` somente em desenvolvimento para criar/aplicar migrations durante mudanças de schema; não edite migrations já aplicadas. Para ambientes existentes/deploy, aplique migrations versionadas com `migrate deploy`.

Os domínios administrativos server-side ficam em `src/modules/sectors/`, `src/modules/categories/`, `src/modules/users/` e `src/modules/services/`. As operações exigem autorização central de administrador; nomes de setor/categoria são case-insensitive e únicos entre registros ativos. Desativação é lógica e preserva solicitações e referências históricas. Setores/categorias com dependências impeditivas não podem ser desativados; atendentes não podem ser desativados ou transferidos se forem o único atendente ativo necessário às solicitações pendentes do setor.

### Backup e recuperação

A política operacional de backup e recuperação do PostgreSQL ainda precisa ser definida para o ambiente de execução. Defina e valide essa política, incluindo um teste de restauração isolado, antes de usar o sistema com dados reais. Consulte também a dependência registrada na seção 18 da SPEC principal; este README não presume frequência, retenção nem objetivos de recuperação.

## Fluxos disponíveis

- Administradores autenticados configuram usuários, setores, categorias e serviços em `/admin`.
- Administradores, solicitantes e atendentes autenticados podem alterar somente a própria senha em `/account/password`.
- Solicitantes autenticados consultam o catálogo publicado em `/catalog`, abrem solicitações a partir do detalhe do serviço e acompanham somente suas próprias solicitações em `/requests`.
- Atendentes autenticados consultam a fila do setor em `/queue` e iniciam/concluem solicitações permitidas. O setor da fila é o snapshot registrado na abertura.
- Atribuição (`SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md`): um atendente **assume** uma solicitação do seu setor e pode **liberá-la** ou **transferi-la** a um colega ativo do mesmo setor. Com responsável, só ele inicia e conclui; sem responsável, qualquer atendente do setor.
- Cancelamento e reabertura: o solicitante cancela a própria solicitação enquanto está aberta (motivo opcional); o atendente do setor cancela aberta ou em atendimento, com justificativa obrigatória. Cancelada é definitiva. O solicitante reabre uma solicitação concluída em até 7 dias, com justificativa, e ela volta para o mesmo responsável.
- O histórico de cada solicitação mostra, em ordem, mudanças de status, atribuições e justificativas.
- Conversa (`SPEC/2026-10-31-comentarios.md`): solicitante e atendentes do setor trocam comentários em texto na solicitação (aberta, em atendimento ou concluída; cancelada fica só para leitura). Atendentes podem marcar uma **nota interna**, que o solicitante não vê. Comentários não são editados nem apagados. A fila e "Minhas solicitações" mostram a quantidade de comentários.
- Busca e páginas (`SPEC/2026-10-31-busca-filtros-paginacao.md`): "Minhas solicitações" e a fila têm busca por texto (descrição ou serviço), filtros de status, período de abertura e, na fila, responsável ("Atribuídas a mim" e "Sem responsável"), ordem e 20 solicitações por página. Os critérios ficam na URL, então recarregar ou compartilhar o link mantém a busca.
- Notificações (`SPEC/2026-10-31-eventos-outbox-jobs.md`): solicitante e atendente veem "Notificações" com contador no topo e a lista das mais recentes (`/notifications` ou `/queue/notifications`). Avisam mudança de status, transferência para você, comentário e nota interna (só ao responsável). As ações gravam eventos na mesma transação; eles são processados logo após a resposta e, se algo falhar, pelo job diário.
- SLA e prioridades (`SPEC/2026-11-01-sla-prioridades.md`): o administrador define, por serviço, a prioridade padrão e um prazo-base em horas (opcional; sem prazo, nada muda). O prazo efetivo depende da prioridade (Urgente 25%, Alta 50%, Normal 100%, Baixa 200%), em horas corridas a partir da abertura ou da reabertura. Fila, detalhes e "Minhas solicitações" mostram prioridade, vencimento e situação (dentro do prazo, próximo do vencimento, vencido); a fila filtra por situação e ordena por vencimento mais próximo. O atendente do setor (o responsável, se houver) muda a prioridade, o que recalcula o vencimento e entra no histórico. O job diário avisa uma vez quando o prazo fica próximo e uma vez quando vence: ao responsável ou, sem ele, aos atendentes do setor. No plano gratuito da Vercel o job roda uma vez por dia, então o aviso pode atrasar até um dia; a situação na tela é sempre exata.
- Campos personalizados (`SPEC/2026-11-01-campos-personalizados.md`): o administrador define, por serviço, até 10 campos que o solicitante preenche ao abrir a solicitação — texto curto, texto longo, número inteiro (com mínimo e máximo opcionais), data, lista de opções e sim ou não, cada um obrigatório ou opcional e com texto de ajuda. Os campos podem ser editados, reordenados, desativados e reativados; o tipo não muda depois de criado. O servidor confere as respostas com a configuração do momento do envio; numa recusa, o erro aparece junto do campo e a descrição e as respostas continuam preenchidas (arquivos precisam ser anexados de novo). As respostas guardam o rótulo da abertura, não podem ser editadas e aparecem nos detalhes para o solicitante e os atendentes do setor. Serviço sem campos funciona como antes; o banco fictício traz um exemplo em "Manutenção de ar-condicionado".
- Fluxos configuráveis (`SPEC/2026-11-01-fluxos-configuraveis.md`): o administrador define, por serviço, até 8 etapas do atendimento (criar, renomear, reordenar, desativar e reativar). As etapas existem dentro de "Em atendimento": ao iniciar, a solicitação guarda uma cópia das etapas ativas e entra na primeira; o atendente do setor (o responsável, se houver) avança uma etapa por vez ou volta uma etapa com justificativa, e só conclui na última. Mudar o fluxo não altera solicitações em andamento; a reabertura limpa as etapas e o novo início usa o fluxo vigente. A etapa aparece nos detalhes, na fila e em "Minhas solicitações", as mudanças entram no histórico e o solicitante é notificado a cada uma. Serviço sem etapas funciona como antes.
- Aprovações (`SPEC/2026-11-01-aprovacoes.md`): novo perfil **Gestor**, ligado a um setor (cadastro pela administração; conta "Gestor (demonstração)" no login). Um serviço pode exigir aprovação do gestor: a solicitação nasce "Aberta" com a aprovação pendente, sem prazo de SLA, e ninguém inicia o atendimento antes da decisão. Qualquer gestor ativo do setor decide uma vez, na área "Aprovações": aprovar (observação opcional) libera o atendimento e o prazo passa a contar da aprovação; rejeitar (observação obrigatória) cancela a solicitação. Os gestores são avisados na abertura e o solicitante, da decisão; a situação da aprovação aparece para solicitante e atendente e a decisão entra no histórico. O gestor vê só as solicitações do seu setor que exigem aprovação, só para leitura. Serviço sem aprovação funciona como antes.
- A rota inicial encaminha a sessão autenticada à interface do perfil obtido do servidor; o cliente não escolhe papel.
- A abertura valida no servidor a disponibilidade atual do serviço, categoria e setor e grava snapshots e evento inicial junto da solicitação. Transições persistem status e evento de histórico atomicamente.
- Administradores configuram, por serviço, até 5 documentos exigidos (PDF, DOCX ou TXT; obrigatórios ou opcionais). O solicitante anexa um arquivo por documento ao abrir a solicitação (até 2 MiB cada, 4 MiB no total); o servidor confere o conteúdo real de cada arquivo.
- O solicitante e os atendentes do setor da solicitação veem os documentos enviados no detalhe e os baixam por `/api/requests/<solicitação>/attachments/<anexo>`, rota que autoriza cada download. Para qualquer outra pessoa, a rota responde como se o anexo não existisse.

## Testes

As suites podem ser executadas separadamente:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

Os testes de integração e E2E exigem um banco PostgreSQL **dedicado** cujo nome termine em `_test`. Nunca use o banco de desenvolvimento ou produção. Crie uma base física separada (por exemplo, `serviceflow_test`); para Supabase, use uma base de teste separada, não apenas outro schema no banco de desenvolvimento.

Copie `.env.test.example` para `.env.test.local` e configure `TEST_DATABASE_URL` com a URL do banco de teste:

```powershell
Copy-Item .env.test.example .env.test.local
```

O arquivo `.env.test.local` é ignorado pelo Git. Os runners validam que a URL de teste aponta para uma base dedicada terminada em `_test`, não a mesma base de `DATABASE_URL`, e não usam `DATABASE_URL` como fallback. A suite de integração gera o Prisma Client, testa a conexão e aplica migrations exclusivamente na base de teste; seus fixtures são limpos antes de cada teste. O setup E2E também aplica migrations, limpa a base dedicada e cria um administrador de teste antes de iniciar o navegador. Essa limpeza é destrutiva para os dados da base E2E: mantenha-a exclusiva para testes e para um processo/job por vez.

Instale o Chromium do Playwright uma vez por máquina:

```bash
npm exec -- playwright install chromium
```

Os testes E2E completos já cobrem bootstrap/login, configuração administrativa, catálogo, abertura e consulta das próprias solicitações, atendimento, conclusão e negações críticas para acesso a solicitação alheia ou de outro setor.

O E2E de documentos (`tests/e2e/request-documents.spec.ts`) usa só arquivos sintéticos e guarda os anexos na memória do servidor de teste (`TEST_DOCUMENT_STORAGE=memory`, definido em `playwright.config.ts`). Essa opção só é aceita fora de produção e com um `DATABASE_URL` cujo banco termine em `_test`. Nenhum teste usa o bucket de produção.

## Verificações

```bash
npm run typecheck
npm run lint
npm run build
```

Para servir a versão compilada, execute `npm run start` após o build.

## Métricas do projeto

> Medição atual: a partir de 2026-10-29, a meta é medida em linhas `added` contra a tag `baseline-ap2` com `sh scripts/cloc-diff.sh` (`SPEC/2026-10-29-plano-escala-100k.md`). O valor de cada tarefa fica registrado em `NOTES.md`. A tabela abaixo é o registro histórico da medição anterior.

Medição oficial executada em 2026-10-06 com `cloc`, usando `--vcs=git` e as exclusões documentadas:

| Métrica | Resultado |
| --- | ---: |
| Linhas de código contabilizadas | 8.903 |
| TypeScript | 7.887 |
| CSS | 817 |
| SQL | 97 |
| Prisma Schema | 94 |
| JavaScript | 8 |
| Testes unitários | 79 aprovados |
| Testes de integração | 68 declarados; 61 passaram na última execução anterior à SF-029 e 7 casos novos de autogerenciamento não foram executados. A execução atual está bloqueada por `EPERM` no `prisma generate` e indisponibilidade de conexão ao `TEST_DATABASE_URL`. |
| Testes E2E | 1 cenário aprovado na execução registrada da SF-028; não reexecutado nesta etapa. |
| SPECs principais | 2 |
| Tarefas registradas no `TASKS.md` | 29 |

A meta acadêmica é 100.000 linhas. A contagem atual está 91.097 linhas abaixo da meta, portanto SF-026 permanece incompleta. A medição usa somente arquivos rastreados pelo Git devido a `--vcs=git`; documentação e prompts estão excluídos. Não se deve criar código artificial nem implementar itens fora da SPEC para alterar a contagem.

O progresso e as validações por tarefa são registrados em `TASKS.md`, `NOTES.md` e `diario/`. Qualquer ampliação funcional exige aprovação explícita e uma nova SPEC.
