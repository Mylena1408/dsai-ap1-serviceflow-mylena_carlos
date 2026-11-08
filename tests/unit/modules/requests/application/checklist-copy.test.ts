import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryTransactionRunner, createStore, requestId, serviceId, storedRequest, type StoredActor } from "../in-memory-requests";
import type { RequestTransactionRunner } from "@/modules/requests/application/ports";
import type { ChecklistTemplateItem } from "@/modules/checklists";

const authorization = vi.hoisted(() => ({
  requireStatusChangeActor: vi.fn(),
  requireCurrentActor: vi.fn(),
}));
vi.mock("@/server/authorization", () => authorization);

import { transitionRequestStatus } from "@/modules/requests/application/transition-request-status";

// SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 2 (SF-202): the copy inside the start's transaction.

const attendant: StoredActor = { id: "attendant-1", role: "ATTENDANT", sectorId: "sector-1", isActive: true, name: "Ana", email: "ana@example.test" };

const model: ChecklistTemplateItem[] = [
  { id: "i1", text: "Instalar", isRequired: true, position: 1, isActive: true, conditionFieldId: null, conditionValue: null },
  { id: "i2", text: "Testar", isRequired: false, position: 2, isActive: true, conditionFieldId: null, conditionValue: null },
];

/** The in-memory runner with the checklist's ports. */
function runnerWith(state: { copied: boolean; inserted: unknown[]; modelReads: string[] }): RequestTransactionRunner {
  const base = createInMemoryTransactionRunner(
    createStore({ actors: [attendant], requests: [storedRequest()] }),
  );
  return {
    run: (work) =>
      base.run((transaction) =>
        work({
          ...transaction,
          hasChecklist: async () => state.copied,
          listChecklistModel: async (id) => {
            state.modelReads.push(id);
            return model;
          },
          insertChecklist: async (id, copiedAt, items) => {
            state.inserted.push({ id, copiedAt, items });
            state.copied = true;
          },
        }),
      ),
  } as RequestTransactionRunner;
}

describe("the checklist's copy on start (SF-202)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireStatusChangeActor.mockResolvedValue({ actorId: attendant.id, sectorId: attendant.sectorId });
  });

  it("copies the service's model once, numbered from 1, at the start's time", async () => {
    const state = { copied: false, inserted: [] as unknown[], modelReads: [] as string[] };
    await transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, runnerWith(state));

    expect(state.modelReads).toEqual([serviceId]);
    expect(state.inserted).toEqual([
      {
        id: requestId,
        copiedAt: expect.any(Date),
        items: [
          { templateItemId: "i1", textSnapshot: "Instalar", isRequired: true, position: 1 },
          { templateItemId: "i2", textSnapshot: "Testar", isRequired: false, position: 2 },
        ],
      },
    ]);
  });

  it("does not read nor copy the model when the request was already copied", async () => {
    const state = { copied: true, inserted: [] as unknown[], modelReads: [] as string[] };
    await transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, runnerWith(state));

    expect(state.modelReads).toEqual([]);
    expect(state.inserted).toEqual([]);
  });
});
