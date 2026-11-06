# SPEC — Respostas prontas para atendentes

**Data:** 2026-11-06
**Status:** Aprovada em 2026-11-06, dentro da "leva recomendada" aprovada pela responsável (segunda funcionalidade). As decisões R1 a R6 da seção 9 foram adotadas como recomendadas. **Concluída em 2026-11-06** (SF-152 e SF-153; CA-RSP-01 a 05 verificados).
**Projeto:** ServiceFlow
**Referências:** `SPEC/2026-10-31-comentarios.md` (comentários e notas internas).

## 1. Objetivo

Atendentes respondem às mesmas perguntas muitas vezes, por exemplo "o que preciso para a troca de senha?" ou "o técnico passa amanhã de manhã". Com **respostas prontas** do setor, o atendente insere um texto padrão no comentário, ajusta o que for preciso e envia. O texto já vem com o nome do solicitante e os dados da solicitação.

## 2. Escopo

1. Página **"Respostas prontas"** (`/queue/responses`), em que os atendentes do setor criam, editam, desativam e reativam as respostas do setor **(decisão R1)**.
2. No formulário de comentário da fila, o seletor **"Inserir resposta pronta"** coloca o texto escolhido no campo do comentário, sem enviar nada.
3. **Campos substituídos** no texto inserido **(decisão R3)**:

   | Campo | Vira |
   |---|---|
   | `{{solicitante}}` | primeiro nome do solicitante |
   | `{{servico}}` | nome do serviço |
   | `{{codigo}}` | código curto da solicitação |
   | `{{atendente}}` | nome de quem está atendendo |

## 3. Fora de escopo

- Respostas pessoais, de um atendente só, e respostas da organização inteira **(decisão R1)**.
- Anexos dentro da resposta pronta.
- Envio automático: a resposta só preenche o campo, e o atendente sempre revisa e envia **(decisão R4)**.
- Uso pelo solicitante, pelo gestor, pela API ou pelo MCP.

## 4. Regras

1. **Quem gerencia e usa:** atendentes ativos, só com as respostas do **setor atual**. Quem muda de setor passa a ver as do novo setor.
2. **Campos:**
   - **título:** de 1 a 120 caracteres, único entre as respostas **ativas** do setor, sem diferenciar maiúsculas;
   - **texto:** de 1 a 5.000 caracteres, o mesmo limite do comentário;
   - **situação:** ativa ou inativa.
3. **Desativação** **(decisão R2):**
   - Uma resposta inativa some do seletor e continua na página de gerenciamento, onde pode ser reativada.
   - A reativação é recusada se já existir outra ativa com o mesmo título.
   - Não há exclusão.
4. **Inserção:**
   - O seletor lista as respostas ativas do setor em ordem alfabética do título.
   - Ao escolher uma e clicar em "Inserir", o texto já com os campos substituídos é **acrescentado** ao que estiver escrito no campo do comentário, separado por uma linha em branco.
   - O comentário continua sujeito às regras normais (limite, nota interna, arquivos).
   - A substituição usa os dados que o atendente já vê na solicitação.
   - Um campo desconhecido (`{{outro}}`) fica como está.
5. **Recusas:**
   - pessoa que não é atendente ativo, ou resposta de outro setor: "não encontrada";
   - título repetido entre as ativas: conflito, com a mensagem junto do campo;
   - título ou texto vazios ou longos demais: erro de validação.
6. **Registro:** cada resposta guarda quem a criou, quem a alterou por último e as datas. Ela não entra na auditoria geral nem no histórico das solicitações **(decisão R5)**.

## 5. Dados

Migration **aditiva**: tabela `CannedResponse`.

| Coluna | Tipo e regra |
|---|---|
| `id` | uuid |
| `sectorId` | chave estrangeira para `Sector` |
| `title` | `citext`, com `CHECK` de 1 a 120 caracteres sem espaços nas pontas |
| `body` | `text`, com `CHECK` de 1 a 5.000 caracteres |
| `isActive` | booleano |
| `createdById`, `updatedById` | chaves estrangeiras para `User` |
| `createdAt`, `updatedAt` | datas |

Mais um **índice único parcial** (`sectorId`, `title`) `WHERE "isActive"`.

## 6. Critérios de aceitação

- [x] **CA-RSP-01** — O atendente cria, edita, desativa e reativa respostas do próprio setor; título e texto seguem 4.2. *Verificado em 2026-11-06: unitários dos casos de uso e integração (criar, editar, desativar, reativar; autoria registrada).*
- [x] **CA-RSP-02** — São recusados:
  - um título repetido entre as ativas do setor, inclusive na reativação;
  - qualquer pessoa que não seja atendente ativo;
  - a resposta de outro setor.

  O banco também recusa título repetido e título ou texto fora dos limites. *Verificado em 2026-11-06: integração (título repetido sem diferenciar maiúsculas, inclusive na reativação; outro setor "não encontrada"; schema recusa limites e repetição, aceita o mesmo título inativo) e unitários (solicitante, gestor, atendente inativo ou sem setor).*
- [x] **CA-RSP-03** — No detalhe da fila, o seletor lista só as ativas do setor, em ordem alfabética. "Inserir" acrescenta o texto com os quatro campos substituídos e não envia nada. *Verificado em 2026-11-06: unitários (substituição dos 4 campos, campo desconhecido mantido, ordem alfabética) e E2E (inserção sem envio, ajuste e envio).*
- [x] **CA-RSP-04** — O solicitante e o gestor não veem o seletor nem a página. *Verificado em 2026-11-06: unitário do seletor e E2E (o solicitante não vê o seletor e é redirecionado da página).*
- [x] **CA-RSP-05** — Nenhuma dependência nova; a migration é aditiva. *Verificado em 2026-11-06: `package.json` sem mudança; a migration só cria tabela, índices e CHECKs.*

## 7. Testes

- **Unitários:**
  - substituição dos campos;
  - validação;
  - regras de acesso e de título repetido;
  - telas;
  - componente de inserção.
- **Integração:** schema (CHECKs e índice único parcial), casos de uso por setor e reativação.
- **E2E:** o atendente cria uma resposta, insere no comentário de uma solicitação, ajusta e envia; o solicitante vê o comentário com o próprio nome.

## 8. Tarefas

- **SF-152** — Migration, módulo `canned-responses` (domínio, casos de uso, persistência), com unitários e integração.
- **SF-153** — Página "Respostas prontas", seletor no detalhe da fila, E2E e registros.

## 9. Decisões tomadas (2026-11-06)

- **R1 — Respostas do setor, mantidas pelos próprios atendentes:** quem usa é quem conhece as perguntas frequentes, e o setor compartilha o mesmo conjunto.
- **R2 — Desativar em vez de excluir:** evita perder um texto revisado e mantém o registro de autoria.
- **R3 — Quatro campos simples:** cobrem as saudações e as referências mais comuns, sem linguagem de modelo complexa.
- **R4 — Só preenche o campo:** o atendente sempre revisa antes de enviar, o que evita respostas automáticas erradas.
- **R5 — Sem auditoria geral:** a resposta é material de trabalho do setor, sem dados pessoais; quem criou e quem alterou por último ficam na própria linha.
- **R6 — Inserção no navegador:** um componente pequeno acrescenta o texto ao campo. Sem JavaScript, o atendente ainda copia o texto da página "Respostas prontas".
