import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 6.3 items 1 to 3 (SF-187; CA-CFG-01 for the export and CA-CFG-02).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { CONFIGURATION_ENTITY_ID, configurationFileSchema, exportConfiguration } from "@/modules/configuration";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

/** Every internal id of the configuration and of the people (the fixtures' names hold random UUIDs, not ids). */
async function internalIds(): Promise<string[]> {
  const rows = await Promise.all([
    prisma.sector.findMany({ select: { id: true } }),
    prisma.category.findMany({ select: { id: true } }),
    prisma.service.findMany({ select: { id: true } }),
    prisma.serviceField.findMany({ select: { id: true } }),
    prisma.serviceStage.findMany({ select: { id: true } }),
    prisma.serviceDocumentRequirement.findMany({ select: { id: true } }),
    prisma.knowledgeArticle.findMany({ select: { id: true } }),
    prisma.cannedResponse.findMany({ select: { id: true } }),
    prisma.sectorEscalationRule.findMany({ select: { id: true } }),
    prisma.accessRole.findMany({ select: { id: true } }),
    prisma.businessHoliday.findMany({ select: { id: true } }),
    prisma.serviceBundle.findMany({ select: { id: true } }),
    prisma.user.findMany({ select: { id: true } }),
  ]);
  return rows.flat().map(({ id }) => id);
}

async function scenario() {
  const sector = await createDomainSector();
  const other = await createDomainSector(false);
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const diego = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });

  const system = await prisma.serviceField.create({
    data: { serviceId: service.id, label: "Sistema", type: "SELECT", isRequired: true, options: ["ERP", "CRM"], position: 1 },
  });
  await prisma.serviceField.create({
    data: {
      serviceId: service.id,
      label: "Valor",
      type: "DECIMAL",
      isRequired: false,
      options: [],
      decimalPlaces: 2,
      minDecimal: "0.5",
      maxDecimal: "100",
      position: 2,
      conditionFieldId: system.id,
      conditionValue: "ERP",
    },
  });
  await prisma.service.update({
    where: { id: service.id },
    data: { requiresApproval: true, approvalSectorIds: [other.id], approvalConditionFieldId: system.id, approvalConditionValue: "ERP", slaHours: 8 },
  });
  await prisma.serviceDocumentRequirement.create({ data: { serviceId: service.id, name: "Termo", isRequired: true, acceptedFormats: ["PDF"], position: 1 } });
  await prisma.serviceStage.create({ data: { serviceId: service.id, name: "Liberação", position: 1, assigneeId: diego.id, targetDays: 2 } });
  await prisma.knowledgeArticle.create({
    data: { serviceId: service.id, title: "Como pedir", body: "Informe o sistema.", isPublished: true, position: 1, createdById: admin.id, updatedById: admin.id, createdAt: new Date(), updatedAt: new Date() },
  });
  await prisma.cannedResponse.create({
    data: { sectorId: sector.id, title: "Senha", body: "Use o portal.", createdById: admin.id, updatedById: admin.id, createdAt: new Date(), updatedAt: new Date() },
  });
  await prisma.sectorEscalationRule.create({
    data: { sectorId: sector.id, name: "Atraso", trigger: "OVERDUE_DAYS", overdueDays: 2, raisePriority: true, assignToId: diego.id, notifyUserIds: [diego.id] },
  });
  const tag = Math.random().toString(36).slice(2, 10);
  await prisma.accessRole.create({ data: { name: `Supervisão ${tag}`, permissions: ["QUEUE_SUPERVISION"] } });
  await prisma.businessHoliday.create({ data: { day: new Date("2026-12-25T00:00:00Z"), name: "Natal", yearly: true, createdById: admin.id } });
  const second = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  await prisma.serviceBundle.create({ data: { name: `Pacote ${tag}`, serviceIds: [second.id, service.id] } });
  // What never goes into the file: people, tokens, webhooks and requests.
  await prisma.webhookEndpoint.create({ data: { name: "Integração", url: "https://hooks.example.test/segredo", eventTypes: ["request.opened"], encryptedSecret: "segredo-cifrado" } });

  return { sector, other, category, service, second, admin, diego, rita, tag };
}

describe("exporting the configuration (6.3 items 1 to 3)", () => {
  it("only the administrator exports; the export enters the audit trail (CA-CFG-01)", async () => {
    const { admin, diego, rita } = await scenario();
    for (const person of [diego, rita]) {
      actAs(person);
      await expect(exportConfiguration(prisma)).rejects.toBeInstanceOf(AuthorizationError);
    }
    expect(await prisma.auditEntry.count({ where: { entityType: "CONFIGURATION" } })).toBe(0);

    actAs(admin);
    await exportConfiguration(prisma);
    expect(await prisma.auditEntry.findMany({ where: { entityType: "CONFIGURATION" } })).toEqual([
      expect.objectContaining({
        action: "EXPORTED_CONFIGURATION",
        actorId: admin.id,
        actorRole: "ADMIN",
        entityId: CONFIGURATION_ENTITY_ID,
        entityLabel: "Configuração da organização",
        changes: [],
      }),
    ]);
  });

  it("follows the format with every configuration, by names and e-mails, without people, secrets or ids (CA-CFG-02)", async () => {
    const { admin, sector, other, category, service, second, diego, rita, tag } = await scenario();
    actAs(admin);
    const result = await exportConfiguration(prisma);

    const ids = await internalIds();
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) expect(result.content).not.toContain(id);
    for (const forbidden of [admin.name, rita.name, rita.email, diego.name, "segredo", "hooks.example.test", "passwordHash"]) {
      expect(result.content).not.toContain(forbidden);
    }
    const file = configurationFileSchema.parse(JSON.parse(result.content));
    expect(result).toMatchObject({ repeated: [], tooLarge: false });

    expect(file.data.sectors.find(({ name }) => name === sector.name)).toMatchObject({
      isActive: true,
      escalationRules: [{ name: "Atraso", trigger: "OVERDUE_DAYS", overdueDays: 2, assignTo: diego.email, notify: [diego.email] }],
      cannedResponses: [{ title: "Senha", body: "Use o portal.", isActive: true }],
    });
    expect(file.data.sectors.find(({ name }) => name === other.name)).toMatchObject({ isActive: false });
    expect(file.data.categories).toContainEqual({ name: category.name, isActive: true });

    const exported = file.data.services.find(({ name }) => name === service.name);
    expect(exported).toMatchObject({
      category: category.name,
      sector: sector.name,
      requiresApproval: true,
      approvalSectors: [other.name],
      approvalCondition: { field: "Sistema", value: "ERP" },
      slaHours: 8,
      documents: [{ name: "Termo", isRequired: true, acceptedFormats: ["PDF"], position: 1, isActive: true }],
      stages: [{ name: "Liberação", assignee: diego.email, targetDays: 2, condition: null }],
      articles: [{ title: "Como pedir", isPublished: true }],
    });
    expect(exported?.fields).toEqual([
      expect.objectContaining({ label: "Sistema", type: "SELECT", options: ["ERP", "CRM"], condition: null }),
      expect.objectContaining({ label: "Valor", type: "DECIMAL", decimalPlaces: 2, minDecimal: "0.50", maxDecimal: "100.00", condition: { field: "Sistema", value: "ERP" } }),
    ]);
    expect(file.data.accessRoles).toContainEqual({ name: `Supervisão ${tag}`, description: null, permissions: ["QUEUE_SUPERVISION"], isActive: true });
    expect(file.data.holidays).toContainEqual({ day: "2026-12-25", name: "Natal", yearly: true });
    expect(file.data.bundles).toContainEqual({ name: `Pacote ${tag}`, description: null, services: [second.name, service.name], isActive: true });
  });

  it("the same configuration gives the same data; repeated names are reported", async () => {
    const { admin, category, sector } = await scenario();
    actAs(admin);
    const first = JSON.parse((await exportConfiguration(prisma)).content);
    const second = JSON.parse((await exportConfiguration(prisma)).content);
    expect(second.data).toEqual(first.data);

    await createDomainService({ categoryId: category.id, sectorId: sector.id });
    const services = await prisma.service.findMany({ select: { id: true } });
    await prisma.service.updateMany({ where: { id: { in: services.map(({ id }) => id) } }, data: { name: "Serviço repetido" } });
    expect((await exportConfiguration(prisma)).repeated).toEqual(["serviços: Serviço repetido"]);
  });
});
