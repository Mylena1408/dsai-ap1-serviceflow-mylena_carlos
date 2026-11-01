import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, NotFoundError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-01-permissoes-configuraveis, section 5.3.1 (SF-089; CA-PER-04 and 05).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { grantPermission, revokePermission } from "@/modules/permissions";
import { createService, listServices, setServiceActive, updateService } from "@/modules/services";
import { createDocumentRequirement, listDocumentRequirements } from "@/modules/document-requirements";
import { createServiceField, listServiceFields, updateServiceField } from "@/modules/service-fields";
import { createServiceStage, listServiceStages } from "@/modules/service-stages";
import { listCategoriesForCatalog } from "@/modules/categories";
import { listSectorsForCatalog } from "@/modules/sectors";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const own = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const foreign = await createDomainService({ categoryId: category.id, sectorId: otherSector.id });
  actAs(admin);
  await grantPermission({ userId: ana.id, permission: "SECTOR_SERVICES" }, prisma);
  await grantPermission({ userId: gabi.id, permission: "SECTOR_SERVICES" }, prisma);
  return { sector, otherSector, category, admin, ana, gabi, bia, own, foreign };
}

const field = { label: "Patrimônio", helpText: null, type: "SHORT_TEXT", isRequired: true, options: [], minValue: null, maxValue: null };

describe("sector services with permission (SF-089)", () => {
  it("lets a holder create and edit services of the own sector only (CA-PER-05)", async () => {
    const { sector, otherSector, category, ana, own, foreign } = await scenario();
    actAs(ana);
    const base = { description: "Do setor", categoryId: category.id };

    const created = await createService({ name: `Novo ${sector.id}`, ...base, sectorId: sector.id, slaHours: "4" }, prisma);
    expect(created).toMatchObject({ sectorId: sector.id, slaHours: 4 });
    await expect(
      createService({ name: `Outro ${sector.id}`, ...base, sectorId: otherSector.id }, prisma),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      updateService(own.id, { name: own.name, ...base, sectorId: sector.id, requiresApproval: true }, prisma),
    ).resolves.toMatchObject({ requiresApproval: true });
    await expect(
      updateService(own.id, { name: own.name, ...base, sectorId: otherSector.id }, prisma),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateService(foreign.id, { name: foreign.name, ...base, sectorId: otherSector.id }, prisma),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(setServiceActive(foreign.id, false, prisma)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setServiceActive(own.id, false, prisma)).resolves.toMatchObject({ isActive: false });

    const listed = (await listServices(prisma)).map(({ id }) => id);
    expect(listed).toContain(own.id);
    expect(listed).toContain(created.id);
    expect(listed).not.toContain(foreign.id);
    await expect(listSectorsForCatalog(prisma)).resolves.toEqual([expect.objectContaining({ id: sector.id })]);
    await expect(listCategoriesForCatalog(prisma)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: category.id })]),
    );
  });

  it("lets a holder configure documents, fields and stages of the own services only (CA-PER-05)", async () => {
    const { gabi, own, foreign } = await scenario();
    actAs(gabi);

    await createDocumentRequirement(own.id, { name: "Orçamento", isRequired: true, acceptedFormats: ["PDF"] }, prisma);
    const created = await createServiceField(own.id, field, prisma);
    await updateServiceField(created.id, { ...field, label: "Número do patrimônio" }, prisma);
    await createServiceStage(own.id, { name: "Triagem" }, prisma);

    await expect(
      createDocumentRequirement(foreign.id, { name: "X", isRequired: true, acceptedFormats: ["PDF"] }, prisma),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(createServiceField(foreign.id, field, prisma)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createServiceStage(foreign.id, { name: "Triagem" }, prisma)).rejects.toBeInstanceOf(NotFoundError);

    expect((await listDocumentRequirements(prisma)).every(({ serviceId }) => serviceId === own.id)).toBe(true);
    expect((await listServiceFields(prisma)).map(({ label }) => label)).toEqual(["Número do patrimônio"]);
    expect((await listServiceStages(prisma)).map(({ name }) => name)).toEqual(["Triagem"]);
  });

  it("refuses items of other sectors even by their identifier (CA-PER-05)", async () => {
    const { admin, ana, foreign } = await scenario();
    actAs(admin);
    const foreignField = await createServiceField(foreign.id, field, prisma);

    actAs(ana);
    await expect(updateServiceField(foreignField.id, field, prisma)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses people without the permission and stops at once after a revocation (CA-PER-04)", async () => {
    const { sector, category, admin, ana, bia, own } = await scenario();

    actAs(bia);
    await expect(listServices(prisma)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(createServiceStage(own.id, { name: "Triagem" }, prisma)).rejects.toBeInstanceOf(AuthorizationError);

    actAs(admin);
    await revokePermission({ userId: ana.id, permission: "SECTOR_SERVICES" }, prisma);
    actAs(ana);
    await expect(
      createService({ name: `Depois ${sector.id}`, description: "x", categoryId: category.id, sectorId: sector.id }, prisma),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("follows the holder to a new sector (CA-PER-04)", async () => {
    const { otherSector, ana, own, foreign } = await scenario();
    await prisma.user.update({ where: { id: ana.id }, data: { sectorId: otherSector.id } });
    actAs({ ...ana, sectorId: otherSector.id });

    await expect(createServiceStage(own.id, { name: "Triagem" }, prisma)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createServiceStage(foreign.id, { name: "Triagem" }, prisma)).resolves.toMatchObject({ name: "Triagem" });
  });

  it("keeps the administrator able to configure every sector", async () => {
    const { admin, own, foreign } = await scenario();
    actAs(admin);

    await expect(createServiceStage(own.id, { name: "A" }, prisma)).resolves.toBeTruthy();
    await expect(createServiceStage(foreign.id, { name: "B" }, prisma)).resolves.toBeTruthy();
    expect((await listServices(prisma)).length).toBeGreaterThanOrEqual(2);
  });
});
