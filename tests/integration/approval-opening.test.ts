import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createService, updateService } from "@/modules/services";
import { createRequest, transitionRequestStatus } from "@/modules/requests";

// SPEC 2026-11-01-aprovacoes, sections 5.2, 5.3 and 5.5 (SF-083; CA-APR-01, 02, 04, 05 and 07).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const HOUR = 60 * 60 * 1000;

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(admin);
  const base = { description: "Compra de equipamento", categoryId: category.id, sectorId: sector.id, slaHours: "10" };
  const withApproval = await createService({ name: `Compra ${sector.id}`, ...base, requiresApproval: true }, prisma);
  const withoutApproval = await createService({ name: `Troca ${sector.id}`, ...base }, prisma);
  return { admin, rita, ana, withApproval, withoutApproval, base };
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });

describe("approval at opening and start (SF-083)", () => {
  it("lets the administrator mark a service as requiring approval; new services do not (CA-APR-02)", async () => {
    const { admin, withApproval, withoutApproval, base } = await scenario();

    expect(withApproval.requiresApproval).toBe(true);
    expect(withoutApproval.requiresApproval).toBe(false);

    actAs(admin);
    const name = withApproval.name;
    await expect(updateService(withApproval.id, { name, ...base }, prisma)).resolves.toMatchObject({
      requiresApproval: true,
    });
    await expect(
      updateService(withApproval.id, { name, ...base, requiresApproval: false }, prisma),
    ).resolves.toMatchObject({ requiresApproval: false });
  });

  it("opens pending, without a due date, and keeps it when the service changes later (CA-APR-04, 07)", async () => {
    const { admin, rita, withApproval, base } = await scenario();
    actAs(rita);

    const request = await createRequest({ serviceId: withApproval.id, description: "Notebook" }, prisma);

    await expect(stored(request.id)).resolves.toMatchObject({
      approvalState: "PENDING",
      slaHoursSnapshot: 10,
      dueAt: null,
      dueSoonAt: null,
    });

    actAs(admin);
    await updateService(withApproval.id, { name: withApproval.name, ...base, requiresApproval: false }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ approvalState: "PENDING" });
  });

  it("refuses to start while the approval is pending (CA-APR-05)", async () => {
    const { rita, ana, withApproval } = await scenario();
    actAs(rita);
    const request = await createRequest({ serviceId: withApproval.id, description: "Notebook" }, prisma);

    actAs(ana);
    await expect(
      transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(stored(request.id)).resolves.toMatchObject({ status: "OPEN" });
    await expect(prisma.requestStatusEvent.count({ where: { requestId: request.id } })).resolves.toBe(1);
  });

  it("keeps services without approval exactly as before (CA-APR-01)", async () => {
    const { rita, ana, withoutApproval } = await scenario();
    actAs(rita);
    const request = await createRequest({ serviceId: withoutApproval.id, description: "Monitor" }, prisma);

    const opened = await stored(request.id);
    expect(opened.approvalState).toBeNull();
    expect(opened.dueAt!.getTime() - opened.createdAt.getTime()).toBe(10 * HOUR);

    actAs(ana);
    await expect(
      transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma),
    ).resolves.toMatchObject({ status: "IN_PROGRESS" });
  });
});
