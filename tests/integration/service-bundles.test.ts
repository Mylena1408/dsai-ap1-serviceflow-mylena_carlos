import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, ConflictError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 3.3 item 2 and 3.4 (SF-177; CA-VNC-04 and 07).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createBundle, listBundleOverview, setBundleActive, updateBundle } from "@/modules/service-bundles";
import { listAuditTrail } from "@/modules/audit";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const ti = await createDomainSector();
  const rh = await createDomainSector();
  const category = await createDomainCategory();
  const access = await createDomainService({ categoryId: category.id, sectorId: ti.id });
  const desk = await createDomainService({ categoryId: category.id, sectorId: rh.id });
  const badge = await createDomainService({ categoryId: category.id, sectorId: rh.id });
  await prisma.serviceDocumentRequirement.create({ data: { serviceId: badge.id, name: "Foto", isRequired: false, acceptedFormats: ["PDF"], position: 1 } });
  // Even an optional document keeps the service out of bundles (decision H5).
  const admin = await createDomainUser({ role: "ADMIN" });
  actAs(admin);
  return { ti, rh, category, access, desk, badge, admin };
}

describe("bundle schema (3.4; CA-VNC-07)", () => {
  it("refuses shapes out of the rules and repeated active names; existing requests have no group", async () => {
    const { access, desk } = await scenario();
    const valid = { name: "Admissão", serviceIds: [access.id, desk.id] };
    for (const data of [
      { ...valid, name: " Admissão" },
      { ...valid, name: "x".repeat(81) },
      { ...valid, description: "" },
      { ...valid, description: "x".repeat(501) },
      { ...valid, serviceIds: [access.id] },
      { ...valid, serviceIds: [access.id, access.id] },
    ]) {
      await expect(prisma.serviceBundle.create({ data })).rejects.toThrow(/ServiceBundle_values_check/);
    }
    await prisma.serviceBundle.create({ data: valid });
    await expect(prisma.serviceBundle.create({ data: { ...valid, name: "ADMISSÃO" } })).rejects.toThrow(/ServiceBundle_name_active_key|Unique constraint/);
    await expect(prisma.serviceBundle.create({ data: { ...valid, isActive: false } })).resolves.toMatchObject({ isActive: false });

    const requester = await createDomainUser({ role: "REQUESTER" });
    await expect(
      prisma.requestGroup.create({ data: { bundleNameSnapshot: "", requesterId: requester.id, createdAt: new Date() } }),
    ).rejects.toThrow(/RequestGroup_name_check/);
    await expect(prisma.request.count({ where: { groupId: { not: null } } })).resolves.toBe(0);
  });
});

describe("bundles configured by the administrator (3.3 item 2; CA-VNC-04)", () => {
  it("creates, edits, deactivates and reactivates with the audit trail", async () => {
    const { access, desk, admin } = await scenario();
    const created = await createBundle({ name: "Admissão", description: "Novo colaborador", serviceIds: [desk.id, "", access.id] }, prisma);
    expect(created).toMatchObject({ name: "Admissão", serviceIds: [desk.id, access.id], isActive: true });

    await updateBundle(created.id, { name: "Admissão de colaborador", serviceIds: [access.id, desk.id] }, prisma);
    await setBundleActive(created.id, false, prisma);
    await setBundleActive(created.id, true, prisma);

    const entries = await prisma.auditEntry.findMany({ where: { entityType: "SERVICE_BUNDLE", entityId: created.id }, orderBy: { occurredAt: "asc" } });
    expect(entries.map(({ action, actorId }) => [action, actorId])).toEqual([
      ["CREATED", admin.id],
      ["UPDATED", admin.id],
      ["DEACTIVATED", admin.id],
      ["REACTIVATED", admin.id],
    ]);
    expect(entries[1].changes).toEqual(
      expect.arrayContaining([
        { field: "name", before: "Admissão", after: "Admissão de colaborador" },
        { field: "description", before: "Novo colaborador", after: null },
        { field: "serviceIds", before: [desk.id, access.id], after: [access.id, desk.id] },
      ]),
    );
    const trail = await listAuditTrail({ entity: "SERVICE_BUNDLE" }, prisma);
    expect(trail.names[access.id]).toBe(access.name);
  });

  it("refuses a service with documents, an inactive one, a repeated name and other profiles", async () => {
    const { access, desk, badge, ti } = await scenario();
    await expect(createBundle({ name: "Crachá", serviceIds: [access.id, badge.id] }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await prisma.service.update({ where: { id: desk.id }, data: { isActive: false } });
    await expect(createBundle({ name: "Mesa", serviceIds: [access.id, desk.id] }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await expect(createBundle({ name: "Sozinho", serviceIds: [access.id] }, prisma)).rejects.toBeInstanceOf(ValidationError);

    await prisma.service.update({ where: { id: desk.id }, data: { isActive: true } });
    const first = await createBundle({ name: "Admissão", serviceIds: [access.id, desk.id] }, prisma);
    await expect(createBundle({ name: "admissão", serviceIds: [desk.id, access.id] }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await setBundleActive(first.id, false, prisma);
    await createBundle({ name: "Admissão", serviceIds: [desk.id, access.id] }, prisma);
    await expect(setBundleActive(first.id, true, prisma)).rejects.toBeInstanceOf(ConflictError);

    const attendant = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
    actAs(attendant);
    await expect(createBundle({ name: "Outro", serviceIds: [access.id, desk.id] }, prisma)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(prisma.serviceBundle.count()).resolves.toBe(2);
  });

  it("changing a service stays free; the bundle leaves the catalog and says why", async () => {
    const { access, desk, rh } = await scenario();
    const created = await createBundle({ name: "Admissão", serviceIds: [access.id, desk.id] }, prisma);
    expect((await listBundleOverview(prisma)).bundles[0].availability).toEqual({ openable: true, problems: [] });

    await prisma.serviceDocumentRequirement.create({ data: { serviceId: desk.id, name: "Planta", isRequired: true, acceptedFormats: ["PDF"], position: 1 } });
    await prisma.sector.update({ where: { id: rh.id }, data: { isActive: false } });
    const overview = await listBundleOverview(prisma);
    expect(overview.bundles).toEqual([
      expect.objectContaining({
        id: created.id,
        availability: { openable: false, problems: [{ serviceId: desk.id, serviceName: desk.name, problems: ["sector_inactive", "documents"] }] },
      }),
    ]);
    expect(overview.services.find(({ id }) => id === access.id)).toMatchObject({ activeRequirements: 0, isActive: true });
  });
});
