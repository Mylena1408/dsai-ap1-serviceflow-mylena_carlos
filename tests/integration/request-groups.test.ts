import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { NotFoundError } from "@/server/errors";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 3.3 item 4 (SF-179; CA-VNC-01 and 06).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import {
  cancelGroup,
  getRequestGroupBlock,
  getRequesterGroup,
  listRequesterGroupLabels,
  openBundle,
  transitionRequestStatus,
} from "@/modules/requests";
import { createBundle } from "@/modules/service-bundles";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const ti = await createDomainSector();
  const rh = await createDomainSector();
  const category = await createDomainCategory();
  const services = [
    await createDomainService({ categoryId: category.id, sectorId: rh.id }),
    await createDomainService({ categoryId: category.id, sectorId: ti.id }),
    await createDomainService({ categoryId: category.id, sectorId: ti.id }),
  ];
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const rui = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
  actAs(admin);
  const bundle = await createBundle({ name: "Admissão", serviceIds: services.map(({ id }) => id) }, prisma);
  actAs(rita);
  const opened = await openBundle({ bundleId: bundle.id, description: "Primeiro dia" }, prisma);
  return { ti, rh, services, admin, rita, rui, ana, bundle, opened };
}

describe("schema of the group position (3.4; CA-VNC-07)", () => {
  it("keeps the bundle's order and refuses a position without a group or repeated", async () => {
    const { opened, services, rita } = await scenario();
    const rows = await prisma.request.findMany({ where: { groupId: opened.groupId }, orderBy: { groupPosition: "asc" }, select: { id: true, serviceId: true, groupPosition: true } });
    expect(rows.map(({ serviceId, groupPosition }) => [serviceId, groupPosition])).toEqual(services.map(({ id }, index) => [id, index + 1]));

    const alone = await createDomainRequest({ requesterId: rita.id, serviceId: services[1].id, sectorId: services[1].sectorId });
    expect(alone).toMatchObject({ groupId: null, groupPosition: null });
    await expect(prisma.request.update({ where: { id: alone.id }, data: { groupPosition: 1 } })).rejects.toThrow(/Request_groupPosition_check/);
    await expect(prisma.request.update({ where: { id: alone.id }, data: { groupId: opened.groupId, groupPosition: 6 } })).rejects.toThrow(/Request_groupPosition_check/);
    await expect(prisma.request.update({ where: { id: alone.id }, data: { groupId: opened.groupId, groupPosition: 2 } })).rejects.toThrow(
      /Request_group_position_key|Unique constraint/,
    );
  });
});

describe("following a bundle (3.3 item 4; CA-VNC-06)", () => {
  it("the requester sees the group in order, with the progress, and labels on the list", async () => {
    const { opened, services, rita, rui } = await scenario();
    const view = await getRequesterGroup(opened.groupId, prisma);
    expect(view).toMatchObject({ bundleName: "Admissão", progress: { total: 3, completed: 0, closed: false }, cancellable: true });
    expect(view.requests.map(({ id }) => id)).toEqual(opened.requestIds);
    expect(view.requests.map(({ serviceName }) => serviceName)).toEqual(services.map(({ name }) => name));

    const labels = await listRequesterGroupLabels(opened.requestIds, prisma);
    expect([...labels.values()]).toEqual(opened.requestIds.map(() => ({ groupId: opened.groupId, bundleName: "Admissão" })));
    void rita;
    actAs(rui);
    await expect(getRequesterGroup(opened.groupId, prisma)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cancelling the bundle cancels what the requester could cancel alone and keeps the rest", async () => {
    const { opened, rita, ana } = await scenario();
    // Ana starts the second request (sector TI).
    actAs(ana);
    await transitionRequestStatus({ requestId: opened.requestIds[1], toStatus: "IN_PROGRESS" }, prisma);

    actAs(rita);
    const result = await cancelGroup({ groupId: opened.groupId, note: "A admissão foi adiada" }, prisma);
    expect(result).toEqual({
      cancelled: [opened.requestIds[0], opened.requestIds[2]],
      kept: [{ requestId: opened.requestIds[1], reason: "not_open" }],
    });
    const statuses = await prisma.request.findMany({ where: { id: { in: opened.requestIds } }, select: { id: true, status: true } });
    expect(Object.fromEntries(statuses.map(({ id, status }) => [id, status]))).toEqual({
      [opened.requestIds[0]]: "CANCELLED",
      [opened.requestIds[1]]: "IN_PROGRESS",
      [opened.requestIds[2]]: "CANCELLED",
    });
    // Each cancellation has the history and the event of a single cancellation, with the same reason.
    await expect(
      prisma.requestStatusEvent.findMany({ where: { requestId: { in: opened.requestIds }, toStatus: "CANCELLED" }, select: { note: true, actorId: true } }),
    ).resolves.toEqual([
      { note: "A admissão foi adiada", actorId: rita.id },
      { note: "A admissão foi adiada", actorId: rita.id },
    ]);
    await expect(prisma.outboxEvent.count({ where: { requestId: { in: opened.requestIds }, type: "request.status_changed" } })).resolves.toBe(3);

    const view = await getRequesterGroup(opened.groupId, prisma);
    expect(view.progress).toEqual({ total: 3, completed: 0, cancelled: 2, closed: false });
    expect(view.cancellable).toBe(false);
  });

  it("whoever attends a request sees the other requests, opening only the ones they read", async () => {
    const { opened, ana, rh } = await scenario();
    actAs(ana);
    const block = await getRequestGroupBlock(opened.requestIds[1], prisma);
    expect(block).toMatchObject({ bundleName: "Admissão", progress: { total: 3 } });
    expect(block!.others.map(({ id, sectorName, readable }) => [id, sectorName, readable])).toEqual([
      [opened.requestIds[0], rh.name, false],
      [opened.requestIds[2], expect.any(String), true],
    ]);
    // A request of another sector stays hidden as before.
    await expect(getRequestGroupBlock(opened.requestIds[0], prisma)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a request outside bundles has no group (CA-VNC-01)", async () => {
    const { services, rita, ana } = await scenario();
    const alone = await createDomainRequest({ requesterId: rita.id, serviceId: services[1].id, sectorId: services[1].sectorId });
    actAs(ana);
    await expect(getRequestGroupBlock(alone.id, prisma)).resolves.toBeNull();
    actAs(rita);
    await expect(listRequesterGroupLabels([alone.id], prisma)).resolves.toEqual(new Map());
  });
});
