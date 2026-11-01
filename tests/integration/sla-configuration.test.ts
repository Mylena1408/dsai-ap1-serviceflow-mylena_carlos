import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createRequest, reopenRequest, transitionRequestStatus } from "@/modules/requests";
import { createService, updateService } from "@/modules/services";

// SPEC 2026-11-01-sla-prioridades (SF-066).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const base = { name: `Serviço ${Date.now()}`, description: "Com prazo", categoryId: category.id, sectorId: sector.id };
  return { sector, admin, rita, ana, base };
}

const HOUR = 60 * 60 * 1000;
const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });

describe("SLA configuration and snapshot (SF-066)", () => {
  it("lets only the administrator configure priority and SLA, within limits (CA-SLA-02)", async () => {
    const { admin, rita, base } = await scenario();

    actAs(admin);
    const service = await createService({ ...base, defaultPriority: "HIGH", slaHours: "24" }, prisma);
    expect(service).toMatchObject({ defaultPriority: "HIGH", slaHours: 24 });
    for (const slaHours of ["0", "2001", "1.5", "x"]) {
      await expect(updateService(service.id, { ...base, slaHours }, prisma)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(updateService(service.id, { ...base, defaultPriority: "CRITICAL" }, prisma)).rejects.toBeInstanceOf(
      ValidationError,
    );

    // A form without the fields keeps them; an empty SLA removes it.
    await expect(updateService(service.id, { ...base, name: `${base.name} 2` }, prisma)).resolves.toMatchObject({
      defaultPriority: "HIGH",
      slaHours: 24,
    });
    await expect(updateService(service.id, { ...base, slaHours: "" }, prisma)).resolves.toMatchObject({ slaHours: null });

    actAs(rita);
    await expect(createService({ ...base, slaHours: "8" }, prisma)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("snapshots priority and SLA on opening; later changes do not touch it (CA-SLA-03)", async () => {
    const { admin, rita, base } = await scenario();
    actAs(admin);
    const service = await createService({ ...base, defaultPriority: "URGENT", slaHours: "8" }, prisma);

    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Com prazo" }, prisma);
    const opened = await stored(request.id);
    expect(opened).toMatchObject({ priority: "URGENT", slaHoursSnapshot: 8 });
    expect(opened.dueAt!.getTime() - opened.createdAt.getTime()).toBe(2 * HOUR);

    actAs(admin);
    await updateService(service.id, { ...base, defaultPriority: "LOW", slaHours: "100" }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ priority: "URGENT", slaHoursSnapshot: 8, dueAt: opened.dueAt });
  });

  it("records the completion result and restarts the due date on reopening (CA-SLA-04, 08)", async () => {
    const { admin, rita, ana, base } = await scenario();
    actAs(admin);
    const service = await createService({ ...base, slaHours: "4" }, prisma);
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Atrasada" }, prisma);
    await prisma.request.update({
      where: { id: request.id },
      data: { dueAt: new Date(Date.now() - HOUR), slaWarningNotifiedAt: new Date(), slaBreachNotifiedAt: new Date() },
    });

    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ status: "COMPLETED", completedLate: true });

    actAs(rita);
    await reopenRequest({ requestId: request.id, note: "Voltou" }, prisma);
    const reopened = await stored(request.id);
    const event = await prisma.requestStatusEvent.findFirstOrThrow({ where: { requestId: request.id, toStatus: "OPEN", fromStatus: "COMPLETED" } });
    expect(reopened).toMatchObject({ status: "OPEN", completedLate: null, slaWarningNotifiedAt: null, slaBreachNotifiedAt: null });
    expect(reopened.dueAt!.getTime() - event.occurredAt.getTime()).toBe(4 * HOUR);
  });

  it("keeps services without SLA free of due dates and results (CA-SLA-01)", async () => {
    const { admin, rita, ana, base } = await scenario();
    actAs(admin);
    const service = await createService(base, prisma);
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Sem prazo" }, prisma);
    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);

    await expect(stored(request.id)).resolves.toMatchObject({
      priority: "NORMAL",
      slaHoursSnapshot: null,
      dueAt: null,
      completedLate: null,
    });
  });
});
