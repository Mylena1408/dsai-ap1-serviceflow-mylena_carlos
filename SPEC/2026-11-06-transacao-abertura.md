# SPEC — Transações de escrita das solicitações mais curtas e com limite explícito

**Data:** 2026-11-06
**Status:** Aprovada em 2026-11-06. A responsável pediu "comece pelo item 1" (correções antes de crescer) e escolheu a opção "Ler histórico fora + limite 10 s". **Concluída em 2026-11-06** (SF-142; CA-TXA-01 a 05 verificados).
**Projeto:** ServiceFlow
**Referências:**
- `NOTES.md`, seção "Produção: região das funções da Vercel (2026-11-05)";
- `SPEC/2026-09-30-catalogo-e-solicitacoes.md`: abertura e mudança de status;
- `SPEC/2026-10-31-relatorio-fase-1.md`: relógio do banco.

## 1. Problema

No teste de produção da SF-030, abrir uma solicitação falhou de forma intermitente com `Transaction already closed ... timeout 5000 ms`. Os números:

- A transação **Serializable** de abertura faz cerca de 35 idas e voltas ao banco.
- A maior parte delas, umas 15 consultas, é a leitura do histórico completo (`getWithHistory`), que roda **dentro** da transação, só para montar a resposta.
- O limite é o padrão do Prisma, **5 s**, e não está escrito no código.

Com as funções e o banco na mesma região (`gru1` e `sa-east-1`), o tempo voltou a ficar baixo. O risco continua, porém: qualquer lentidão do banco ou da rede, como um banco acordando, derruba a abertura. A transação de mudança de status tem o mesmo desenho.

## 2. Escopo

1. **Abertura** (`createRequest`) e **mudança de status** (`transitionRequestStatus`): a leitura do histórico completo sai da transação de escrita. Ela roda logo depois do commit, numa transação própria, curta e só de leitura.
2. As transações do módulo de solicitações (`createPrismaRequestTransactionRunner`) ganham limite **explícito de 10 s**, numa constante com nome.

## 3. Fora de escopo

- Reduzir as consultas da própria escrita, como juntar leituras de configuração. Fica para uma SPEC futura, se as medições pedirem.
- Transações de outros módulos, como comentários, aprovações e webhooks, que não mostraram o problema.
- Mudar o nível de isolamento: continua **Serializable**.

## 4. Regras

1. Os passos de escrita e as verificações continuam idênticos e na mesma ordem, na mesma transação:
   - autorização;
   - configuração vigente;
   - documentos;
   - inserções;
   - eventos e outbox.
2. A resposta continua igual: a solicitação com o histórico completo, já com o que acabou de ser gravado. A leitura pós-commit enxerga tudo, porque roda depois do commit.
3. Se a escrita falha, nada muda em relação a hoje: a transação é desfeita, e na abertura com anexos a compensação remove os arquivos. A leitura pós-commit não roda.
4. Se a escrita foi gravada e a **leitura pós-commit** falhar, o erro sobe como hoje. Os dados ficam gravados, e a próxima leitura mostra a solicitação. Na abertura com anexos, a compensação **não** pode remover os arquivos de uma solicitação gravada.
5. Limite de 10 s: uma transação que passe disso é desfeita pelo Prisma, como hoje acontece aos 5 s.

## 5. Critérios de aceitação

- [x] **CA-TXA-01** — A abertura e a mudança de status gravam numa transação que não chama `getWithHistory`. A leitura do histórico roda numa segunda transação, só depois da primeira terminar. *Verificado em 2026-11-06: unitários com executor que registra as chamadas de cada transação (abertura sem e com documentos, mudança de status). Com o código anterior, 6 dos 8 testes novos falham.*
- [x] **CA-TXA-02** — As respostas da abertura e da mudança de status são iguais às de antes. Os testes existentes dos dois casos de uso continuam passando sem alteração das asserções. *Verificado em 2026-11-06: unitários 1084/1084, integração 418/418 e E2E 25/25 sem mudar asserções existentes. Com o código anterior, 6 dos 8 testes novos falham.*
- [x] **CA-TXA-03** — Escrita recusada: nenhuma leitura pós-commit roda, e na abertura com anexos os arquivos são removidos, como antes. *Verificado em 2026-11-06: unitários (escrita que falha: uma transação só, sem leitura, arquivos removidos; mudança recusada sem leitura). Com o código anterior, 6 dos 8 testes novos falham.*
- [x] **CA-TXA-04** — Falha só na leitura pós-commit: a solicitação e os anexos continuam gravados, e nenhum arquivo é removido. *Verificado em 2026-11-06: unitários (falha só na leitura: solicitação, anexo e objeto continuam). Com o código anterior, 6 dos 8 testes novos falham.*
- [x] **CA-TXA-05** — As transações do módulo de solicitações passam `timeout: 10000` ao Prisma, verificado por teste. *Verificado em 2026-11-06: unitário com `$transaction` simulado recebendo `{ isolationLevel: "Serializable", timeout: 10000 }`. Com o código anterior, 6 dos 8 testes novos falham.*

## 6. Testes

- **Unitários:**
  - executor de transações que registra a ordem das chamadas: escrita, commit, depois leitura;
  - falha na escrita;
  - falha só na leitura pós-commit, sem remover arquivos;
  - limite passado ao Prisma.
- **Integração e E2E:** as suítes existentes de abertura, status, documentos e API, sem mudança de asserção.

## 7. Tarefas

- **SF-142** — Leitura do histórico fora da transação de escrita (abertura e status) e limite explícito de 10 s, com testes.
