import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { linkRequests, runQueueBatch } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.5 item 2 (SF-233; decision J10; CA-DUP-04, batch).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const code = (id: string) => id.slice(0, 8).toUpperCase();

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const lia = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const open = (requesterId: string) => createDomainRequest({ requesterId, serviceId: service.id, sectorId: sector.id });
  return { rita, lia, ana, bia, open, original: await open(rita.id) };
}

const statusOf = async (id: string) => (await prisma.request.findUniqueOrThrow({ where: { id } })).status;
const duplicateLinks = (fromRequestId: string, toRequestId: string) => prisma.requestLink.count({ where: { fromRequestId, toRequestId, kind: "DUPLICATE_OF" } });

describe("closing as a duplicate in a batch (13.5 item 2)", () => {
  it("links when needed, closes each item by rule 8.3 and reports each one", async () => {
    const { lia, ana, bia, open, original } = await scenario();
    const fresh = await open(lia.id);
    const linked = await open(lia.id);
    const held = await open(lia.id);
    await prisma.request.update({ where: { id: held.id }, data: { assigneeId: bia.id } });
    actAs(ana);
    await linkRequests({ requestId: linked.id, code: code(original.id), kind: "DUPLICATE_OF" }, prisma);

    const result = await runQueueBatch(
      { action: "duplicate", requestIds: [fresh.id, linked.id, original.id, held.id], code: `#${code(original.id)}`, note: "Mesmo pedido." },
      prisma,
    );
    expect(result.items).toEqual([
      { requestId: fresh.id, outcome: "done" },
      { requestId: linked.id, outcome: "done" },
      { requestId: original.id, outcome: "refused", reason: "invalid_duplicate" },
      { requestId: held.id, outcome: "refused", reason: "invalid_duplicate" },
    ]);

    // Closed by the rule of one closing: reason, note, link history, the requester following the original.
    for (const id of [fresh.id, linked.id]) {
      expect(await statusOf(id)).toBe("CANCELLED");
      expect(await duplicateLinks(id, original.id)).toBe(1);
      await expect(prisma.requestStatusEvent.findFirstOrThrow({ where: { requestId: id, toStatus: "CANCELLED" } })).resolves.toMatchObject({
        reason: "DUPLICATE",
        note: `Duplicada de #${code(original.id)}. Mesmo pedido.`,
      });
    }
    expect(await prisma.requestFollower.count({ where: { requestId: original.id, userId: lia.id } })).toBe(1);
    // The original itself and the one held by a colleague stay as they were; the held one keeps the link made for it.
    expect(await statusOf(original.id)).toBe("OPEN");
    expect(await statusOf(held.id)).toBe("OPEN");
    expect(await duplicateLinks(held.id, original.id)).toBe(1);
  });

  it("an item that is already a duplicate of another request is refused, untouched", async () => {
    const { lia, ana, open, original } = await scenario();
    const another = await open(lia.id);
    const item = await open(lia.id);
    actAs(ana);
    await linkRequests({ requestId: item.id, code: code(another.id), kind: "DUPLICATE_OF" }, prisma);
    const result = await runQueueBatch({ action: "duplicate", requestIds: [item.id], code: code(original.id), note: "Repetido." }, prisma);
    expect(result.items).toEqual([{ requestId: item.id, outcome: "refused", reason: "invalid_duplicate" }]);
    expect(await statusOf(item.id)).toBe("OPEN");
    expect(await duplicateLinks(item.id, original.id)).toBe(0);
  });

  it("a cancelled or unknown original refuses the whole batch before any item", async () => {
    const { lia, ana, open, original } = await scenario();
    const item = await open(lia.id);
    actAs(ana);
    await expect(runQueueBatch({ action: "duplicate", requestIds: [item.id], code: "FFFFFFFF", note: "Repetido." }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await prisma.request.update({ where: { id: original.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await expect(runQueueBatch({ action: "duplicate", requestIds: [item.id], code: code(original.id), note: "Repetido." }, prisma)).rejects.toBeInstanceOf(ValidationError);
    expect(await statusOf(item.id)).toBe("OPEN");
    expect(await prisma.requestLink.count({ where: { fromRequestId: item.id } })).toBe(0);
  });
});
