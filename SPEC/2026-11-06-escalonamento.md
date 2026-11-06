# SPEC — Escalonamento automático de solicitações vencidas

**Data:** 2026-11-06
**Status:** Aprovada em 2026-11-06, dentro da "leva recomendada" aprovada pela responsável (terceira funcionalidade). As decisões E1 a E7 da seção 9 foram adotadas como recomendadas. **Concluída em 2026-11-06** (SF-154 e SF-155; CA-ESC-01 a 08 verificados).
**Projeto:** ServiceFlow
**Referências:**
- `SPEC/2026-11-01-sla-prioridades.md`: prazos, prioridades, alerta de vencimento do job diário (5.5);
- `SPEC/2026-11-01-notificacoes-email-preferencias.md`: notificações;
- `SPEC/2026-11-03-pausa-sla-calendario.md`: pausa.

## 1. Objetivo

Quando uma solicitação vence sem ser concluída, hoje só o atendente responsável (ou a equipe) é avisado. Com o **escalonamento**, em setores que o ativarem, o vencimento também:
1. **sobe a prioridade** em um nível;
2. **avisa os gestores do setor**.

Assim, o gestor fica sabendo e pode agir.

## 2. Escopo

1. Opção por setor **"Escalar solicitações vencidas"**, na seção "Setores" da administração. Vem desligada por padrão **(decisão E1)**.
2. No momento em que o job diário registra o vencimento (alerta `request.sla_breached`) de uma solicitação de setor com a opção ligada:
   - a prioridade sobe um nível: Baixa → Normal → Alta → Urgente; a Urgente continua Urgente **(decisão E2)**;
   - o escalonamento é gravado, com a data e as prioridades antes e depois;
   - os gestores ativos do setor recebem a notificação "Solicitação vencida escalada", na categoria de e-mail "Prazos".
3. O detalhe da solicitação, na fila e no gestor, mostra os escalonamentos.
4. "Análises" mostra quantas solicitações foram escaladas no período.

## 3. Fora de escopo

- Regras configuráveis (níveis, tempos, destinatários escolhidos) e escalonamento antes do vencimento **(decisão E3)**.
- Recalcular o vencimento por causa da nova prioridade **(decisão E4)**.
- Escalonamento manual pelo atendente.
- Webhook ou evento de domínio novo **(decisão E5)**.

## 4. Regras

1. **Quando:** junto com o registro do alerta de vencimento, na mesma transação. As regras do alerta não mudam: sem alerta durante a pausa, uma vez por vencimento, e de novo depois de uma reabertura que traga um novo prazo.
2. **Condição:** o setor **atual** da solicitação tem a opção ligada no momento do alerta. Desligar a opção não desfaz os escalonamentos já feitos.
3. **Prioridade:**
   - sobe um nível, sem passar de Urgente;
   - o vencimento (`dueAt`) **não** é recalculado **(decisão E4)**: o prazo perdido continua sendo a referência;
   - a mudança aparece no bloco "Escalonamentos" do detalhe, e não como mudança manual de prioridade.
4. **Registro:** uma linha por escalonamento, com:
   - solicitação, data;
   - prioridade antes e depois (iguais quando já era Urgente).

   A linha fica no histórico da solicitação **(decisão E6)**.
5. **Notificação:**
   - Ao processar o evento de vencimento, se houver escalonamento gravado nesse mesmo instante, os gestores ativos do setor recebem o tipo `sla.escalated`, além das notificações de vencimento que já existiam.
   - O e-mail segue a preferência da categoria "Prazos".
   - Sem gestor ativo no setor, ninguém mais é avisado.
6. **Quem configura:** só o administrador. A mudança da opção entra na auditoria como alteração do setor **(decisão E7)**.
7. **Quem vê os escalonamentos:**
   - a equipe do setor atual;
   - o gestor que pode ler a solicitação.

   O solicitante não vê, porque é informação interna. Ele continua vendo a prioridade.

## 5. Dados

Migration **aditiva**:
- coluna `Sector.escalateOverdue boolean NOT NULL DEFAULT false`;
- tabela `RequestEscalation`:

  | Coluna | Tipo e regra |
  |---|---|
  | `id` | uuid |
  | `requestId` | chave estrangeira |
  | `fromPriority` | `RequestPriority` |
  | `toPriority` | `RequestPriority` |
  | `occurredAt` | `timestamptz` |

  Com índice por `requestId` e por `occurredAt`.

## 6. Critérios de aceitação

- [x] **CA-ESC-01** — Com a opção desligada, o vencimento funciona como antes: nenhuma prioridade muda, nada é gravado e nenhum gestor é avisado. *Verificado em 2026-11-06: integração (setor desligado: só o alerta de vencimento, prioridade e vencimento iguais, nenhuma linha, nenhum gestor).*
- [x] **CA-ESC-02** — Com a opção ligada, o vencimento:
  - sobe a prioridade um nível (Urgente fica Urgente);
  - grava o escalonamento;
  - não muda o vencimento;

  tudo na mesma transação do alerta. *Verificado em 2026-11-06: integração (Normal → Alta, Urgente mantida e registrada, vencimento igual, segunda execução não escala de novo) e unitário da subida.*
- [x] **CA-ESC-03** — Durante a pausa, não há escalonamento. Uma reabertura com novo prazo pode escalar de novo. *Verificado em 2026-11-06: integração (pausada não escala; nova data de vencimento escala de novo, Baixa → Normal → Alta).*
- [x] **CA-ESC-04** — Os gestores ativos do setor recebem `sla.escalated`, e os destinatários do vencimento continuam os mesmos. *Verificado em 2026-11-06: integração (só o gestor ativo recebe `sla.escalated`; o atendente continua com `sla.breached`) e unitários do planejamento.*
- [x] **CA-ESC-05** — O administrador liga e desliga a opção, e isso entra na auditoria. Outros perfis não alteram a opção. *Verificado em 2026-11-06: integração (gestor recusado; duas mudanças do administrador na auditoria, com o campo novo) e E2E (botão Ligar/Desligar).*
- [x] **CA-ESC-06** — A equipe e o gestor veem os escalonamentos no detalhe; o solicitante não vê. *Verificado em 2026-11-06: integração (atendente e gestor com permissão leem; outro setor "não encontrada"), unitário do bloco e E2E no detalhe do gestor.*
- [x] **CA-ESC-07** — "Análises" mostra as escaladas no período e no recorte. *Verificado em 2026-11-06: integração (1 escalada no período e no setor).*
- [x] **CA-ESC-08** — Nenhuma dependência nova; a migration é aditiva. *Verificado em 2026-11-06: `package.json` sem mudança; migration com uma coluna com padrão e uma tabela nova.*

## 7. Testes

- **Unitários:** subida de prioridade, planejamento das notificações e telas.
- **Integração:**
  - job de alertas com o setor ligado e desligado;
  - pausa;
  - reabertura;
  - notificações dos gestores;
  - configuração e auditoria;
  - leitura e análises.
- **E2E:** o administrador liga a opção; uma solicitação vencida é processada pelo job diário (rota protegida do job); o gestor vê a notificação e o escalonamento.

## 8. Tarefas

- **SF-154** — Migration, configuração do setor, escalonamento no job, notificações, com unitários e integração.
- **SF-155** — Telas (administração, detalhe), análises, E2E e registros.

## 9. Decisões tomadas (2026-11-06)

- **E1 — Desligado por padrão:** nada muda para quem não quer escalonamento.
- **E2 — Um nível de prioridade:** sinaliza a urgência na fila sem pular etapas.
- **E3 — Só no vencimento:** reaproveita o alerta que já existe; regras configuráveis ficam para uma SPEC futura, se houver demanda.
- **E4 — Sem recalcular o vencimento:** recalcular pela nova prioridade puxaria o prazo para trás de um prazo já perdido, sem efeito prático e confundindo os relatórios.
- **E5 — Sem evento de domínio novo:** a notificação aproveita o evento de vencimento; um tipo novo exigiria recriar as restrições da fila de saída e dos webhooks.
- **E6 — Bloco próprio no detalhe:** a mudança de prioridade manual exige uma pessoa como autora; o escalonamento é do sistema e fica separado.
- **E7 — Só o administrador configura:** é uma política do setor, como os outros dados do setor.
