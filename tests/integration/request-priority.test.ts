import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError } from "@/server/errors";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { assumeRequest, changeRequestPriority, getAttendantRequest } from "@/modules/requests";

// SPEC 2026-11-01-sla-prioridades (SF-067).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const HOUR = 60 * 60 * 1000;

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  const opened = await prisma.request.findUniqueOrThrow({ where: { id: request.id } });
  await prisma.request.update({
    where: { id: request.id },
    data: {
      slaHoursSnapshot: 10,
      dueAt: new Date(opened.createdAt.getTime() + 10 * HOUR),
      slaWarningNotifiedAt: new Date(),
    },
  });
  return { rita, ana, bia, caio, request, opened };
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });

describe("priority change (SF-067)", () => {
  it("recalculates the due date, records history and event, and allows new alerts when later (CA-SLA-04, 06)", async () => {
    const { ana, request, opened } = await scenario();
    actAs(ana);

    await changeRequestPriority({ requestId: request.id, priority: "LOW" }, prisma);

    const after = await stored(request.id);
    expect(after.priority).toBe("LOW");
    expect(after.dueAt!.getTime() - opened.createdAt.getTime()).toBe(20 * HOUR);
    expect(after.slaWarningNotifiedAt).toBeNull();
    await expect(prisma.requestPriorityEvent.findMany({ where: { requestId: request.id } })).resolves.toEqual([
      expect.objectContaining({ actorId: ana.id, fromPriority: "NORMAL", toPriority: "LOW" }),
    ]);
    await expect(prisma.outboxEvent.findFirstOrThrow({ where: { type: "request.priority_changed" } })).resolves.toMatchObject({
      payload: { fromPriority: "NORMAL", toPriority: "LOW", actorId: ana.id },
    });

    const detail = await getAttendantRequest(request.id, prisma);
    expect(detail.priorityEvents).toEqual([expect.objectContaining({ toPriority: "LOW", actor: { id: ana.id, name: ana.name } })]);
  });

  it("keeps alert marks when the due date moves earlier", async () => {
    const { ana, request, opened } = await scenario();
    actAs(ana);

    await changeRequestPriority({ requestId: request.id, priority: "URGENT" }, prisma);

    const after = await stored(request.id);
    expect(after.dueAt!.getTime() - opened.createdAt.getTime()).toBe(2.5 * HOUR);
    expect(after.slaWarningNotifiedAt).not.toBeNull();
  });

  it("allows only the effective assignee and hides the request from other sectors (CA-SLA-06)", async () => {
    const { ana, bia, caio, rita, request } = await scenario();
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);

    actAs(bia);
    await expect(changeRequestPriority({ requestId: request.id, priority: "HIGH" }, prisma)).rejects.toBeInstanceOf(
      ConflictError,
    );
    for (const actor of [caio, rita]) {
      actAs(actor);
      await expect(changeRequestPriority({ requestId: request.id, priority: "HIGH" }, prisma)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    await expect(stored(request.id)).resolves.toMatchObject({ priority: "NORMAL" });
    await expect(prisma.requestPriorityEvent.count()).resolves.toBe(0);
  });
});
