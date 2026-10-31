# SPEC — Comentários e conversas nas solicitações

**Data:** 2026-10-31
**Status:** Aprovada em 2026-10-31, com as decisões C1 a C3 da seção 11 conforme propostas
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-09-30-visao-geral.md` (§6), `SPEC/2026-09-30-catalogo-e-solicitacoes.md` (seções 5, 10 e 19), `SPEC/2026-10-29-plano-escala-100k.md` (item 4), `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md`

## 1. Objetivo

Permitir que solicitante e atendentes troquem mensagens dentro da solicitação, para pedir e dar informações sem sair do sistema, com registro de autor e horário.

## 2. Registro da mudança de escopo

"Comentários ou conversas" estavam fora da primeira entrega (seções 5 e 19 da SPEC principal). O item 4 do plano de escala foi aceito em 2026-10-29, condicionado a esta SPEC. Esta SPEC autoriza comentários **em texto**. Anexos em comentários continuam fora (dependem do armazenamento, SF-030).

## 3. Escopo

1. Escrever comentário em uma solicitação.
2. Ler a conversa de uma solicitação, em ordem cronológica.
3. Nota interna, visível só a atendentes **(decisão C3)**.
4. Indicação de comentários na fila do atendente e na lista do solicitante (quantidade).

## 4. Fora de escopo

- Anexos em comentários; formatação rica (Markdown, HTML), menções e reações.
- Notificações de novo comentário (item 10 do plano).
- Busca em comentários (item 13).
- Acesso do administrador (continua negado, seção 10 da SPEC principal).

## 5. Regras

### 5.1 Quem comenta e quem lê

| Perfil | Ler conversa | Comentar | Nota interna |
|---|---|---|---|
| Solicitante dono | Sim, exceto notas internas | Sim | Não vê, não escreve |
| Atendente ativo do setor atual da solicitação | Sim, inclusive notas internas | Sim | Sim |
| Administrador, outro solicitante, atendente de outro setor, inativo, não autenticado | Não ("não encontrado") | Não | Não |

O atendente comenta mesmo sem ser o responsável: a conversa é do setor.

### 5.2 Quando **(decisão C1)**

- Comentários são aceitos em `OPEN`, `IN_PROGRESS` e `COMPLETED`.
- Em `CANCELLED` a conversa fica só para leitura.

### 5.3 Conteúdo

- Texto de 1 a 5.000 caracteres, sem espaços periféricos, guardado e exibido como texto puro (sem interpretar HTML).
- Autor, data e hora vêm da sessão e do relógio do banco; o cliente não define autor, horário nem visibilidade de outro tipo além de "nota interna", e só atendentes podem marcá-la.

### 5.4 Imutabilidade **(decisão C2)**

- Comentários não podem ser editados nem apagados pela aplicação. Correções são feitas com um novo comentário.

### 5.5 Exibição

- Seção "Conversa" no detalhe do solicitante e do atendente, separada do histórico, com autor, perfil (solicitante ou atendente), data e hora.
- Nota interna aparece destacada como "Nota interna (só atendentes)".
- Fila e lista mostram a quantidade de comentários visíveis ao leitor.

## 6. Dados (migration somente aditiva)

- Nova tabela `RequestComment`: `id`, `requestId` (FK `RESTRICT`), `authorId` (FK `RESTRICT`), `body` (texto, `CHECK` de 1 a 5.000 caracteres e sem espaços periféricos), `isInternal` (booleano, padrão falso), `createdAt` (timestamptz).
- Índice em `(requestId, createdAt)`.
- Nenhuma tabela existente é alterada.

## 7. Arquitetura

Novo módulo `src/modules/comments` com `domain` (regras 5.1 a 5.4), `application` (escrever e listar), `infrastructure` (Prisma) e `index.ts`; telas nos detalhes existentes. O módulo usa a API pública de `requests` só para ler o escopo da solicitação.

## 8. Critérios de aceitação

- [ ] **CA-COM-01** — O solicitante dono e um atendente ativo do setor escrevem comentários; cada comentário guarda autor, texto e horário do banco.
- [ ] **CA-COM-02** — A conversa aparece em ordem cronológica nos dois detalhes.
- [ ] **CA-COM-03** — Texto vazio, só com espaços ou acima de 5.000 caracteres é rejeitado no servidor sem gravar nada.
- [ ] **CA-COM-04** — Em solicitação cancelada, comentar é rejeitado; a leitura continua.
- [ ] **CA-COM-05** — Nota interna: só atendentes criam; o solicitante não a vê em nenhuma tela nem resposta; a contagem do solicitante não a inclui.
- [ ] **CA-COM-06** — Administrador, outro solicitante, atendente de outro setor, inativo e não autenticado não leem nem escrevem, sem revelar a solicitação.
- [ ] **CA-COM-07** — Campos forjados (autor, horário, `isInternal` vindo do solicitante, outro `requestId` no corpo) são rejeitados ou ignorados conforme a regra 5.3.
- [ ] **CA-COM-08** — Texto com HTML ou script aparece como texto, sem ser interpretado.
- [x] **CA-COM-09** — Migration aditiva; todas as suítes anteriores passam sem alteração de asserções. *Verificado em 2026-10-31 (SF-053): migration aditiva aplicada no banco de teste com dados existentes; `request-comment-schema.test.ts`; suítes anteriores sem alteração de asserções.*

## 9. Estratégia de testes

- **Unitários:** regras de permissão, estado e nota interna; normalização do texto; casos de uso com repositório em memória.
- **Integração:** gravação e leitura com o PostgreSQL de teste; `CHECK` do texto; matriz de autorização; filtro de notas internas.
- **E2E:** solicitante pergunta, atendente responde e escreve nota interna; o solicitante vê a resposta e não vê a nota; em solicitação cancelada não há campo de comentário.

## 10. Tarefas (registradas em `TASKS.md`)

| Tarefa | Conteúdo |
|---|---|
| SF-053 | Migration e domínio dos comentários |
| SF-054 | Escrever e ler comentários (casos de uso, repositório, telas) |
| SF-055 | Notas internas e contagem nas listas |
| SF-056 | E2E e revisão |

## 11. Decisões tomadas (2026-10-31)

Decisões da responsável pelo projeto: **todas as propostas aceitas**.

| # | Questão | Decisão | Alternativa descartada |
|---|---|---|---|
| C1 | Estados que aceitam comentário | `OPEN`, `IN_PROGRESS` e `COMPLETED`; cancelada só leitura | Só `OPEN` e `IN_PROGRESS` |
| C2 | Editar ou apagar | Não; comentários são imutáveis | Editar nos primeiros 5 minutos |
| C3 | Nota interna (só atendentes) | Sim | Não; toda mensagem é vista pelo solicitante |
