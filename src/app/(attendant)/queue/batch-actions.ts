"use server";

import { revalidatePath } from "next/cache";
import { BATCH_REFUSAL_LABELS, runQueueBatch, type BatchAction } from "@/modules/requests";
import { ApplicationError, ValidationError } from "@/server/errors";

// Batch actions from the queue (SPEC 2026-11-07-operacao-e-automacao, 7.3 item 2): the requests marked on the
// page and one action, with the same data for all. The result comes back to the form, item by item; the
// queue is read again, since the items changed.

export interface BatchOutcome {
  action: BatchAction;
  done: number;
  refused: number;
  /** Each item with "feito" or the refusal's fixed text. */
  items: Array<{ requestId: string; done: boolean; text: string }>;
}

export type BatchState = { step: "idle" } | { step: "result"; result: BatchOutcome } | { step: "error"; message: string };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The fixed message of a batch refused before any item (internal: only async exports become actions). */
function refusal(error: ApplicationError): string {
  if (error instanceof ValidationError) {
    const paths = error.issues.flatMap(({ path }) => path);
    if (paths.includes("note")) return "Escreva a justificativa do encaminhamento.";
    return "Marque de 1 a 50 solicitações desta página e preencha os dados da ação escolhida.";
  }
  if (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN") return "Só o atendente usa as ações em lote.";
  return "Não foi possível aplicar a ação.";
}

export async function runBatchAction(_previous: BatchState, formData: FormData): Promise<BatchState> {
  const requestIds = formData.getAll("requestIds").filter((value): value is string => typeof value === "string");
  const action = field(formData, "action");
  const extra =
    action === "transfer"
      ? { assigneeId: field(formData, "assigneeId") }
      : action === "priority"
        ? { priority: field(formData, "priority") }
        : action === "sector"
          ? { sectorId: field(formData, "sectorId"), note: field(formData, "note") }
          : {};
  try {
    const result = await runQueueBatch({ action, requestIds, ...extra });
    revalidatePath("/queue");
    return {
      step: "result",
      result: {
        action: result.action,
        done: result.done,
        refused: result.refused,
        items: result.items.map((item) =>
          item.outcome === "done"
            ? { requestId: item.requestId, done: true, text: "feito" }
            : { requestId: item.requestId, done: false, text: `recusado (${BATCH_REFUSAL_LABELS[item.reason]})` },
        ),
      },
    };
  } catch (error) {
    if (error instanceof ApplicationError) return { step: "error", message: refusal(error) };
    throw error;
  }
}
