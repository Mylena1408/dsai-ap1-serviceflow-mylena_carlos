import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 4.3 items 2 to 6 (SF-181; CA-DST-01, 03 and 04).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createRequest, decideApproval, openBundle, releaseRequest, sendRequestToSector, transitionRequestStatus } from "@/modules/requests";
import { createBundle } from "@/modules/service-bundles";
import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function named(role: Role, name: string, sectorId: string | null = null) {
  const user = await createDomainUser({ role, sectorId });
  return prisma.user.update({ where: { id: user.id }, data: { name } });
}

async function scenario(mode: "NONE" | "ROUND_ROBIN" | "LEAST_LOAD" = "ROUND_ROBIN", maxActivePerAttendant: number | null = null) {
  const sector = await createDomainSector();
  await prisma.sector.update({ where: { id: sector.id }, data: { distributionMode: mode, maxActivePerAttendant } });
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await named("REQUESTER", "Rita");
  const ana = await named("ATTENDANT", "Ana", sector.id);
  const bia = await named("ATTENDANT", "Bia", sector.id);
  const caio = await named("ATTENDANT", "Caio", sector.id);
  const open = async (description = "Pedido") => {
    actAs(rita);
    return createRequest({ serviceId: service.id, description }, prisma);
  };
  return { sector, category, service, rita, ana, bia, caio, open };
}

const holderOf = async (requestId: string) => (await prisma.request.findUniqueOrThrow({ where: { id: requestId } })).assigneeId;

describe("distribution at the opening (4.3 items 2 to 5)", () => {
  it("a sector with the distribution off opens as before (CA-DST-01)", async () => {
    const { open } = await scenario("NONE");
    const request = await open();
    expect(await holderOf(request.id)).toBeNull();
    await expect(prisma.requestAssignmentEvent.count()).resolves.toBe(0);
  });

  it("round-robin hands each opening to the next attendant by name, as the system, and warns them", async () => {
    const { sector, ana, bia, caio, open } = await scenario();
    const holders = [];
    for (let index = 0; index < 4; index += 1) holders.push(await holderOf((await open()).id));
    expect(holders).toEqual([ana.id, bia.id, caio.id, ana.id]);
    expect((await prisma.sector.findUniqueOrThrow({ where: { id: sector.id } })).lastDistributedToId).toBe(ana.id);

    const events = await prisma.requestAssignmentEvent.findMany({ orderBy: { occurredAt: "asc" } });
    expect(events).toHaveLength(4);
    expect(events.every((event) => event.actorId === null && event.reason === "DISTRIBUTION" && event.fromAssigneeId === null)).toBe(true);

    await runOutbox([notificationConsumer()]);
    const notified = await prisma.requestNotification.findMany({ where: { type: "assignment.received" }, select: { recipientId: true } });
    expect(notified.map(({ recipientId }) => recipientId).sort()).toEqual([ana.id, ana.id, bia.id, caio.id].sort());
  });

  it("skips the inactive, the absent and who reached the limit; without anyone, nobody holds it", async () => {
    const { ana, bia, caio, open } = await scenario("ROUND_ROBIN", 1);
    await prisma.user.update({ where: { id: bia.id }, data: { isActive: false } });
    const today = new Date();
    const day = (offset: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset));
    await prisma.attendantAbsence.create({ data: { userId: caio.id, createdById: caio.id, startsOn: day(-1), endsOn: day(1) } });

    expect(await holderOf((await open()).id)).toBe(ana.id);
    // Ana reached the limit of 1; Bia is inactive and Caio absent.
    expect(await holderOf((await open()).id)).toBeNull();
  });

  it("least load hands it to whoever holds fewer active requests", async () => {
    const { ana, bia, caio, open } = await scenario("LEAST_LOAD");
    // Ana already holds two and Caio one.
    const first = await open();
    const second = await open();
    const third = await open();
    await prisma.request.updateMany({ where: { id: { in: [first.id, second.id] } }, data: { assigneeId: ana.id } });
    await prisma.request.update({ where: { id: third.id }, data: { assigneeId: caio.id } });
    await prisma.sector.updateMany({ data: { lastDistributedToId: null } });

    expect(await holderOf((await open()).id)).toBe(bia.id);
    // Now Bia and Caio hold one each: the tie follows the round-robin, after Bia.
    expect(await holderOf((await open()).id)).toBe(caio.id);
  });

  it("two openings at once never exceed the limit nor give the same turn twice (4.3 item 6)", async () => {
    const { ana, bia, open } = await scenario("ROUND_ROBIN", 1);
    await prisma.user.updateMany({ where: { name: "Caio" }, data: { isActive: false } });
    const results = await Promise.allSettled([open("a"), open("b"), open("c")]);
    const opened = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    // A serialization conflict may refuse an opening; whatever opened is consistent.
    expect(opened.length).toBeGreaterThan(0);
    const holders = await Promise.all(opened.map(({ id }) => holderOf(id)));
    const assigned = holders.filter((holder) => holder !== null);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(assigned.every((holder) => holder === ana.id || holder === bia.id)).toBe(true);
    for (const person of [ana, bia]) {
      await expect(prisma.request.count({ where: { assigneeId: person.id, status: { in: ["OPEN", "IN_PROGRESS"] } } })).resolves.toBeLessThanOrEqual(1);
    }
  });

  it("a bundle's requests of the same sector go to different attendants in turn", async () => {
    const { service, category, sector, ana, bia, rita } = await scenario();
    const other = await createDomainService({ categoryId: category.id, sectorId: sector.id });
    const admin = await named("ADMIN", "Admin");
    actAs(admin);
    const bundle = await createBundle({ name: "Admissão", serviceIds: [service.id, other.id] }, prisma);
    actAs(rita);
    const opened = await openBundle({ bundleId: bundle.id, description: "Primeiro dia" }, prisma);
    expect(await Promise.all(opened.requestIds.map(holderOf))).toEqual([ana.id, bia.id]);
  });
});

describe("the other entrances of the queue (4.3 item 2)", () => {
  it("an opening pending approval is distributed only at the final approval", async () => {
    const { service, sector, ana, open } = await scenario();
    await prisma.service.update({ where: { id: service.id }, data: { requiresApproval: true } });
    const gabi = await named("MANAGER", "Gabi", sector.id);
    const request = await open();
    expect(await holderOf(request.id)).toBeNull();

    actAs(gabi);
    await decideApproval({ requestId: request.id, decision: "APPROVED" }, prisma);
    expect(await holderOf(request.id)).toBe(ana.id);
  });

  it("a request sent from another sector is distributed in the new sector", async () => {
    const { sector, ana, open } = await scenario();
    const origin = await createDomainSector();
    const originService = await createDomainService({ categoryId: (await createDomainCategory()).id, sectorId: origin.id });
    const zeca = await named("ATTENDANT", "Zeca", origin.id);
    const rita = await prisma.user.findFirstOrThrow({ where: { name: "Rita" } });
    actAs(rita);
    const request = await createRequest({ serviceId: originService.id, description: "Veio de outro setor" }, prisma);
    expect(await holderOf(request.id)).toBeNull(); // the origin does not distribute

    actAs(zeca);
    await sendRequestToSector({ requestId: request.id, sectorId: sector.id, note: "É do outro setor." }, prisma);
    expect(await holderOf(request.id)).toBe(ana.id);
    void open;
  });

  it("a released request goes to the next attendant, never back to who released it", async () => {
    const { ana, bia, open } = await scenario();
    const request = await open();
    expect(await holderOf(request.id)).toBe(ana.id);

    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    await releaseRequest({ requestId: request.id }, prisma);
    expect(await holderOf(request.id)).toBe(bia.id);
    const events = await prisma.requestAssignmentEvent.findMany({ where: { requestId: request.id }, orderBy: { occurredAt: "asc" } });
    expect(events.map(({ actorId, reason, toAssigneeId }) => [actorId, reason, toAssigneeId])).toEqual([
      [null, "DISTRIBUTION", ana.id],
      [ana.id, null, null],
      [null, "DISTRIBUTION", bia.id],
    ]);
  });

  it("a reopened request keeps its assignee", async () => {
    const { ana, rita, open } = await scenario();
    const request = await open();
    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);
    const { reopenRequest } = await import("@/modules/requests");
    actAs(rita);
    await reopenRequest({ requestId: request.id, note: "Voltou a acontecer." }, prisma);
    expect(await holderOf(request.id)).toBe(ana.id);
    await expect(prisma.requestAssignmentEvent.count({ where: { requestId: request.id } })).resolves.toBe(1);
  });
});
