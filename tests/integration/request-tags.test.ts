import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 items 2 and 3 (SF-196; CA-ETQ-03).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { changeRequestTags, getRequestTags } from "@/modules/tags";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const ti = await createDomainSector();
  const rh = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: ti.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: ti.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: rh.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: ti.id, status: "OPEN" });
  const [rede, urgente] = await Promise.all([
    prisma.sectorTag.create({ data: { sectorId: ti.id, name: "Rede", color: "blue" } }),
    prisma.sectorTag.create({ data: { sectorId: ti.id, name: "Urgente", color: "red" } }),
  ]);
  const folha = await prisma.sectorTag.create({ data: { sectorId: rh.id, name: "Folha", color: "green" } });
  return { ti, rh, ana, gabi, bia, rita, request, rede, urgente, folha };
}

describe("tags on a request (3.3 items 2 and 3; CA-ETQ-03)", () => {
  it("the sector's attendant puts tags on and takes them off, with the history and the event", async () => {
    const { ana, request, rede, urgente } = await scenario();
    actAs(ana);
    await expect(changeRequestTags({ requestId: request.id, add: [rede.id, urgente.id] })).resolves.toEqual({ added: 2, removed: 0 });
    await expect(changeRequestTags({ requestId: request.id, remove: [rede.id] })).resolves.toEqual({ added: 0, removed: 1 });
    // A change that changes nothing writes nothing.
    await expect(changeRequestTags({ requestId: request.id, add: [urgente.id], remove: [rede.id] })).resolves.toEqual({ added: 0, removed: 0 });

    const view = await getRequestTags(request.id);
    expect(view.tags.map(({ name }) => name)).toEqual(["Urgente"]);
    expect(view.choices.map(({ name }) => name)).toEqual(["Rede"]);
    expect(view.canEdit).toBe(true);
    // The two tags put on together share the instant: their order between them is not fixed.
    const history = view.events.map(({ action, tagName, actorName }) => `${action} ${tagName} ${actorName}`);
    expect(history.slice(0, 2).sort()).toEqual([`ADDED Rede ${ana.name}`, `ADDED Urgente ${ana.name}`]);
    expect(history[2]).toBe(`REMOVED Rede ${ana.name}`);
    const events = await prisma.outboxEvent.findMany({ where: { requestId: request.id, type: "request.tags_changed" }, orderBy: { occurredAt: "asc" }, select: { payload: true } });
    expect(events.map(({ payload }) => payload)).toEqual([
      { actorId: ana.id, added: 2, removed: 0 },
      { actorId: ana.id, added: 0, removed: 1 },
    ]);
  });

  it("only the team reads them; only the sector's attendants change them", async () => {
    const { ana, gabi, bia, rita, request, rede } = await scenario();
    actAs(ana);
    await changeRequestTags({ requestId: request.id, add: [rede.id] });

    actAs(gabi);
    await expect(getRequestTags(request.id)).resolves.toMatchObject({ canEdit: false, tags: [{ name: "Rede" }] });
    await expect(changeRequestTags({ requestId: request.id, remove: [rede.id] })).rejects.toBeInstanceOf(NotFoundError);
    for (const person of [bia, rita]) {
      actAs(person);
      await expect(getRequestTags(request.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(changeRequestTags({ requestId: request.id, remove: [rede.id] })).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("only the sector's active tags, at most 5, never on a cancelled request", async () => {
    const { ti, ana, request, rede, folha } = await scenario();
    actAs(ana);
    const inactive = await prisma.sectorTag.create({ data: { sectorId: ti.id, name: "Antiga", color: "gray", isActive: false } });
    for (const tagId of [inactive.id, folha.id]) {
      await expect(changeRequestTags({ requestId: request.id, add: [tagId] })).rejects.toBeInstanceOf(ValidationError);
    }
    const more = await Promise.all(
      ["A", "B", "C", "D", "E"].map((name) => prisma.sectorTag.create({ data: { sectorId: ti.id, name: `Etiqueta ${name}`, color: "gray" } })),
    );
    await changeRequestTags({ requestId: request.id, add: more.slice(0, 4).map(({ id }) => id).concat(rede.id) });
    await expect(changeRequestTags({ requestId: request.id, add: [more[4].id] })).rejects.toMatchObject({ issues: [{ code: "too_big" }] });

    await prisma.request.update({ where: { id: request.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await expect(changeRequestTags({ requestId: request.id, remove: [rede.id] })).rejects.toBeInstanceOf(ConflictError);
    expect((await getRequestTags(request.id)).canEdit).toBe(false);
  });

  it("a former sector's tags stay, shown as such, until the new sector takes them off (decision I4)", async () => {
    const { rh, ana, bia, request, rede, folha } = await scenario();
    actAs(ana);
    await changeRequestTags({ requestId: request.id, add: [rede.id] });
    await prisma.request.update({ where: { id: request.id }, data: { sectorId: rh.id } });

    actAs(bia);
    const view = await getRequestTags(request.id);
    expect(view.tags).toEqual([expect.objectContaining({ name: "Rede", fromOtherSector: true })]);
    expect(view.choices.map(({ name }) => name)).toEqual(["Folha"]);
    await expect(changeRequestTags({ requestId: request.id, add: [folha.id], remove: [rede.id] })).resolves.toEqual({ added: 1, removed: 1 });
  });

  it("two attendants adding the same tag at once: one of them is refused", async () => {
    const { ana, request, rede } = await scenario();
    actAs(ana);
    const results = await Promise.allSettled([
      changeRequestTags({ requestId: request.id, add: [rede.id] }),
      changeRequestTags({ requestId: request.id, add: [rede.id] }),
    ]);
    const added = results.filter((result) => result.status === "fulfilled" && result.value.added === 1);
    expect(added).toHaveLength(1);
    expect(await prisma.requestTag.count({ where: { requestId: request.id } })).toBe(1);
    expect(await prisma.requestTagEvent.count({ where: { requestId: request.id } })).toBe(1);
  });
});
