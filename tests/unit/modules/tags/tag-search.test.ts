import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/server/errors";

vi.mock("@/server/authorization", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/authorization")>();
  return { ...original, requireCurrentActor: vi.fn(async () => ({ id: "ana", role: "ATTENDANT", isActive: true, sectorId: "s" })) };
});

import { MAX_TAG_FILTERS, parseSearchCriteria } from "@/modules/requests/domain/search-criteria";
import { normalizedCriteria } from "@/modules/saved-views";
import { hasSearchCriteria, searchPageHref } from "@/app/_components/request-search-url";
import { refusalOf, runQueueBatch, type BatchActions } from "@/modules/requests/application/batch";

// SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 items 4 and 5 (SF-197; CA-ETQ-04 by the rules).

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

describe("the tag filter (3.3 item 4)", () => {
  it("the queue filters by any of up to 5 tags; the requester's list ignores it", () => {
    expect(parseSearchCriteria({ tag: [id(2), id(1).toUpperCase(), id(2), ""] }, "attendant").tagIds).toEqual([id(2), id(1)]);
    expect(parseSearchCriteria({ tag: id(1) }, "requester")).not.toHaveProperty("tagIds");
    // Without a tag, the criteria are exactly as before.
    expect(parseSearchCriteria({}, "attendant")).not.toHaveProperty("tagIds");
    expect(() => parseSearchCriteria({ tag: "rede" }, "attendant")).toThrow(ValidationError);
    expect(() => parseSearchCriteria({ tag: Array.from({ length: MAX_TAG_FILTERS + 1 }, (_, index) => id(index)) }, "attendant")).toThrow(ValidationError);
  });

  it("goes in the page links, counts as a criterion and is kept by the saved views, sorted", () => {
    expect(searchPageHref("/queue", { tag: [id(2), id(1)], page: "3" }, 2)).toBe(`/queue?tag=${id(2)}&tag=${id(1)}&page=2`);
    expect(hasSearchCriteria({ tag: id(1) })).toBe(true);
    expect(normalizedCriteria("QUEUE", { tag: [id(2), id(1)], status: "OPEN" })).toBe(`status=OPEN&tag=${id(1)}&tag=${id(2)}`);
    expect(normalizedCriteria("MY_REQUESTS", { tag: id(1) })).toBe("");
  });
});

describe("tags in the batch (3.3 item 5; decision I21)", () => {
  it("'Etiquetar' and 'Retirar etiqueta' go through the tags' own rule per item", async () => {
    const calls: string[] = [];
    const record = (name: string) => vi.fn(async (input: { requestId: string; tagId?: string }) => {
      calls.push(`${name}:${input.requestId}:${input.tagId}`);
      if (input.requestId === id(2)) throw new ValidationError([{ path: ["tagIds"], code: "too_big" }]);
    });
    const actions = { assume: record("assume"), transfer: record("transfer"), priority: record("priority"), sector: record("sector"), tag: record("tag"), untag: record("untag") } as unknown as BatchActions;

    const tagged = await runQueueBatch({ action: "tag", requestIds: [id(1), id(2)], tagId: id(9) }, actions);
    expect(tagged.items).toEqual([
      { requestId: id(1), outcome: "done" },
      { requestId: id(2), outcome: "refused", reason: "invalid_tag" },
    ]);
    await runQueueBatch({ action: "untag", requestIds: [id(3)], tagId: id(9) }, actions);
    expect(calls).toEqual([`tag:${id(1)}:${id(9)}`, `tag:${id(2)}:${id(9)}`, `untag:${id(3)}:${id(9)}`]);
    expect(refusalOf("untag", new ValidationError([]))).toBe("invalid_tag");
    await expect(runQueueBatch({ action: "tag", requestIds: [id(1)] }, actions)).rejects.toBeInstanceOf(ValidationError);
  });
});
