"use client";

import { useActionState, useState } from "react";
import type { BatchAction, BatchChoices } from "@/modules/requests";
import { runBatchAction, type BatchState } from "./batch-actions";
import { QUEUE_BATCH_FORM_ID } from "./queue-batch-form";

// "Ações em lote" of the queue (SPEC 2026-11-07-operacao-e-automacao, 7.3 item 2): the boxes of the page's
// requests belong to this form (by its id), so only the page's requests can be sent. Transfer and send ask
// for the same data as the individual actions, equal for every item. The result lists each item.

const ACTION_LABELS: Record<BatchAction, string> = {
  assume: "Assumir",
  transfer: "Transferir a um colega",
  priority: "Mudar a prioridade",
  sector: "Encaminhar a outro setor",
  // SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 5.
  tag: "Etiquetar",
  untag: "Retirar etiqueta",
};

const PRIORITY_LABELS = { LOW: "Baixa", NORMAL: "Normal", HIGH: "Alta", URGENT: "Urgente" } as const;

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

export function QueueBatch({
  labels,
  choices,
  tags = [],
}: {
  labels: Record<string, string>;
  choices: BatchChoices;
  /** The sector's active tags, for "Etiquetar" and "Retirar etiqueta". */
  tags?: Array<{ id: string; name: string }>;
}) {
  const [state, run, running] = useActionState<BatchState, FormData>(runBatchAction, { step: "idle" });
  const [action, setAction] = useState<BatchAction>("assume");

  return (
    <section className="surface-card queue-batch" aria-labelledby="queue-batch-heading">
      <h2 id="queue-batch-heading">Ações em lote</h2>
      <p className="section-description">
        Marque solicitações desta página (até 50) e escolha a ação. Cada uma é tratada sozinha, como se a ação fosse feita nela; uma recusada não
        desfaz as outras.
      </p>
      <form action={run} aria-label="Aplicar ação às solicitações marcadas" className="inline-form" id={QUEUE_BATCH_FORM_ID}>
        <label>
          Ação
          <select name="action" onChange={(event) => setAction(event.target.value as BatchAction)} value={action}>
            {(Object.keys(ACTION_LABELS) as BatchAction[]).map((value) => (
              <option key={value} value={value}>
                {ACTION_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {action === "transfer" ? (
          <label>
            Colega
            <select name="assigneeId" required>
              <option value="">Escolha o colega</option>
              {choices.colleagues.map((colleague) => (
                <option key={colleague.id} value={colleague.id}>
                  {colleague.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {action === "priority" ? (
          <label>
            Prioridade
            <select defaultValue="HIGH" name="priority">
              {(Object.keys(PRIORITY_LABELS) as Array<keyof typeof PRIORITY_LABELS>).map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {action === "tag" || action === "untag" ? (
          <label>
            Etiqueta
            <select name="tagId" required>
              <option value="">Escolha a etiqueta</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {action === "sector" ? (
          <>
            <label>
              Setor
              <select name="sectorId" required>
                <option value="">Escolha o setor</option>
                {choices.sectors.map((sector) => (
                  <option key={sector.id} value={sector.id}>
                    {sector.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Justificativa
              <textarea maxLength={1000} name="note" required rows={2} />
            </label>
          </>
        ) : null}
        <button disabled={running} type="submit">
          {running ? "Aplicando…" : "Aplicar às marcadas"}
        </button>
      </form>
      {state.step === "error" ? (
        <p className="feedback feedback-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.step === "result" ? (
        <div className="feedback" role="status">
          <p>
            {ACTION_LABELS[state.result.action]}: {count(state.result.done, "feita", "feitas")}, {count(state.result.refused, "recusada", "recusadas")}.
          </p>
          <ul aria-label="Resultado por solicitação">
            {state.result.items.map((item) => (
              <li key={item.requestId}>
                {labels[item.requestId] ?? "Solicitação"}: {item.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
