import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 items 4 and 5 (SF-197; CA-ETQ-04 for the search, the views and the batch).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runQueueBatch, searchAttendantQueue } from "@/modules/requests";
import { saveView } from "@/modules/saved-views";
import { listQueueTags } from "@/modules/tags";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const ti = await createDomainSector();
  const rh = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: ti.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const requests = [];
  for (let index = 0; index < 3; index += 1) {
    requests.push(await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: ti.id, status: "OPEN" }));
  }
  const rede = await prisma.sectorTag.create({ data: { sectorId: ti.id, name: "Rede", color: "blue" } });
  const urgente = await prisma.sectorTag.create({ data: { sectorId: ti.id, name: "Urgente", color: "red" } });
  const folha = await prisma.sectorTag.create({ data: { sectorId: rh.id, name: "Folha", color: "green" } });
  await prisma.sectorTag.create({ data: { sectorId: ti.id, name: "Antiga", color: "gray", isActive: false } });
  return { ti, ana, rita, requests, rede, urgente, folha };
}

describe("tags in the queue (3.3 items 4 and 5; CA-ETQ-04)", () => {
  it("the batch tags and untags, item by item, and the search finds by any chosen tag", async () => {
    const { ana, requests, rede, urgente, folha } = await scenario();
    actAs(ana);
    expect((await listQueueTags()).map(({ name }) => name)).toEqual(["Rede", "Urgente"]);

    const tagged = await runQueueBatch({ action: "tag", requestIds: [requests[0].id, requests[1].id], tagId: rede.id });
    expect(tagged).toMatchObject({ done: 2, refused: 0 });
    await runQueueBatch({ action: "tag", requestIds: [requests[2].id], tagId: urgente.id });
    // A tag of another sector is refused for each item, with its reason.
    await expect(runQueueBatch({ action: "tag", requestIds: [requests[0].id], tagId: folha.id })).resolves.toMatchObject({
      items: [{ outcome: "refused", reason: "invalid_tag" }],
    });
    expect(await prisma.requestTagEvent.count({ where: { requestId: { in: requests.map(({ id }) => id) } } })).toBe(3);

    const byRede = await searchAttendantQueue({ tag: rede.id });
    expect(byRede.items.map(({ id }) => id).sort()).toEqual([requests[0].id, requests[1].id].sort());
    const byEither = await searchAttendantQueue({ tag: [rede.id, urgente.id] });
    expect(byEither.total).toBe(3);

    await runQueueBatch({ action: "untag", requestIds: [requests[0].id], tagId: rede.id });
    expect((await searchAttendantQueue({ tag: rede.id })).items.map(({ id }) => id)).toEqual([requests[1].id]);
    await expect(searchAttendantQueue({ tag: "rede" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a saved view of the queue keeps the tag filter", async () => {
    const { ana, rede } = await scenario();
    actAs(ana);
    await expect(saveView({ list: "QUEUE", name: "Rede", criteria: `tag=${rede.id}&page=2&status=OPEN` })).resolves.toMatchObject({
      criteria: `status=OPEN&tag=${rede.id}`,
    });
  });

  it("the requester's list ignores the tag filter", async () => {
    const { rita, requests, rede } = await scenario();
    await prisma.requestTag.create({ data: { requestId: requests[0].id, tagId: rede.id, addedById: rita.id, addedAt: new Date() } });
    actAs(rita);
    const { searchRequesterRequests } = await import("@/modules/requests");
    expect((await searchRequesterRequests({ tag: rede.id })).total).toBe(3);
  });
});
