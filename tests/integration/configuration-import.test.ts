import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, ConflictError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 6.3 items 5 and 6 (SF-189; CA-CFG-04 and 05).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { applyConfigurationImport, exportConfiguration, previewConfigurationImport, type ConfigurationFile } from "@/modules/configuration";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const sector = await createDomainSector();
  const other = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const second = await createDomainService({ categoryId: category.id, sectorId: other.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const diego = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const system = await prisma.serviceField.create({
    data: { serviceId: service.id, label: "Sistema", type: "SELECT", isRequired: true, options: ["ERP", "CRM"], position: 1 },
  });
  await prisma.serviceField.create({
    data: { serviceId: service.id, label: "Valor", type: "DECIMAL", isRequired: false, options: [], decimalPlaces: 2, minDecimal: "0.5", maxDecimal: "100", position: 2, conditionFieldId: system.id, conditionValue: "ERP" },
  });
  await prisma.service.update({
    where: { id: service.id },
    data: { requiresApproval: true, approvalSectorIds: [other.id], approvalConditionFieldId: system.id, approvalConditionValue: "ERP", approvalDeadlineDays: 3, slaHours: 8 },
  });
  await prisma.serviceDocumentRequirement.create({ data: { serviceId: second.id, name: "Termo", isRequired: false, acceptedFormats: ["PDF"], position: 1, isActive: false } });
  await prisma.serviceStage.create({ data: { serviceId: service.id, name: "Liberação", position: 1, assigneeId: diego.id, targetDays: 2, conditionFieldId: system.id, conditionValue: "CRM" } });
  await prisma.knowledgeArticle.create({
    data: { serviceId: service.id, title: "Como pedir", body: "Informe o sistema.", isPublished: true, position: 1, createdById: admin.id, updatedById: admin.id, createdAt: new Date(), updatedAt: new Date() },
  });
  await prisma.cannedResponse.create({ data: { sectorId: sector.id, title: "Senha", body: "Use o portal.", createdById: admin.id, updatedById: admin.id, createdAt: new Date(), updatedAt: new Date() } });
  await prisma.sectorEscalationRule.create({ data: { sectorId: sector.id, name: "Atraso", trigger: "OVERDUE_DAYS", overdueDays: 2, raisePriority: true, assignToId: diego.id, notifyUserIds: [diego.id] } });
  await prisma.accessRole.create({ data: { name: "Supervisão da fila", permissions: ["QUEUE_SUPERVISION"] } });
  await prisma.businessCalendar.upsert({ where: { id: 1 }, create: { id: 1, weekdays: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 1080, timeZone: "America/Sao_Paulo" }, update: {} });
  await prisma.businessHoliday.create({ data: { day: new Date("2026-12-25T00:00:00Z"), name: "Natal", yearly: true, createdById: admin.id } });
  await prisma.serviceBundle.create({ data: { name: "Admissão", serviceIds: [second.id, service.id] } });
  actAs(admin);
  const content = (await exportConfiguration(prisma)).content;
  return { sector, other, category, service, second, admin, diego, content, file: JSON.parse(content) as ConfigurationFile };
}

async function previewAndApply(content: string) {
  const preview = await previewConfigurationImport(content, prisma);
  expect(preview.problems).toEqual([]);
  return applyConfigurationImport({ content, digest: preview.digest, destinationDigest: preview.destinationDigest }, prisma);
}

/** Removes every configuration row (people stay), as a database without configuration. */
async function emptyConfiguration() {
  await prisma.serviceBundle.deleteMany();
  await prisma.knowledgeArticle.deleteMany();
  await prisma.cannedResponse.deleteMany();
  await prisma.sectorEscalationRule.deleteMany();
  await prisma.serviceStage.deleteMany();
  await prisma.serviceDocumentRequirement.deleteMany();
  await prisma.service.updateMany({ data: { approvalConditionFieldId: null, approvalConditionValue: null } });
  await prisma.serviceField.updateMany({ data: { conditionFieldId: null, conditionValue: null } });
  await prisma.serviceField.deleteMany();
  await prisma.service.deleteMany();
  await prisma.category.deleteMany();
  // Attendants and managers need a sector: they become requesters until the sectors exist again.
  await prisma.user.updateMany({ where: { sectorId: { not: null } }, data: { role: "REQUESTER", sectorId: null } });
  await prisma.sector.deleteMany();
  await prisma.accessRole.deleteMany();
  await prisma.businessHoliday.deleteMany();
  await prisma.businessCalendar.deleteMany();
}

describe("applying an import (6.3 items 5 and 6)", () => {
  it("importing back the exported file gives equal everywhere and writes nothing but the import's entry (CA-CFG-05)", async () => {
    const { content, admin } = await scenario();
    const audits = await prisma.auditEntry.count();

    await expect(previewAndApply(content)).resolves.toMatchObject({ new: 0, changed: 0 });
    expect(await prisma.auditEntry.count()).toBe(audits + 1);
    const entry = await prisma.auditEntry.findFirstOrThrow({ where: { action: "IMPORTED" } });
    expect(entry).toMatchObject({ actorId: admin.id, entityType: "CONFIGURATION", entityLabel: "Configuração da organização" });
    expect(entry.changes).toEqual([
      { field: "itemsCreated", before: null, after: 0 },
      { field: "itemsUpdated", before: null, after: 0 },
      { field: "itemsUnchanged", before: null, after: expect.any(Number) },
    ]);
  });

  it("an empty configuration is rebuilt exactly from the file, each item audited as on its screen (CA-CFG-05)", async () => {
    const { content, file, sector, diego, admin } = await scenario();
    await emptyConfiguration();
    // The attendant keeps the sector by name in the new database.
    const summary = await (async () => {
      const preview = await previewConfigurationImport(content, prisma);
      expect(preview.summary.changed).toBe(0);
      return applyConfigurationImport({ content, digest: preview.digest, destinationDigest: preview.destinationDigest }, prisma);
    })();
    expect(summary).toMatchObject({ changed: 0, equal: 0 });
    expect(summary.new).toBeGreaterThan(10);

    // The people kept their e-mails: put the attendant back in the rebuilt sector and export again.
    const rebuilt = await prisma.sector.findFirstOrThrow({ where: { name: sector.name } });
    await prisma.user.update({ where: { id: diego.id }, data: { role: "ATTENDANT", sectorId: rebuilt.id } });
    const again = JSON.parse((await exportConfiguration(prisma)).content) as ConfigurationFile;
    // The attendant was not in the sector during the import, so the stage and the rule came without them.
    const expected = structuredClone(file.data);
    const own = expected.sectors.find(({ name }) => name === sector.name)!;
    own.escalationRules[0] = { ...own.escalationRules[0], assignTo: null, notify: [] };
    for (const item of expected.services) for (const stage of item.stages) stage.assignee = null;
    expect(again.data).toEqual(expected);

    const created = await prisma.auditEntry.groupBy({ by: ["entityType"], where: { action: "CREATED", actorId: admin.id }, _count: true });
    expect(new Set(created.map(({ entityType }) => entityType))).toEqual(
      new Set(["SECTOR", "CATEGORY", "SERVICE", "SERVICE_FIELD", "DOCUMENT_REQUIREMENT", "SERVICE_STAGE", "KNOWLEDGE_ARTICLE", "ESCALATION_RULE", "ACCESS_ROLE", "HOLIDAY", "SERVICE_BUNDLE"]),
    );
    // The calendar is saved; it equals the default that applies without a row, so, as on its screen, the
    // audit trail has nothing to record.
    expect(await prisma.businessCalendar.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ startMinute: 480, endMinute: 1080, updatedById: admin.id });
  });

  it("applies new and changed items and leaves what the file does not have (CA-CFG-04)", async () => {
    const { file, service, second } = await scenario();
    file.data.services = file.data.services.filter(({ name }) => name === service.name);
    file.data.services[0].description = "Descrição importada";
    file.data.services[0].fields.push({ ...file.data.services[0].fields[0], label: "Módulo", type: "SHORT_TEXT", options: [], position: 3, condition: { field: "Sistema", value: "CRM" } });
    file.data.categories.push({ name: "Categoria importada", isActive: true });
    file.data.bundles = [];
    const content = JSON.stringify(file);

    await expect(previewAndApply(content)).resolves.toMatchObject({ new: 2, changed: 1 });
    expect(await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).toMatchObject({ description: "Descrição importada" });
    // Not in the file: kept as it was.
    expect(await prisma.service.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ isActive: true });
    expect(await prisma.serviceBundle.count()).toBe(1);
    const created = await prisma.serviceField.findFirstOrThrow({ where: { serviceId: service.id, label: "Módulo" } });
    const controller = await prisma.serviceField.findFirstOrThrow({ where: { serviceId: service.id, label: "Sistema" } });
    expect(created).toMatchObject({ type: "SHORT_TEXT", conditionFieldId: controller.id, conditionValue: "CRM" });
    expect(await prisma.category.count({ where: { name: "Categoria importada" } })).toBe(1);
    expect(await prisma.auditEntry.findFirst({ where: { entityType: "SERVICE", entityId: service.id, action: "UPDATED" } })).toMatchObject({
      changes: expect.arrayContaining([expect.objectContaining({ field: "description", after: "Descrição importada" })]),
    });
  });

  it("refuses another file or a destination changed after the preview, and someone who is not the administrator (CA-CFG-01 and 04)", async () => {
    const { content, category, diego } = await scenario();
    const preview = await previewConfigurationImport(content, prisma);

    await expect(applyConfigurationImport({ content: `${content} `, digest: preview.digest, destinationDigest: preview.destinationDigest }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await prisma.category.update({ where: { id: category.id }, data: { name: `${category.name} alterada` } });
    await expect(applyConfigurationImport({ content, digest: preview.digest, destinationDigest: preview.destinationDigest }, prisma)).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.auditEntry.count({ where: { action: "IMPORTED" } })).toBe(0);

    actAs(diego);
    await expect(applyConfigurationImport({ content, digest: preview.digest, destinationDigest: preview.destinationDigest }, prisma)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("is all or nothing: a failure in the last write leaves nothing (CA-CFG-04)", async () => {
    const { file } = await scenario();
    file.data.sectors.push({ ...file.data.sectors[0], name: "Setor importado", escalationRules: [], cannedResponses: [] });
    file.data.holidays.push({ day: "2027-01-01", name: "Falha provocada", yearly: false });
    const content = JSON.stringify(file);
    const preview = await previewConfigurationImport(content, prisma);
    expect(preview.accepted).toBe(true);

    // A test-only trigger refuses the holiday, written after everything else.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION test_refuse_holiday() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW."name" = 'Falha provocada' THEN RAISE EXCEPTION 'refused by the test'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER test_refuse_holiday BEFORE INSERT ON "BusinessHoliday" FOR EACH ROW EXECUTE FUNCTION test_refuse_holiday()`);
    try {
      await expect(applyConfigurationImport({ content, digest: preview.digest, destinationDigest: preview.destinationDigest }, prisma)).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER test_refuse_holiday ON "BusinessHoliday"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION test_refuse_holiday()`);
    }
    expect(await prisma.sector.count({ where: { name: "Setor importado" } })).toBe(0);
    expect(await prisma.auditEntry.count({ where: { OR: [{ action: "IMPORTED" }, { entityLabel: "Setor importado" }] } })).toBe(0);
  });
});
