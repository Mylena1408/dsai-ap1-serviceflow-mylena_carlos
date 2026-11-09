import { describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

vi.mock("@/server/authorization", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/authorization")>();
  return { ...original, requireCurrentActor: vi.fn(async () => ({ id: "ana", role: "ATTENDANT", isActive: true, sectorId: "s" })) };
});

import { BATCH_REFUSAL_LABELS, refusalOf, runQueueBatch, type BatchActions } from "@/modules/requests/application/batch";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.5 item 2 (SF-233; decision J10; CA-DUP-04, batch).

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const original = id(99);

function actions(failures: Record<string, unknown> = {}, originalFailure?: unknown): BatchActions & { calls: string[] } {
  const calls: string[] = [];
  const unused = vi.fn(async () => {
    throw new Error("not this action");
  });
  return {
    calls,
    assume: unused,
    transfer: unused,
    priority: unused,
    sector: unused,
    tag: unused,
    untag: unused,
    duplicateOriginal: vi.fn(async (code: string) => {
      calls.push(`original:${code}`);
      if (originalFailure) throw originalFailure;
      return original;
    }),
    duplicate: vi.fn(async (input: { requestId: string; originalId: string; note: string }) => {
      calls.push(`duplicate:${input.requestId}:${input.originalId}:${input.note}`);
      if (failures[input.requestId]) throw failures[input.requestId];
    }),
  };
}

describe("closing as a duplicate in a batch (13.5 item 2)", () => {
  it("checks the original once, then closes item by item with the same trimmed note", async () => {
    const double = actions();
    const result = await runQueueBatch({ action: "duplicate", requestIds: [id(1), id(2)], code: "#00000000", note: "  Mesmo pedido.  " }, double);
    expect(double.calls).toEqual([`original:#00000000`, `duplicate:${id(1)}:${original}:Mesmo pedido.`, `duplicate:${id(2)}:${original}:Mesmo pedido.`]);
    expect(result).toMatchObject({ action: "duplicate", done: 2, refused: 0 });
  });

  it("a refused item does not undo the others, and says why", async () => {
    const double = actions({ [id(2)]: new ConflictError(), [id(3)]: new NotFoundError(), [id(4)]: new ValidationError([{ path: ["code"], code: "invalid_value" }]) });
    const result = await runQueueBatch({ action: "duplicate", requestIds: [id(1), id(2), id(3), id(4)], code: "AB12CD34", note: "Repetido." }, double);
    expect(result.items).toEqual([
      { requestId: id(1), outcome: "done" },
      { requestId: id(2), outcome: "refused", reason: "invalid_duplicate" },
      { requestId: id(3), outcome: "refused", reason: "no_access" },
      { requestId: id(4), outcome: "refused", reason: "invalid_duplicate" },
    ]);
    expect(result).toMatchObject({ done: 1, refused: 3 });
  });

  it("refuses the whole batch, before any item, without a note or with a wrong original", async () => {
    for (const note of ["", "   ", "x".repeat(1_001)]) {
      const double = actions();
      await expect(runQueueBatch({ action: "duplicate", requestIds: [id(1)], code: "AB12CD34", note }, double)).rejects.toBeInstanceOf(ValidationError);
      expect(double.calls).toEqual([]);
    }
    const double = actions({}, new ValidationError([{ path: ["code"], code: "invalid_value" }]));
    await expect(runQueueBatch({ action: "duplicate", requestIds: [id(1)], code: "ZZ", note: "Repetido." }, double)).rejects.toBeInstanceOf(ValidationError);
    expect(double.calls).toEqual(["original:ZZ"]);
  });

  it("without the closing in the actions (older doubles), the action is refused as invalid", async () => {
    const { duplicate: _duplicate, duplicateOriginal: _original, ...older } = actions();
    void _duplicate;
    void _original;
    await expect(runQueueBatch({ action: "duplicate", requestIds: [id(1)], code: "AB12CD34", note: "Repetido." }, older)).rejects.toBeInstanceOf(ValidationError);
  });

  it("has its own reason text, and the other actions keep theirs", () => {
    expect(BATCH_REFUSAL_LABELS.invalid_duplicate).toContain("é a própria original");
    expect(refusalOf("duplicate", new ConflictError())).toBe("invalid_duplicate");
    expect(refusalOf("assume", new ConflictError())).toBe("taken");
    expect(refusalOf("priority", new ConflictError())).toBe("not_allowed");
  });
});
