import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";

const authorization = vi.hoisted(() => ({ role: "ATTENDANT" }));
vi.mock("@/server/authorization", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/authorization")>();
  return { ...original, requireCurrentActor: vi.fn(async () => ({ id: "ana", role: authorization.role, isActive: true, sectorId: "s" })) };
});

import { MAX_BATCH_ITEMS, refusalOf, runQueueBatch, type BatchActions } from "@/modules/requests/application/batch";

// SPEC 2026-11-07-operacao-e-automacao, 7.3 item 2 (SF-192; CA-LOT-03 by the rules).

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function actions(failures: Record<string, unknown> = {}): BatchActions & { calls: string[] } {
  const calls: string[] = [];
  const act = (name: string) =>
    vi.fn(async (input: { requestId: string }) => {
      calls.push(`${name}:${input.requestId}`);
      if (failures[input.requestId]) throw failures[input.requestId];
    });
  return { calls, assume: act("assume"), transfer: act("transfer"), priority: act("priority"), sector: act("sector") };
}

describe("the reasons of a refused item (7.3 item 2)", () => {
  it("are fixed texts from the individual action's refusal", () => {
    expect(refusalOf("assume", new ConflictError())).toBe("taken");
    expect(refusalOf("priority", new ConflictError())).toBe("not_allowed");
    expect(refusalOf("sector", new NotFoundError())).toBe("no_access");
    expect(refusalOf("transfer", new AuthorizationError())).toBe("no_access");
    expect(refusalOf("transfer", new ValidationError([]))).toBe("invalid_colleague");
    expect(refusalOf("priority", new ValidationError([]))).toBe("same_priority");
    expect(refusalOf("sector", new ValidationError([]))).toBe("invalid_sector");
    expect(refusalOf("assume", new ValidationError([]))).toBe("unexpected");
    expect(refusalOf("assume", new Error("boom"))).toBe("unexpected");
  });
});

describe("running a batch (7.3 item 2; CA-LOT-03)", () => {
  it("treats each item alone, in order, and reports each one", async () => {
    const target = actions({ [id(2)]: new ConflictError() });
    const result = await runQueueBatch({ action: "assume", requestIds: [id(1), id(2), id(3)] }, target);
    expect(target.calls).toEqual([`assume:${id(1)}`, `assume:${id(2)}`, `assume:${id(3)}`]);
    expect(result).toEqual({
      action: "assume",
      done: 2,
      refused: 1,
      items: [
        { requestId: id(1), outcome: "done" },
        { requestId: id(2), outcome: "refused", reason: "taken" },
        { requestId: id(3), outcome: "done" },
      ],
    });
  });

  it("passes the same data to every item of a transfer, a priority change or a sending", async () => {
    const target = actions();
    await runQueueBatch({ action: "transfer", requestIds: [id(1), id(2)], assigneeId: id(9) }, target);
    await runQueueBatch({ action: "priority", requestIds: [id(1)], priority: "HIGH" }, target);
    await runQueueBatch({ action: "sector", requestIds: [id(1)], sectorId: id(8), note: "  Pertence ao outro setor  " }, target);
    expect(target.transfer).toHaveBeenCalledWith({ requestId: id(2), assigneeId: id(9) });
    expect(target.priority).toHaveBeenCalledWith({ requestId: id(1), priority: "HIGH" });
    expect(target.sector).toHaveBeenCalledWith({ requestId: id(1), sectorId: id(8), note: "Pertence ao outro setor" });
  });

  it("an unexpected failure of one item does not stop the others", async () => {
    const result = await runQueueBatch({ action: "priority", requestIds: [id(1), id(2)], priority: "LOW" }, actions({ [id(1)]: new Error("boom") }));
    expect(result.items).toEqual([
      { requestId: id(1), outcome: "refused", reason: "unexpected" },
      { requestId: id(2), outcome: "done" },
    ]);
  });

  it(`refuses before any item: more than ${MAX_BATCH_ITEMS}, repeated or no requests, a sending without justification, or someone who is not an attendant`, async () => {
    for (const input of [
      { action: "assume", requestIds: Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, index) => id(index)) },
      { action: "assume", requestIds: [id(1), id(1)] },
      { action: "assume", requestIds: [] },
      { action: "close", requestIds: [id(1)] },
      { action: "sector", requestIds: [id(1)], sectorId: id(8), note: "  " },
    ]) {
      const target = actions();
      await expect(runQueueBatch(input, target)).rejects.toBeInstanceOf(ValidationError);
      expect(target.calls).toEqual([]);
    }
    await expect(runQueueBatch({ action: "assume", requestIds: Array.from({ length: MAX_BATCH_ITEMS }, (_, index) => id(index)) }, actions())).resolves.toMatchObject({
      done: MAX_BATCH_ITEMS,
    });

    authorization.role = "MANAGER";
    await expect(runQueueBatch({ action: "assume", requestIds: [id(1)] }, actions())).rejects.toBeInstanceOf(AuthorizationError);
    authorization.role = "ATTENDANT";
  });
});
