# Sessão SF-030 — Confirmação do armazenamento de documentos — 2026-10-16

## Solicitação

> Vamos continuar o projeto ServiceFlow. Execute SOMENTE a tarefa SF-030, conforme `TASKS.md`.
>
> Antes de começar, leia: `AGENTS.md`; a seção 21 da SPEC principal; as tarefas SF-030 a SF-036 em `TASKS.md`; `NOTES.md`; as decisões anteriores sobre documentos por serviço.
>
> **Objetivo desta etapa:** confirmar a arquitetura de armazenamento de documentos e os requisitos técnicos e de segurança antes de implementar uploads.
>
> 1. Consulte a documentação oficial atual da Vercel e do Supabase.
> 2. Confirme o limite de tamanho das requisições das Vercel Functions e como isso afeta uploads de arquivos.
> 3. Avalie o uso de um bucket privado do Supabase Storage.
> 4. Defina um fluxo seguro de upload, validação, persistência e download, incluindo como lidar com arquivos enviados quando a criação da solicitação falhar.
> 5. Preserve os requisitos já aprovados: PDF, DOCX e TXT; até 2 MiB por arquivo; até 4 MiB por solicitação; máximo de 5 arquivos; validação do conteúdo real, além da extensão e do MIME; autorização por sessão, perfil, propriedade e setor; nenhuma URL pública permanente; credenciais nunca expostas ao cliente; anexos protegidos e separados por ambiente.
> 6. Verifique se os limites precisam de algum ajuste técnico fundamentado. Não os altere sem registrar justificativa e manter a decisão rastreável.
> 7. Registre as decisões e fontes oficiais em `SPEC`, `NOTES.md`, `TASKS.md` e no diário, conforme as convenções do projeto.
>
> **Restrições:** nesta etapa, não implemente o upload; não altere código funcional, banco/schema, dependências ou configurações de ambiente; não crie credenciais nem grave segredos; não inicie SF-031 ou tarefas posteriores; não faça commit nem push; se alguma decisão não puder ser verificada, registre explicitamente a limitação.
>
> Ao terminar, informe a decisão arquitetural, os documentos alterados, as fontes oficiais consultadas e o estado da SF-030.

## Resultado

- Consultadas as páginas oficiais da Vercel (*Functions Limits*, guia do limite de 4,5 MB, variáveis Config/Secret), do Supabase (buckets, criação de buckets, limites, controle de acesso, serving de assets, chaves de API, API de Storage de self-hosting) e a documentação local do Next.js 16.3.8.
- Confirmado: corpo de requisição e de resposta das Vercel Functions limitado a 4,5 MB; Server Actions com 1 MB por padrão, contando o overhead multipart. Limites de anexos mantidos; `serverActions.bodySizeLimit` definido como 4,25 MiB para a SF-034.
- Decisão: bucket privado do Supabase Storage, chave secreta `sb_secret_` só no servidor, upload e download intermediados pela aplicação; upload direto e URL assinada rejeitados com justificativa. Produção em projeto Supabase exclusivo, porque a chave secreta acessa todos os buckets do projeto.
- Fluxos de upload, compensação, órfãos e download, nomes de buckets e de variáveis registrados na nova seção 21.15 da SPEC; ajustes em 21.6, 21.8 e 21.14; `NOTES.md`, `TASKS.md` e `diario/2026-10-16.md` atualizados.
- Limitações registradas: provisionamento não realizado; contas não inspecionadas; unidade de "4.5 MB" não definida; checagem de conteúdo do `allowedMimeTypes` não documentada; rota de remoção da API não confirmada.
- SF-030 parcialmente concluída (provisionamento pendente). Nenhum código, banco, dependência, configuração ou segredo alterado; nenhum teste executado; SF-031 não iniciada; sem commit/push.
