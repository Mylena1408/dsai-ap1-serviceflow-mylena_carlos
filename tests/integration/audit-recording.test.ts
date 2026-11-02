import { describe, expect, it, vi } from "vitest";
import type { AuditEntityType, User } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-02-auditoria-lgpd, 5.1 (SF-103; CA-AUD-02 and CA-AUD-03): every administrative
// change of the table is recorded once, in the same transaction, with the changed fields.

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createCategory, setCategoryActive, updateCategory } from "@/modules/categories";
import {
  createDocumentRequirement,
  deactivateDocumentRequirement,
  moveDocumentRequirement,
  updateDocumentRequirement,
} from "@/modules/document-requirements";
import { createSector, setSectorActive, updateSector } from "@/modules/sectors";
import {
  createServiceField,
  deactivateServiceField,
  moveServiceField,
  reactivateServiceField,
  updateServiceField,
} from "@/modules/service-fields";
import {
  createServiceStage,
  deactivateServiceStage,
  moveServiceStage,
  reactivateServiceStage,
  renameServiceStage,
} from "@/modules/service-stages";
import { createService, setServiceActive, updateService } from "@/modules/services";
import { createUser, setUserActive, updateUser } from "@/modules/users";

function actAs(user: Pick<User, "id" | "name" | "email" | "role" | "sectorId" | "isActive">) {
  session.getCurrentUser.mockResolvedValue({ ...user });
}

async function admin() {
  const user = await createDomainUser({ role: "ADMIN" });
  actAs(user);
  return user;
}

async function entries(entityType: AuditEntityType, entityId?: string) {
  return prisma.auditEntry.findMany({
    where: { entityType, ...(entityId ? { entityId } : {}) },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
}

const actions = async (entityType: AuditEntityType, entityId?: string) =>
  (await entries(entityType, entityId)).map((entry) => entry.action);

const textField = {
  label: "Patrimônio",
  helpText: null,
  type: "SHORT_TEXT",
  isRequired: false,
  options: [],
  minValue: null,
  maxValue: null,
};

describe("audit of sectors and categories (SF-103)", () => {
  it("records creation, renaming, deactivation and reactivation of a sector, with who did it", async () => {
    const actor = await admin();

    const sector = await createSector({ name: "Infraestrutura" }, prisma);
    await updateSector(sector.id, { name: "Infraestrutura predial" }, prisma);
    await updateSector(sector.id, { name: "Infraestrutura predial" }, prisma); // no change, no entry
    await setSectorActive(sector.id, false, prisma);
    await setSectorActive(sector.id, true, prisma);

    const recorded = await entries("SECTOR", sector.id);
    expect(recorded.map((entry) => entry.action)).toEqual(["CREATED", "UPDATED", "DEACTIVATED", "REACTIVATED"]);
    expect(recorded[0]).toMatchObject({
      actorId: actor.id,
      actorRole: "ADMIN",
      entityLabel: "Infraestrutura",
      changes: [
        { field: "name", before: null, after: "Infraestrutura" },
        { field: "isActive", before: null, after: true },
      ],
    });
    expect(recorded[1]).toMatchObject({
      entityLabel: "Infraestrutura predial",
      changes: [{ field: "name", before: "Infraestrutura", after: "Infraestrutura predial" }],
    });
    expect(recorded[2].changes).toEqual([{ field: "isActive", before: true, after: false }]);
  });

  it("records nothing when the change is refused (CA-AUD-02)", async () => {
    await admin();
    const category = await createCategory({ name: "Manutenção" }, prisma);
    await createDomainService({ categoryId: category.id, sectorId: (await createDomainSector()).id });

    // A category with an active service cannot be deactivated.
    await expect(setCategoryActive(category.id, false, prisma)).rejects.toBeInstanceOf(ConflictError);
    await updateCategory(category.id, { name: "Manutenção predial" }, prisma);

    await expect(actions("CATEGORY", category.id)).resolves.toEqual(["CREATED", "UPDATED"]);
  });
});

describe("audit of users (SF-103; CA-AUD-03)", () => {
  it("records role, sector and activity with values, but name and e-mail only as changed", async () => {
    await admin();
    const sectorA = await createDomainSector();
    const sectorB = await createDomainSector();

    const user = await createUser(
      { name: "Carla Mendes", email: "carla.mendes@exemplo.test", password: "Senha-de-teste-1", role: "REQUESTER", sectorId: null },
      prisma,
    );
    await updateUser(
      user.id,
      { name: "Carla M. Souza", email: "carla.souza@exemplo.test", role: "ATTENDANT", sectorId: sectorA.id },
      prisma,
    );
    // A new password alone changes no audited field.
    await updateUser(
      user.id,
      { name: "Carla M. Souza", email: "carla.souza@exemplo.test", password: "Outra-senha-2", role: "ATTENDANT", sectorId: sectorA.id },
      prisma,
    );
    await updateUser(
      user.id,
      { name: "Carla M. Souza", email: "carla.souza@exemplo.test", role: "ATTENDANT", sectorId: sectorB.id },
      prisma,
    );
    await setUserActive(user.id, false, prisma);

    const recorded = await entries("USER", user.id);
    expect(recorded.map((entry) => entry.action)).toEqual(["CREATED", "UPDATED", "UPDATED", "DEACTIVATED"]);
    expect(recorded[0].changes).toEqual([
      { field: "name", personal: true },
      { field: "email", personal: true },
      { field: "role", before: null, after: "REQUESTER" },
      { field: "isActive", before: null, after: true },
    ]);
    expect(recorded[1].changes).toEqual([
      { field: "name", personal: true },
      { field: "email", personal: true },
      { field: "role", before: "REQUESTER", after: "ATTENDANT" },
      { field: "sectorId", before: null, after: sectorA.id },
    ]);
    expect(recorded[2].changes).toEqual([{ field: "sectorId", before: sectorA.id, after: sectorB.id }]);

    const text = JSON.stringify(recorded.map((entry) => entry.changes));
    for (const secret of ["carla.mendes", "carla.souza", "Senha-de-teste", "Outra-senha", "argon2"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("audit of services and their configuration (SF-103)", () => {
  async function service() {
    const category = await createDomainCategory();
    const sector = await createDomainSector();
    return { category, sector, service: await createDomainService({ categoryId: category.id, sectorId: sector.id }) };
  }

  it("records the service configuration, including SLA and approval", async () => {
    await admin();
    const category = await createDomainCategory();
    const sector = await createDomainSector();
    const base = { name: "Reparo elétrico", description: "Tomadas e iluminação", categoryId: category.id, sectorId: sector.id };

    const created = await createService(base, prisma);
    await updateService(created.id, { ...base, slaHours: 24, requiresApproval: true, defaultPriority: "HIGH" }, prisma);
    await setServiceActive(created.id, false, prisma);

    const recorded = await entries("SERVICE", created.id);
    expect(recorded.map((entry) => entry.action)).toEqual(["CREATED", "UPDATED", "DEACTIVATED"]);
    expect(recorded[1].changes).toEqual([
      { field: "defaultPriority", before: "NORMAL", after: "HIGH" },
      { field: "slaHours", before: null, after: 24 },
      { field: "requiresApproval", before: false, after: true },
    ]);
  });

  it("records documents, fields and stages, one entry per move for the moved item", async () => {
    await admin();
    const { service: target } = await service();

    const first = await createDocumentRequirement(target.id, { name: "RG", isRequired: true, acceptedFormats: ["PDF"] }, prisma);
    const second = await createDocumentRequirement(target.id, { name: "CPF", isRequired: false, acceptedFormats: ["PDF"] }, prisma);
    await updateDocumentRequirement(second.id, { name: "CPF", isRequired: true, acceptedFormats: ["PDF", "TXT"] }, prisma);
    await moveDocumentRequirement(second.id, "up", prisma);
    await moveDocumentRequirement(second.id, "up", prisma); // already first: nothing moves, nothing recorded
    await deactivateDocumentRequirement(first.id, prisma);

    await expect(actions("DOCUMENT_REQUIREMENT", second.id)).resolves.toEqual(["CREATED", "UPDATED", "REORDERED"]);
    const [, updated, moved] = await entries("DOCUMENT_REQUIREMENT", second.id);
    expect(updated.changes).toEqual([
      { field: "isRequired", before: false, after: true },
      { field: "acceptedFormats", before: ["PDF"], after: ["PDF", "TXT"] },
    ]);
    expect(moved.changes).toEqual([{ field: "position", before: 1, after: 0 }]);
    await expect(actions("DOCUMENT_REQUIREMENT", first.id)).resolves.toEqual(["CREATED", "DEACTIVATED"]);

    const field = await createServiceField(target.id, textField, prisma);
    const other = await createServiceField(target.id, { ...textField, label: "Sala" }, prisma);
    await updateServiceField(field.id, { ...textField, label: "Número do patrimônio", helpText: "Etiqueta" }, prisma);
    await moveServiceField(other.id, "up", prisma);
    await deactivateServiceField(field.id, prisma);
    await deactivateServiceField(field.id, prisma); // already inactive
    await reactivateServiceField(field.id, prisma);

    await expect(actions("SERVICE_FIELD", field.id)).resolves.toEqual(["CREATED", "UPDATED", "DEACTIVATED", "REACTIVATED"]);
    await expect(actions("SERVICE_FIELD", other.id)).resolves.toEqual(["CREATED", "REORDERED"]);
    expect((await entries("SERVICE_FIELD", field.id))[1].changes).toEqual([
      { field: "label", before: "Patrimônio", after: "Número do patrimônio" },
      { field: "helpText", before: null, after: "Etiqueta" },
    ]);

    const stage = await createServiceStage(target.id, { name: "Triagem" }, prisma);
    const next = await createServiceStage(target.id, { name: "Execução" }, prisma);
    await renameServiceStage(stage.id, { name: "Análise" }, prisma);
    await moveServiceStage(next.id, "up", prisma);
    await deactivateServiceStage(stage.id, prisma);
    await reactivateServiceStage(stage.id, prisma);

    await expect(actions("SERVICE_STAGE", stage.id)).resolves.toEqual(["CREATED", "UPDATED", "DEACTIVATED", "REACTIVATED"]);
    await expect(actions("SERVICE_STAGE", next.id)).resolves.toEqual(["CREATED", "REORDERED"]);
  });

  it("records changes by a holder of \"Gerir serviços do setor\" with the attendant profile", async () => {
    const administrator = await createDomainUser({ role: "ADMIN" });
    const { service: target, sector } = await service();
    const attendant = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    await prisma.userPermission.create({
      data: { userId: attendant.id, permission: "SECTOR_SERVICES", grantedById: administrator.id, grantedAt: new Date() },
    });
    actAs(attendant);

    const stage = await createServiceStage(target.id, { name: "Triagem" }, prisma);

    await expect(entries("SERVICE_STAGE", stage.id)).resolves.toMatchObject([
      { actorId: attendant.id, actorRole: "ATTENDANT", action: "CREATED", entityLabel: "Triagem" },
    ]);
  });
});
