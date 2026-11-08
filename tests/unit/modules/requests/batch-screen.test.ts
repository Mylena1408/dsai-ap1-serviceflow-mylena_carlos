import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ValidationError } from "@/server/errors";

const requests = vi.hoisted(() => ({ runQueueBatch: vi.fn() }));
vi.mock("@/modules/requests", () => ({
  ...requests,
  BATCH_REFUSAL_LABELS: { taken: "já tem responsável, não pode ser assumida agora ou mudou enquanto você agia", no_access: "sem permissão" },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { runBatchAction } from "@/app/(attendant)/queue/batch-actions";
import { QueueBatch } from "@/app/(attendant)/queue/queue-batch";

// SPEC 2026-11-07-operacao-e-automacao, 7.3 item 2 (SF-193; CA-LOT-03 through the screen).

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};

beforeEach(() => vi.clearAllMocks());

describe("the batch from the queue (7.3 item 2)", () => {
  it("sends the marked requests with the data of the chosen action and lists each result", async () => {
    requests.runQueueBatch.mockResolvedValue({
      action: "assume",
      done: 1,
      refused: 1,
      items: [
        { requestId: A, outcome: "done" },
        { requestId: B, outcome: "refused", reason: "taken" },
      ],
    });
    const state = await runBatchAction({ step: "idle" }, form([["action", "assume"], ["requestIds", A], ["requestIds", B], ["note", "ignorada"]]));
    expect(requests.runQueueBatch).toHaveBeenCalledWith({ action: "assume", requestIds: [A, B] });
    expect(state).toEqual({
      step: "result",
      result: {
        action: "assume",
        done: 1,
        refused: 1,
        items: [
          { requestId: A, done: true, text: "feito" },
          { requestId: B, done: false, text: "recusado (já tem responsável, não pode ser assumida agora ou mudou enquanto você agia)" },
        ],
      },
    });

    requests.runQueueBatch.mockResolvedValue({ action: "sector", done: 0, refused: 0, items: [] });
    await runBatchAction({ step: "idle" }, form([["action", "sector"], ["requestIds", A], ["sectorId", B], ["note", "Outro setor"]]));
    expect(requests.runQueueBatch).toHaveBeenLastCalledWith({ action: "sector", requestIds: [A], sectorId: B, note: "Outro setor" });
  });

  it("explains a batch refused before any item", async () => {
    requests.runQueueBatch.mockRejectedValueOnce(new ValidationError([{ path: ["requestIds"], code: "too_small" }]));
    await expect(runBatchAction({ step: "idle" }, form([["action", "assume"]]))).resolves.toEqual({
      step: "error",
      message: "Marque de 1 a 50 solicitações desta página e preencha os dados da ação escolhida.",
    });
    requests.runQueueBatch.mockRejectedValueOnce(new ValidationError([{ path: ["note"], code: "too_small" }]));
    await expect(runBatchAction({ step: "idle" }, form([["action", "sector"]]))).resolves.toMatchObject({ message: "Escreva a justificativa do encaminhamento." });
    requests.runQueueBatch.mockRejectedValueOnce(new AuthorizationError());
    await expect(runBatchAction({ step: "idle" }, form([["action", "assume"]]))).resolves.toMatchObject({ message: "Só o atendente usa as ações em lote." });
  });

  it("with no request on the page and nothing sent, the block shows nothing (SPEC 2026-11-08-atendimento-dia-a-dia, SF-199)", () => {
    expect(renderToStaticMarkup(createElement(QueueBatch, { labels: {}, choices: { colleagues: [], sectors: [] }, empty: true }))).toBe("");
  });

  it("the form offers the four actions and starts with 'Assumir'", () => {
    const html = renderToStaticMarkup(createElement(QueueBatch, { labels: {}, choices: { colleagues: [{ id: A, name: "Bia" }], sectors: [] } }));
    expect(html).toContain('id="queue-batch"');
    for (const label of ["Assumir", "Transferir a um colega", "Mudar a prioridade", "Encaminhar a outro setor"]) expect(html).toContain(label);
    expect(html).not.toContain('name="assigneeId"');
    expect(html).toContain("Aplicar às marcadas");
  });
});
