# Sessão — Alteração de SPEC: documentos exigidos por serviço — 2026-10-16

## Solicitação

> Nova funcionalidade do ServiceFlow: documentos exigidos por serviço, com foco inicial nos serviços de RH.
>
> ETAPA ATUAL: ALTERAR A SPEC E DOCUMENTAR A TAREFA. NÃO IMPLEMENTAR CÓDIGO NESTA ETAPA.
>
> 1. Leia AGENTS.md e a SPEC principal atual.
> 2. Registre a alteração de escopo na SPEC, com data e critérios de aceitação.
> 3. Atualize TASKS.md, NOTES.md e o diário do projeto.
> 4. Registre este prompt na pasta de sessões, seguindo o padrão existente.
>
> REQUISITOS FUNCIONAIS
>
> A. Configuração por serviço
> - O administrador poderá definir quais documentos são exigidos em cada serviço.
> - Cada requisito documental terá nome, indicação de obrigatório ou opcional e formatos aceitos entre PDF, DOCX e TXT.
> - A configuração será específica para cada serviço.
> - A ausência de requisitos documentais deverá permitir serviços sem anexos.
> - Não cadastrar setores ou serviços fixos no código de produção.
> - Não presumir que todos os serviços do RH exigem os mesmos documentos.
>
> B. Exemplos de documentos para configurar serviços de RH
> Registrar como exemplos configuráveis:
> - Férias: requerimento de férias e documento de autorização.
> - Declaração: solicitação da declaração e documento de identificação, quando necessário.
> - Alteração cadastral: formulário de alteração e comprovante relacionado ao dado alterado.
> - Escalas: documento da escala e formulário de solicitação de alteração.
> - Outros serviços: documentos definidos pelo administrador.
>
> Não fixar no código a obrigatoriedade desses exemplos. O administrador deverá poder definir quais são obrigatórios e quais são opcionais.
>
> C. Abertura de solicitação
> - Ao selecionar um serviço com requisitos documentais, o solicitante verá a lista de documentos solicitados.
> - Deverá ser possível anexar arquivos PDF, DOCX e TXT.
> - O servidor validará formatos, tamanho e requisitos antes de aceitar a solicitação.
> - A solicitação não poderá ser enviada se faltar algum documento obrigatório.
> - O serviço sem requisitos documentais continuará funcionando como atualmente.
>
> D. Atendimento pelo RH
> - Os anexos ficarão vinculados à solicitação.
> - O atendente autorizado poderá consultar e baixar os arquivos.
> - A autorização deverá ser verificada no servidor, incluindo a regra de setor.
> - Usuários não autorizados não poderão acessar os arquivos por URL direta.
> - A desativação ou alteração posterior do serviço não deverá apagar os documentos nem modificar o histórico das solicitações anteriores.
>
> E. Segurança e armazenamento
> - Analise a infraestrutura atual antes de propor o armazenamento.
> - Recomende uma solução privada compatível com o projeto publicado no Vercel.
> - Não armazenar o conteúdo dos arquivos em logs.
> - Validar o tipo real do arquivo, não apenas sua extensão ou o MIME informado.
> - Definir limites de tamanho e quantidade de arquivos com justificativa.
> - Registrar metadados necessários para associar cada documento à solicitação.
> - Não usar URLs públicas permanentes para documentos.
> - Não incluir dados pessoais ou documentos reais nas fixtures dos testes.
>
> F. Integração MCP
> - Não implementar MCP nesta etapa.
> - Registrar como requisito futuro que qualquer ferramenta MCP para consultar documentos deverá respeitar as mesmas permissões do ServiceFlow.
> - Não permitir que o MCP contorne a autorização por perfil, propriedade ou setor.
>
> REGRAS DO PROJETO
> - A SPEC é a fonte de verdade.
> - Registrar explicitamente que anexos estavam fora do escopo inicial e que esta alteração passa a autorizá-los.
> - Não alterar banco, código, dependências ou configuração nesta etapa.
> - Não fazer commit nem push.
>
> Ao finalizar, informe os arquivos documentais alterados e os critérios de aceitação adicionados.

## Resultado

- Atualizada `SPEC/2026-09-30-catalogo-e-solicitacoes.md`: seções 4, 5, 15, 16 e 19 ajustadas e nova seção 21 (alteração aprovada de 2026-10-16) com registro explícito de que anexos estavam fora do escopo inicial e passam a ser autorizados no recorte definido.
- Analisada a infraestrutura (Vercel, Supabase PostgreSQL, Prisma, Next.js 16 com limite padrão de 1 MB em Server Actions, sem armazenamento de arquivos). Recomendado bucket privado do Supabase Storage com acesso somente server-side e download por rota autorizada; alternativas registradas.
- Definidos limites (5 requisitos ativos por serviço, 1 arquivo por requisito, 2 MiB por arquivo, 4 MiB por solicitação) com justificativa no limite de corpo das funções do Vercel, ainda a reconfirmar na SF-030.
- Adicionados 22 critérios de aceitação (CA-DOC-01 a CA-DOC-22) e estratégia de testes; MCP registrado como requisito futuro.
- Atualizados `TASKS.md` (SF-030 a SF-036), `NOTES.md` e `diario/2026-10-16.md`.
- Nenhum código, banco, dependência ou configuração alterado; nenhum teste executado (etapa documental); sem commit/push.
