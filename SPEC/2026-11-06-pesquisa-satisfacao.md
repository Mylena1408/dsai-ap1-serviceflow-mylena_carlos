# SPEC — Pesquisa de satisfação depois da conclusão

**Data:** 2026-11-06
**Status:** Aprovada em 2026-11-06. A responsável aprovou "a leva recomendada" (satisfação, respostas prontas, escalonamento e base de conhecimento), nesta ordem. As decisões P1 a P7 da seção 10 foram adotadas como recomendadas; a responsável pode rever qualquer uma. **Concluída em 2026-11-06** (SF-150 e SF-151; CA-SAT-01 a 08 verificados).
**Projeto:** ServiceFlow
**Referências:**
- `SPEC/2026-10-31-atribuicao-cancelamento-reabertura.md`: conclusão e reabertura em até 7 dias.
- `SPEC/2026-11-06-analises-operacionais.md`: página "Análises".
- `SPEC/2026-11-02-auditoria-lgpd.md`: "Meus dados" e anonimização.

## 1. Objetivo

Saber, pela voz de quem pediu, se o atendimento resolveu: o solicitante dá uma **nota de 1 a 5** e, se quiser, um comentário curto sobre a solicitação concluída. A equipe do setor vê a avaliação na solicitação, e o gestor e o administrador acompanham os números em "Análises".

## 2. Escopo

1. Formulário "Como foi o atendimento?" no detalhe da solicitação **concluída**, só para o solicitante dono.
2. A avaliação aparece:
   - no detalhe da fila, para a equipe do setor;
   - no detalhe do gestor, quando ele pode ler a solicitação.
3. Bloco "Satisfação" em "Análises", com:
   - média;
   - distribuição das notas de 1 a 5;
   - taxa de resposta;
   - média por serviço.
4. "Meus dados" inclui as avaliações. A anonimização substitui o comentário.

## 3. Fora de escopo

- Nota por atendente: nem nas análises, nem na tabela da equipe **(decisão P5)**.
- Lembrete por e-mail ou notificação pedindo a avaliação.
- Avaliação pela API `/api/v1` e pelo MCP.
- Perguntas configuráveis: há uma pergunta só, fixa.

## 4. Regras

1. **Quem avalia:** o solicitante dono, ativo, de uma solicitação com status "Concluída" e concluída **há no máximo 30 dias**, contados pelo relógio do banco **(decisão P2)**.
2. **O que se grava** **(decisões P1 e P3)**:
   - **nota:** número inteiro de 1 a 5, obrigatório;
   - **comentário:** opcional, até 1.000 caracteres, sem quebra de regra de formato (texto simples);
   - a data e a conclusão a que a avaliação se refere (`completedAtSnapshot`).
3. **Uma avaliação por conclusão** **(decisão P4)**:
   - Enquanto a conclusão for a mesma, a avaliação não muda: o formulário dá lugar ao resultado ("Você avaliou com 4 de 5 em 06/11").
   - Se a solicitação for **reaberta** e **concluída de novo**, o solicitante pode avaliar outra vez, e a nova avaliação **substitui** a anterior. O histórico registra as duas.
4. **Recusas:**
   - solicitação de outra pessoa, inexistente ou não concluída: "não encontrada" ou conflito, como nas outras ações;
   - fora do prazo, ou nota já dada para esta conclusão: conflito, com a mensagem "Esta solicitação não pode mais ser avaliada";
   - nota fora de 1 a 5, ou comentário longo demais: erro de validação junto do campo.
5. **Histórico:** a avaliação entra no histórico da solicitação ("Avaliada com 4 de 5"), a partir da tabela própria de eventos de avaliação. Não há notificação, nem evento de domínio na fila de saída, nem webhook **(decisão P6)**.
6. **Quem lê:**
   - a equipe do setor atual, no detalhe da fila;
   - o gestor que pode ler a solicitação;
   - o próprio solicitante.

   O administrador vê só os números nas análises.
7. **Análises** (recorte e período da página "Análises"; período = data da avaliação) **(decisão P5)**:
   - média com uma casa decimal e quantidade de avaliações;
   - distribuição: quantas notas 1, 2, 3, 4 e 5, em barras;
   - **taxa de resposta:** avaliadas ÷ concluídas no período, em percentual;
   - média por serviço, com o aviso "poucos dados" abaixo de 3 avaliações.

   Os comentários não aparecem nas análises.
8. **LGPD:**
   - "Meus dados" lista, em cada solicitação, a nota, o comentário e a data.
   - A anonimização do solicitante troca o comentário pelo texto padrão de conteúdo removido; a nota continua, porque é um número sem dado pessoal **(decisão P7)**.

## 5. Dados

Migration **aditiva**: tabela `RequestSatisfaction`.

| Coluna | Tipo e regra |
|---|---|
| `id` | uuid |
| `requestId` | `uuid unique`, chave estrangeira para `Request` |
| `requesterId` | uuid, chave estrangeira para `User` |
| `rating` | `smallint`, com `CHECK (rating BETWEEN 1 AND 5)` |
| `comment` | `text` nulo, com `CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 1000)` |
| `completedAtSnapshot` | `timestamptz` |
| `ratedAt` | `timestamptz` |

Mais um índice por `ratedAt`.

Cada avaliação também grava uma linha em `RequestSatisfactionEvent`, com:
- `requestId`, `actorId`, `rating`, `occurredAt`;
- `replaced`, que diz se ela substituiu uma avaliação anterior.

O histórico vem dessa tabela, e ela não guarda o comentário.

## 6. Critérios de aceitação

- [x] **CA-SAT-01** — O solicitante dono avalia uma concluída com nota de 1 a 5 e comentário opcional. O resultado aparece no lugar do formulário e no histórico. *Verificado em 2026-11-06: unitários (regras e telas), integração (nota, comentário, histórico) e E2E (formulário dá lugar ao resultado).*
- [x] **CA-SAT-02** — São recusados:
  - outra pessoa;
  - solicitação não concluída;
  - mais de 30 dias depois da conclusão;
  - segunda avaliação da mesma conclusão;
  - nota fora de 1 a 5;
  - comentário com mais de 1.000 caracteres.

  Nada é gravado em nenhum desses casos. *Verificado em 2026-11-06: unitários do caso de uso e integração (outra pessoa, atendente, nota 7, comentário longo, 31 dias, em atendimento; nada gravado).*
- [x] **CA-SAT-03** — Depois de reabrir e concluir de novo, uma nova avaliação substitui a anterior, e o histórico mostra as duas. *Verificado em 2026-11-06: integração (nova conclusão: substitui e o histórico mostra 2 e 5).*
- [x] **CA-SAT-04** — A equipe do setor e o gestor que lê a solicitação veem a nota e o comentário. Um atendente de outro setor não vê. *Verificado em 2026-11-06: integração (atendente do setor e gestor com permissão leem; atendente de outro setor e administrador recebem "não encontrada") e E2E.*
- [x] **CA-SAT-05** — "Análises" mostra média, distribuição, taxa de resposta e média por serviço do recorte e do período, sem comentários e sem nota por pessoa. *Verificado em 2026-11-06: unitário do resumo e integração (média, distribuição, taxa de resposta, sem o comentário); E2E no gestor.*
- [x] **CA-SAT-06** — "Meus dados" traz as avaliações. A anonimização troca o comentário e mantém a nota. *Verificado em 2026-11-06: integração ("Meus dados" com nota e comentário; anonimização troca o comentário e mantém a nota).*
- [x] **CA-SAT-07** — O banco recusa nota fora de 1 a 5, comentário vazio ou longo demais, e uma segunda linha para a mesma solicitação. *Verificado em 2026-11-06: integração de schema (nota 0 e 6, comentário vazio e longo, segunda linha, evento com nota 9).*
- [x] **CA-SAT-08** — Nenhum evento de domínio, notificação ou webhook é gerado pela avaliação. Nenhuma dependência nova; a migration é aditiva. *Verificado em 2026-11-06: o código não grava evento de domínio nem notificação; `package.json` sem dependência nova; a migration só cria tabelas, índices e CHECKs.*

## 7. Testes

- **Unitários:**
  - regras de quem avalia, do prazo e da substituição;
  - validação;
  - números das análises;
  - telas.
- **Integração:**
  - schema (CHECKs, unicidade);
  - caso de uso com o relógio do banco;
  - leitura pela equipe;
  - análises;
  - "Meus dados" e anonimização.
- **E2E:** o solicitante avalia uma concluída; o atendente vê a avaliação; o gestor vê o bloco nas análises.

## 8. Riscos

- **Poucas respostas tornam a média enganosa:** mitigado pela taxa de resposta e pelo aviso "poucos dados".
- **Comentário com dados pessoais:** mitigado porque só a equipe que já lê a solicitação vê o comentário, ele entra em "Meus dados" e é anonimizado.

## 9. Tarefas

- **SF-150** — Migration, domínio e caso de uso da avaliação, com unitários e integração.
- **SF-151** — Telas (solicitante, fila, gestor), bloco nas análises, "Meus dados" e anonimização, E2E e registros.

## 10. Decisões tomadas (2026-11-06)

- **P1 — Nota de 1 a 5 com comentário opcional:** é a escala mais conhecida, simples de responder e de resumir.
- **P2 — Até 30 dias depois da conclusão:** tempo suficiente para responder, sem avaliações muito tardias, que medem outra coisa.
- **P3 — Comentário de até 1.000 caracteres:** curto como um comentário de reabertura.
- **P4 — Uma por conclusão; a reconclusão permite outra, que substitui:** a nota vale para o resultado final, e o histórico guarda a anterior.
- **P5 — Sem nota por pessoa:** a satisfação depende do serviço todo, não só de quem atendeu. Isso segue a decisão A7 das análises, de não classificar pessoas.
- **P6 — Sem notificação nem evento de domínio:** a avaliação aparece na solicitação e nas análises; um aviso a cada nota seria ruído. Sem evento, as restrições de tipo da fila de saída e dos webhooks não mudam.
- **P7 — A anonimização mantém a nota:** a nota sozinha não identifica ninguém e mantém as médias corretas.
