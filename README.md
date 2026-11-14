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

- Node.js 24, a mesma versão em todos os ambientes (decidido em 2026-11-06): `engines` `"24.x"` no `package.json` (a Vercel usa esse campo), Volta `24.22.2` na máquina e `node-version: "24"` no CI. Diferenças de versão já esconderam um defeito (veja o `NOTES.md`).
- npm 11.

Essas versões foram usadas nas validações do projeto. A stack inclui Next.js 16.3.8, React 19.2.8, TypeScript 5, PostgreSQL com Prisma 6.16.0, Auth.js com Argon2id, Vitest e Playwright com Chromium.

## Desenvolvimento

Instale as dependências e inicie o servidor:

```bash
npm ci
npx prisma generate
npm run dev
```

A aplicação fica disponível publicamente em:

**[Acessar o ServiceFlow](https://serviceflow-sand.vercel.app/)**

Não há tela de login: a página inicial mostra a escolha de perfil (Administrador, Solicitante, Atendente ou Gestor), que entra como uma pessoa fictícia, sem e-mail nem senha (`SPEC/2026-09-30-catalogo-e-solicitacoes.md`, seções 24 e 25):

| Botão | Pessoa |
|---|---|
| Administrador | Marina Alves |
| Solicitante | Ana Souza |
| Atendente | Diego Rocha, da Central de Serviços |
| Gestor | Paulo Ribeiro, gestor da Central de Serviços |

No primeiro clique, se o banco ainda não tiver os dados fictícios, eles são carregados: catálogo, as pessoas acima e os solicitantes Bruno Lima e Carla Mendes, e 14 solicitações em todos os status, com responsável, prazos (dentro, próximo e vencido), aprovação pendente, aprovada e rejeitada, comentários, nota interna e notificações. Os cliques seguintes não carregam de novo nem desfazem mudanças da administração. `npm run seed:demo` carrega os mesmos dados. As pessoas fictícias não têm senha utilizável; a página "Alterar senha" fica como representação didática. O endereço antigo `/login` leva à página inicial.

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

A política está em `SPEC/2026-11-02-backup-recuperacao.md`: cópia lógica completa (`pg_dump`) **toda semana e antes de cada migration ou deploy**, guardando as 4 últimas semanais e as de deploy por 30 dias, cifradas e fora do repositório (contêm dados pessoais); perda máxima aceita de 7 dias e recuperação em até 2 horas; teste de restauração a cada 3 meses num banco isolado. O histórico nativo do Neon no plano gratuito cobre só cerca de 6 horas e não substitui as cópias. Os comandos de cópia e restauração estão na seção 4 da SPEC. Arquivos `*.dump` são ignorados pelo Git.

### Notificações por e-mail

O envio usa a API HTTP da Resend, sem dependência nova (SPEC de e-mail, seção 5.3). Configure no ambiente do servidor, sem prefixo `NEXT_PUBLIC_`:

```env
EMAIL_API_KEY=<chave da API do provedor>
EMAIL_FROM=ServiceFlow <avisos@seu-dominio.example>
APP_BASE_URL=https://<endereço público do ServiceFlow>
```

- Sem as três variáveis (ou com alguma inválida), nada é enviado: os envios ficam como "não enviado — e-mail não configurado" e a seção "E-mails" da administração avisa quais variáveis faltam, sem mostrar valores. É assim no desenvolvimento e nos testes.
- O remetente precisa usar um domínio verificado na conta do provedor.
- Na Vercel, cadastre `EMAIL_API_KEY` como variável **Secret**. Nunca versione a chave.

### Webhooks

Os segredos de assinatura dos webhooks ficam cifrados com uma chave que existe só no ambiente do servidor (`SPEC/2026-11-02-api-externa-webhooks.md`, seção 5.6):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```env
WEBHOOK_ENCRYPTION_KEY=<32 bytes em base64>
```

- Sem a chave, a seção "Webhooks" avisa que não está configurada e nada é cadastrado nem enviado.
- Trocar a chave deixa os segredos já guardados ilegíveis: gere um novo segredo em cada webhook.
- Na Vercel, cadastre a chave como **Secret**. `WEBHOOK_ALLOW_LOCAL=true` só serve aos testes (aceita receptores em `localhost`) e é ignorada em produção.

## API externa

Outros sistemas usam a API `/api/v1` com um **token pessoal** (`SPEC/2026-11-02-api-externa-webhooks.md`). Cada chamada age com o perfil, o setor e as permissões de quem criou o token, com as mesmas regras da tela.

1. Entre como solicitante, atendente ou gestor e abra **Acesso à API** no menu.
2. Escolha nome, escopo ("Somente leitura" ou "Leitura e escrita") e validade (30, 90 ou 365 dias) e clique em **Criar token**. O valor (`sf_...`) aparece **uma única vez**: guarde-o como uma senha. O banco guarda só o hash.
3. Chame a API com o cabeçalho `Authorization`:

```bash
curl -H "Authorization: Bearer sf_..." https://<endereço>/api/v1/me
curl -H "Authorization: Bearer sf_..." "https://<endereço>/api/v1/requests?status=OPEN"
curl -X POST -H "Authorization: Bearer sf_..." -H "Content-Type: application/json" \
  -d '{"serviceId":"<id do serviço>","description":"Cadeira quebrada na sala 3"}' \
  https://<endereço>/api/v1/requests
```

- Rotas: `GET /api/v1/me`, `GET /api/v1/services` (solicitante), `GET /api/v1/requests`, `POST /api/v1/requests` (solicitante, sem anexos), `GET /api/v1/requests/{id}`, `POST /api/v1/requests/{id}/comments`. A descrição completa, com formatos e erros, está em `GET /api/v1/openapi.json` (público).
- Ações de atendimento (`SPEC/2026-11-03-api-acoes-webhooks-setor.md`), todas `POST` com token de escopo `WRITE`, com as mesmas regras da tela, o mesmo histórico e os mesmos eventos, e resposta com o detalhe atualizado:
  - `/api/v1/requests/{id}/assume`, `/start` e `/complete` (atendente do setor; corpo vazio ou `{}`);
  - `/release` (o responsável, ou quem supervisiona a fila) e `/transfer` com `{"assigneeId"}`; os colegas aceitos estão em `GET /api/v1/requests/{id}/transfer-candidates`;
  - `/cancel` com `{"note"}` opcional para o solicitante e obrigatório para o atendente; `/reopen` com `{"note"}` (solicitante, até 7 dias após a conclusão).
  - `/transfer-sector` com `{"sectorId", "note"}` encaminha a solicitação aberta para outro setor (`SPEC/2026-11-03-transferencia-entre-setores.md`); os setores aceitos estão em `GET /api/v1/requests/{id}/sector-candidates`. Como quem encaminha deixa de ver a solicitação, a resposta é só `{"id", "sectorId"}`.
  - `/pause-sla` com `{"reason"}` pausa o prazo "aguardando o solicitante" e `/resume-sla` com `{}` retoma (`SPEC/2026-11-03-pausa-sla-calendario.md`); o detalhe traz `slaBusinessHours`, `slaPausedAt` e `history.pauses`, e a situação `paused`.
  - Fora do estado certo (por exemplo, iniciar com aprovação pendente ou liberar sem ser o responsável), a resposta é `409 conflict`; sem motivo obrigatório, `400`.

  ```bash
  curl -X POST -H "Authorization: Bearer sf_..." https://<endereço>/api/v1/requests/<id>/assume
  curl -X POST -H "Authorization: Bearer sf_..." -H "Content-Type: application/json"     -d '{"note":"Peça trocada"}' https://<endereço>/api/v1/requests/<id>/cancel
  ```
- Erros sempre no formato `{"error": {"code", "message"}}`: `401 invalid_token`, `403 forbidden` ou `insufficient_scope`, `404 not_found` (também para o que a pessoa não pode ler), `422 documents_required` (serviço com documento obrigatório) e `429 rate_limited` com `Retry-After`. Limite de 60 chamadas por minuto por token; até 10 tokens ativos por pessoa.
- A pessoa revoga os próprios tokens na mesma página; o administrador vê e revoga todos em **Administração → Acesso à API**. A revogação vale na chamada seguinte.

### Assistentes de IA (MCP)

Um assistente compatível com MCP (Claude Code, Claude Desktop e outros) pode procurar solicitações e ler os documentos e arquivos de comentário que a pessoa já vê na tela (`SPEC/2026-11-05-mcp-documentos.md`). O servidor MCP fica em `POST /api/mcp` (Streamable HTTP, só JSON, sem sessão) e usa o **mesmo token** da API: um token "Somente leitura" basta, e as chamadas contam no mesmo limite de 60 por minuto.

```bash
claude mcp add --transport http serviceflow https://<endereço>/api/mcp \
  --header "Authorization: Bearer sf_..."
```

- Ferramentas, todas só de leitura: `find_requests` (mesma lista da `GET /api/v1/requests`), `list_request_documents`, `read_request_document` e `read_comment_file`. TXT volta como texto; PDF e DOCX voltam em base64 com o tipo detectado.
- As regras são as da tela: o solicitante lê as próprias solicitações, o atendente as do setor atual e o gestor as aprovações do setor (ou todas do setor, com a permissão). Notas internas não aparecem para o solicitante, e o gestor não vê arquivos de comentário. O que a pessoa não pode ver responde "Not found.", igual a um id que não existe.
- Versões do protocolo: a revisão `2026-07-28` (sem `initialize`) e clientes que abrem com `initialize` (`2025-03-26`, `2025-06-18` e `2025-11-25`).
- A tela **Acesso à API** mostra o endereço certo do ambiente e o comando acima. O assistente lê tudo o que a pessoa lê, então revogue o token quando deixar de usá-lo.

### Webhooks de saída

Em **Administração → Webhooks**, o administrador cadastra um endereço `https` público e os eventos (solicitação aberta, mudança de status, de responsável, de prioridade ou de etapa, comentário, prazos e decisão de aprovação). O **segredo** (`whsec_...`) aparece uma única vez; "Gerar novo segredo" troca o segredo na hora.

Cada evento chega como `POST` com corpo JSON `{"id", "type", "occurredAt", "requestId", "data"}`, só com identificadores e códigos (nunca descrições, comentários, nomes ou e-mails), e com os cabeçalhos `ServiceFlow-Event`, `ServiceFlow-Delivery` (igual em todas as tentativas) e `ServiceFlow-Signature: t=<segundos>,v1=<hex>`. Para conferir a assinatura no sistema que recebe:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

// rawBody: o corpo exatamente como chegou, antes de qualquer JSON.parse.
function isFromServiceFlow(signatureHeader, rawBody, secret, maxAgeSeconds = 300) {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signatureHeader ?? "");
  if (!match) return false;
  const [, timestamp, received] = match;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > maxAgeSeconds) return false; // evita reenvio antigo
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
```

- Responda com qualquer status 2xx. Outras respostas, redirecionamentos (não seguidos), falta de resposta em 10 s ou endereço que resolve para rede interna contam como falha; há novas tentativas depois de 1 min, 5 min, 30 min, 2 h e 12 h, e a entrega desiste na sexta falha. Como a mesma entrega pode chegar mais de uma vez, use `ServiceFlow-Delivery` para ignorar repetições.
- **Setores:** marque setores no cadastro ou na edição para receber só eventos de solicitações desses setores; sem nenhum marcado, o webhook recebe de todos (`SPEC/2026-11-03-api-acoes-webhooks-setor.md`). A mudança entra na auditoria com os nomes dos setores.
- A seção mostra as 50 entregas mais recentes, sem o corpo. Desativar um webhook cancela as entregas pendentes dele.
- **Reenviar:** uma entrega que falhou ou foi cancelada, de webhook ativo, pode ser reenviada pelo botão "Reenviar": volta para a fila com as tentativas zeradas e sai logo em seguida, com o mesmo `ServiceFlow-Delivery` e o mesmo corpo.

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
- Calendário e pausa do prazo (`SPEC/2026-11-03-pausa-sla-calendario.md`): na administração, "Calendário" define os dias e o horário de expediente (uma janela por dia), o fuso e os feriados (simples ou repetidos todo ano), com auditoria. Cada serviço com prazo escolhe a "Contagem do prazo": horas corridas (padrão, como antes) ou horas úteis, que só contam dentro do expediente e fora dos feriados; a solicitação guarda a escolha da abertura, e mudar o calendário não recalcula vencimentos já gravados. Em atendimento, o responsável (ou quem supervisiona a fila; sem responsável, qualquer atendente do setor) pode pausar o prazo "aguardando o solicitante", com motivo, se ainda não venceu: o solicitante é avisado e vê o motivo, e o prazo volta a contar quando ele comenta, envia um documento que falta, quando a equipe retoma ou quando a solicitação é concluída ou cancelada. O tempo pausado não conta. Enquanto pausada, a situação é "Prazo pausado" (filtro próprio na fila e contagem no painel) e não há alertas. Liberar a solicitação não encerra a pausa.
- Campos personalizados (`SPEC/2026-11-01-campos-personalizados.md`): o administrador define, por serviço, até 10 campos que o solicitante preenche ao abrir a solicitação — texto curto, texto longo, número inteiro (com mínimo e máximo opcionais), data, lista de opções e sim ou não, cada um obrigatório ou opcional e com texto de ajuda. Os campos podem ser editados, reordenados, desativados e reativados; o tipo não muda depois de criado. O servidor confere as respostas com a configuração do momento do envio; numa recusa, o erro aparece junto do campo e a descrição e as respostas continuam preenchidas (arquivos precisam ser anexados de novo). As respostas guardam o rótulo da abertura, não podem ser editadas e aparecem nos detalhes para o solicitante e os atendentes do setor. Serviço sem campos funciona como antes; o banco fictício traz um exemplo em "Manutenção de ar-condicionado".
- Campos condicionais, seleção múltipla e campos do atendimento (`SPEC/2026-11-03-campos-condicionais-atendimento.md`): o tipo "Seleção múltipla" mostra uma caixa por opção e guarda as marcadas na ordem configurada. Um campo pode ter "Mostrar só quando" outro campo de escolha (lista, sim ou não ou seleção múltipla) tiver um valor: ele aparece e passa a ser exigido só nessa situação, e o que for digitado nele com a condição não atendida é descartado. O administrador não consegue desativar um campo usado numa condição, nem remover a opção usada. Em "Quem preenche", um campo pode ser do "Atendimento": não aparece para o solicitante; a equipe do setor preenche e altera no bloco "Informações do atendimento" da fila, cada gravação entra no histórico só com os rótulos, e os obrigatórios precisam estar preenchidos para concluir. Só a equipe vê essas informações (tela, API e "Meus dados"); na API, a abertura aceita lista na seleção múltipla e as respostas trazem `audience`.
- Fluxos configuráveis (`SPEC/2026-11-01-fluxos-configuraveis.md`): o administrador define, por serviço, até 8 etapas do atendimento (criar, renomear, reordenar, desativar e reativar). As etapas existem dentro de "Em atendimento": ao iniciar, a solicitação guarda uma cópia das etapas ativas e entra na primeira; o atendente do setor (o responsável, se houver) avança uma etapa por vez ou volta uma etapa com justificativa, e só conclui na última. Mudar o fluxo não altera solicitações em andamento; a reabertura limpa as etapas e o novo início usa o fluxo vigente. A etapa aparece nos detalhes, na fila e em "Minhas solicitações", as mudanças entram no histórico e o solicitante é notificado a cada uma. Serviço sem etapas funciona como antes.
- Aprovações (`SPEC/2026-11-01-aprovacoes.md`): novo perfil **Gestor**, ligado a um setor (cadastro pela administração; botão "Entrar como Gestor", que entra como Paulo Ribeiro). Um serviço pode exigir aprovação do gestor: a solicitação nasce "Aberta" com a aprovação pendente, sem prazo de SLA, e ninguém inicia o atendimento antes da decisão. Qualquer gestor ativo do setor decide uma vez, na área "Aprovações": aprovar (observação opcional) libera o atendimento e o prazo passa a contar da aprovação; rejeitar (observação obrigatória) cancela a solicitação. Os gestores são avisados na abertura e o solicitante, da decisão; a situação da aprovação aparece para solicitante e atendente e a decisão entra no histórico. O gestor vê só as solicitações do seu setor que exigem aprovação, só para leitura. Serviço sem aprovação funciona como antes.
- Permissões configuráveis (`SPEC/2026-11-01-permissoes-configuraveis.md`): na seção de usuários da administração, o administrador concede e revoga, por usuário, permissões adicionais que valem no setor atual da pessoa: **Gerir serviços do setor** (atendente ou gestor; página "Serviços do setor" para criar e editar serviços do próprio setor, com documentos, campos e etapas), **Ver todas as solicitações do setor** (gestor; aba "Todas do setor", só leitura) e **Supervisionar a fila do setor** (atendente; libera ou transfere solicitações que estão com colegas). Concessões e revogações ficam no histórico do usuário; a revogação vale na operação seguinte, sem novo login. Permissões que deixam de valer por mudança de perfil aparecem marcadas "sem efeito". Sem permissões concedidas, tudo funciona como antes.
- Notificações por e-mail (`SPEC/2026-11-01-notificacoes-email-preferencias.md`): solicitante, atendente e gestor escolhem em "Preferências de e-mail" (link na página de notificações) quais categorias também querem receber por e-mail — mudanças de status, transferências, comentários e notas internas, prazos, etapas e aprovações. Tudo começa desligado e as notificações dentro do sistema continuam sempre ativas. Cada notificação de uma categoria ligada gera um envio, processado depois da ação e pelo job diário, com novas tentativas em caso de falha. O e-mail traz só o aviso, o serviço, um código curto e o link para a solicitação, nunca a descrição, comentários ou documentos. Na seção "E-mails" da administração, o administrador vê se o envio está configurado e os 50 envios mais recentes, sem o conteúdo.
- Painel e relatórios (`SPEC/2026-11-02-painel-relatorios.md`): o administrador abre a seção "Painel" da administração (toda a organização ou um setor) e o gestor abre "Painel do setor" (só o próprio setor). O painel mostra a situação atual (abertas, aguardando aprovação, em atendimento, próximas do vencimento e vencidas) e, no período escolhido (últimos 7, 30 ou 90 dias ou um intervalo de até 366 dias, contados no horário de Brasília), as solicitações abertas, concluídas e canceladas, o tempo médio e a mediana até a conclusão, o percentual concluído no prazo e a distribuição por categoria, setor e status, em barras. "Exportar CSV" (`/api/reports/requests.csv`) baixa as solicitações abertas no período, com colunas mínimas (sem descrição, comentários nem dados do solicitante), até 10.000 linhas, separadas por `;` e prontas para planilhas. O painel não tem links para solicitações: as regras de leitura de cada uma não mudam. Os números são calculados a cada visita, sem tabela nova.
- Análises operacionais (`SPEC/2026-11-06-analises-operacionais.md`): o atendente abre "Meu painel" (`/queue/dashboard`) com a fila do setor em números (sem responsável, comigo, próximas do vencimento, vencidas, pausadas, por prioridade e por etapa) e o próprio resultado no período ao lado do total do setor, sem números de colegas. O gestor abre "Análises" (`/approvals/analytics`, só o próprio setor) e o administrador a seção "Análises" (organização ou um setor) com: tendências por dia ou semana (abertas × concluídas, pendentes ao fim de cada intervalo e % no prazo, em gráficos SVG sem biblioteca, cada um com tabela); SLA e tempos (primeira resposta, tempo por etapa, pausas, % no prazo por serviço e por prioridade com "poucos dados", e a grade dia × hora de chegada); e o desempenho da equipe (concluídas, tempo médio, % no prazo e pendentes por atendente, em ordem alfabética e com um aviso sobre o uso dos números). Tudo é calculado a cada visita, sem tabela nova; nenhuma tela tem link para solicitações.
- Pesquisa de satisfação (`SPEC/2026-11-06-pesquisa-satisfacao.md`): o solicitante dá nota de 1 a 5, com comentário opcional, até 30 dias depois da conclusão (uma por conclusão; reconcluída, pode avaliar de novo). A equipe e o gestor veem a nota na solicitação; "Análises" mostra média, distribuição, taxa de resposta e média por serviço; "Meus dados" inclui a avaliação e a anonimização troca o comentário.
- Respostas prontas (`SPEC/2026-11-06-respostas-prontas.md`): os atendentes mantêm em "Respostas prontas" os textos do setor; no comentário da fila, "Inserir resposta pronta" acrescenta o texto com `{{solicitante}}`, `{{servico}}`, `{{codigo}}` e `{{atendente}}` já substituídos, sem enviar.
- Escalonamento de vencidas (`SPEC/2026-11-06-escalonamento.md`): em "Setores", o administrador liga "Escalar solicitações vencidas"; no alerta de vencimento do job diário, a prioridade sobe um nível (o vencimento não muda) e os gestores do setor são avisados. O detalhe mostra os escalonamentos e "Análises" conta as escaladas.
- Base de conhecimento (`SPEC/2026-11-06-base-conhecimento.md`): o administrador (seção "Base de conhecimento") e quem tem "Gerir serviços do setor" escrevem artigos por serviço, que nascem como rascunho; publicados, aparecem na página do serviço em "Antes de abrir, veja se isto resolve".
- Auditoria e dados pessoais (`SPEC/2026-11-02-auditoria-lgpd.md`): cada criação, alteração, reordenação, desativação e reativação de usuários, setores, categorias, serviços, documentos exigidos, campos e etapas fica registrada na mesma transação, com quem fez, o perfil e os campos alterados (nome e e-mail de pessoas só como "alterado"; senhas nunca). A seção "Auditoria" da administração, só para o administrador, lista esses registros junto com as concessões e revogações de permissões, 50 por página, com filtros por período, tipo e pessoa. O job diário aplica os prazos de guarda: eventos processados 30 dias, notificações lidas 90, não lidas 365, envios de e-mail 180 e auditoria 5 anos; solicitações e histórico não têm prazo automático. Em "Meus dados" (`/account/data`, link no menu de todos os perfis), cada pessoa baixa um JSON com os próprios dados, sem senha nem notas internas de outras pessoas, e o download entra na auditoria. O administrador pode **anonimizar** uma pessoa desativada que não tenha solicitação aberta ou em atendimento: com confirmação explícita e de forma irreversível, nome e e-mail viram "Pessoa anonimizada <código>", a conta deixa de entrar, os textos que ela escreveu viram "[conteúdo removido na anonimização]", os anexos que enviou são apagados do armazenamento ("Arquivo removido na anonimização") e saem as preferências, notificações, envios de e-mail e permissões. As solicitações, o histórico e os números do painel continuam. Esta organização dos dados não substitui a orientação jurídica da organização.
- API externa e webhooks (`SPEC/2026-11-02-api-externa-webhooks.md`): tokens pessoais de solicitante, atendente e gestor, com escopo e validade, usados pela API `/api/v1` com as mesmas regras da tela; webhooks cadastrados pelo administrador, com entregas assinadas e novas tentativas. Tokens e mudanças de webhook entram na auditoria sem valor nem segredo; "Meus dados" lista os tokens; anonimizar revoga os tokens; o job diário apaga entregas encerradas há mais de 30 dias e tokens encerrados há mais de 365. Detalhes nas seções "API externa" e "Webhooks" acima.
- Anexos em comentários e documentos depois da abertura (`SPEC/2026-11-03-anexos-comentarios-documentos.md`): solicitante e atendentes anexam até 3 arquivos PDF, DOCX ou TXT a um comentário (2 MiB cada, 4 MiB somados, até 30 por solicitação), com o formato conferido pelo conteúdo, como nos documentos de abertura. O arquivo segue a visibilidade do comentário: o de uma nota interna só a equipe vê e baixa. O solicitante envia depois da abertura um documento do serviço que ainda falta (opcional deixado para depois ou exigência acrescentada), enquanto a solicitação está aberta ou em atendimento; ele entra na lista de documentos e no histórico, e o responsável é notificado. Os arquivos ficam no mesmo armazenamento privado dos documentos: em produção dependem da configuração do Supabase (SF-030); sem ela, comentários sem arquivo continuam funcionando e o envio de arquivo é recusado com aviso.
- Encaminhamento entre setores (`SPEC/2026-11-03-transferencia-entre-setores.md`): na página da solicitação na fila, o atendente do setor (o responsável, se houver, ou quem supervisiona a fila) encaminha uma solicitação **aberta** e sem aprovação pendente para outro setor ativo que tenha atendente ativo, com justificativa obrigatória. O responsável sai; status, prioridade, prazo, respostas, documentos e comentários continuam. O novo setor passa a vê-la na fila com todo o histórico, inclusive as notas internas, e o setor anterior deixa de vê-la. O histórico mostra "Encaminhada do setor X para o setor Y" com a justificativa; os atendentes do novo setor e o solicitante são notificados; o evento "Mudança de setor" chega aos webhooks sem filtro e aos filtrados pela origem ou pelo destino. Como a demonstração tem um setor só, para mostrar o encaminhamento o administrador cria antes um segundo setor com um atendente.
- Ações pela API e webhooks por setor (`SPEC/2026-11-03-api-acoes-webhooks-setor.md`): assumir, liberar, transferir, iniciar, concluir, cancelar e reabrir pela API; filtro de setores e reenvio de entregas nos webhooks.
- Ferramentas MCP de documentos (`SPEC/2026-11-05-mcp-documentos.md`): servidor MCP em `/api/mcp`, com o token da API, para assistentes de IA procurarem solicitações e lerem documentos e arquivos de comentário com as mesmas regras da tela. Detalhes na seção "Assistentes de IA (MCP)" acima.
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
