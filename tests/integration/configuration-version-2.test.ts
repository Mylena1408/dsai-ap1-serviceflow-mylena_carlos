import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-08-atendimento-dia-a-dia, 9.1 item 1 (SF-220; decision I19; CA-CMP-01): the portable
// configuration's version 2 exports and imports the sectors' tags and the services' checklist models with the
// rules of SPEC 2026-11-07-operacao-e-automacao, part D; a version 1 file is still accepted.

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
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const system = await prisma.serviceField.create({
    data: { serviceId: service.id, label: "Sistema", type: "SELECT", isRequired: true, options: ["ERP", "CRM"], position: 1 },
  });
  const urgent = await prisma.sectorTag.create({ data: { sectorId: sector.id, name: "Urgente", color: "red" } });
  const old = await prisma.sectorTag.create({ data: { sectorId: sector.id, name: "Antiga", color: "gray", isActive: false } });
  const check = await prisma.serviceChecklistItem.create({ data: { serviceId: service.id, text: "Conferir backup", isRequired: true, position: 1 } });
  const test = await prisma.serviceChecklistItem.create({
    data: { serviceId: service.id, text: "Testar acesso", isRequired: false, position: 2, conditionFieldId: system.id, conditionValue: "ERP" },
  });
  actAs(admin);
  const content = (await exportConfiguration(prisma)).content;
  return { sector, category, service, admin, system, urgent, old, check, test, content, file: JSON.parse(content) as ConfigurationFile };
}

async function previewAndApply(content: string) {
  const preview = await previewConfigurationImport(content, prisma);
  expect(preview.problems).toEqual([]);
  return applyConfigurationImport({ content, digest: preview.digest, destinationDigest: preview.destinationDigest }, prisma);
}

const tagsOf = (sectorId: string) => prisma.sectorTag.findMany({ where: { sectorId }, orderBy: { name: "asc" } });
const checklistOf = (serviceId: string) => prisma.serviceChecklistItem.findMany({ where: { serviceId }, orderBy: { position: "asc" } });

describe("the portable configuration's version 2 (CA-CMP-01)", () => {
  it("exports the sectors' tags and the services' checklists, without ids", async () => {
    const { content, file, sector, service, system, urgent, check } = await scenario();
    expect(file.version).toBe(2);
    for (const id of [system.id, urgent.id, check.id]) expect(content).not.toContain(id);
    expect(file.data.sectors.find(({ name }) => name === sector.name)?.tags).toEqual([
      { name: "Antiga", color: "gray", isActive: false },
      { name: "Urgente", color: "red", isActive: true },
    ]);
    expect(file.data.services.find(({ name }) => name === service.name)?.checklist).toEqual([
      { text: "Conferir backup", isRequired: true, position: 1, isActive: true, condition: null },
      { text: "Testar acesso", isRequired: false, position: 2, isActive: true, condition: { field: "Sistema", value: "ERP" } },
    ]);
  });

  it("importing back the exported file gives equal everywhere and writes nothing but the import's entry", async () => {
    const { content } = await scenario();
    const preview = await previewConfigurationImport(content, prisma);
    expect(preview).toMatchObject({ accepted: true, summary: { new: 0, changed: 0 } });
    expect(preview.items.filter(({ kind }) => kind === "tag" || kind === "checklistItem")).toHaveLength(4);
    expect(preview.items.every(({ status }) => status === "equal")).toBe(true);

    const audits = await prisma.auditEntry.count();
    await expect(previewAndApply(content)).resolves.toMatchObject({ new: 0, changed: 0 });
    expect(await prisma.auditEntry.count()).toBe(audits + 1);
  });

  it("creates and updates tags and checklist items by key, with the condition by the field's label, each audited", async () => {
    const { file, sector, service, admin, system, urgent, old, check } = await scenario();
    const own = file.data.sectors.find(({ name }) => name === sector.name)!;
    // "Antiga" is left out of the file: it stays as it is.
    own.tags = [{ name: "Urgente", color: "blue", isActive: true }, { name: "Aguardando peça", color: "yellow", isActive: true }];
    const target = file.data.services.find(({ name }) => name === service.name)!;
    target.checklist = [
      { ...target.checklist![0], isRequired: false },
      target.checklist![1],
      { text: "Avisar o solicitante", isRequired: true, position: 3, isActive: true, condition: { field: "Sistema", value: "CRM" } },
    ];
    // A new service whose new field is the condition of its new checklist item.
    file.data.services.push({
      ...target,
      name: "Serviço importado",
      approvalCondition: null,
      requiresApproval: false,
      approvalSectors: [],
      fields: [{ ...target.fields[0], label: "Ambiente", options: ["Produção", "Teste"] }],
      stages: [],
      documents: [],
      articles: [],
      checklist: [{ text: "Validar ambiente", isRequired: true, position: 1, isActive: true, condition: { field: "Ambiente", value: "Produção" } }],
    });
    const content = JSON.stringify(file);

    const preview = await previewConfigurationImport(content, prisma);
    expect(preview.items.filter(({ kind, status }) => (kind === "tag" || kind === "checklistItem") && status !== "equal")).toEqual([
      { kind: "tag", label: `${sector.name} › Urgente`, status: "changed", changes: ["color"] },
      { kind: "tag", label: `${sector.name} › Aguardando peça`, status: "new", changes: [] },
      { kind: "checklistItem", label: `${service.name} › Conferir backup`, status: "changed", changes: ["isRequired"] },
      { kind: "checklistItem", label: `${service.name} › Avisar o solicitante`, status: "new", changes: [] },
      { kind: "checklistItem", label: "Serviço importado › Validar ambiente", status: "new", changes: [] },
    ]);
    await expect(previewAndApply(content)).resolves.toMatchObject({ changed: 2 });

    expect((await tagsOf(sector.id)).map(({ id, name, color, isActive }) => ({ id, name, color, isActive }))).toEqual([
      { id: expect.any(String), name: "Aguardando peça", color: "yellow", isActive: true },
      { id: old.id, name: "Antiga", color: "gray", isActive: false },
      { id: urgent.id, name: "Urgente", color: "blue", isActive: true },
    ]);
    expect(await checklistOf(service.id)).toEqual([
      expect.objectContaining({ id: check.id, isRequired: false }),
      expect.objectContaining({ text: "Testar acesso", conditionFieldId: system.id, conditionValue: "ERP" }),
      expect.objectContaining({ text: "Avisar o solicitante", isRequired: true, position: 3, conditionFieldId: system.id, conditionValue: "CRM" }),
    ]);
    const imported = await prisma.service.findFirstOrThrow({ where: { name: "Serviço importado" } });
    const environment = await prisma.serviceField.findFirstOrThrow({ where: { serviceId: imported.id, label: "Ambiente" } });
    expect(await checklistOf(imported.id)).toEqual([
      expect.objectContaining({ text: "Validar ambiente", conditionFieldId: environment.id, conditionValue: "Produção" }),
    ]);

    // Each item created or changed enters the audit trail as on its screen.
    const entries = await prisma.auditEntry.findMany({ where: { actorId: admin.id, entityType: { in: ["SECTOR_TAG", "CHECKLIST_ITEM"] } } });
    expect(entries.map(({ action, entityType, entityLabel }) => `${action} ${entityType} ${entityLabel}`).sort()).toEqual([
      "CREATED CHECKLIST_ITEM Avisar o solicitante",
      "CREATED CHECKLIST_ITEM Validar ambiente",
      "CREATED SECTOR_TAG Aguardando peça",
      "UPDATED CHECKLIST_ITEM Conferir backup",
      "UPDATED SECTOR_TAG Urgente",
    ]);
    expect(entries.find(({ entityId }) => entityId === urgent.id)?.changes).toEqual([{ field: "color", before: "red", after: "blue" }]);
  });

  it("a version 1 file is still accepted and leaves the destination's tags and checklists untouched", async () => {
    const { file, sector, service } = await scenario();
    // A file as version 1 wrote it: no tags or checklists.
    const legacy = {
      ...file,
      version: 1,
      data: {
        ...file.data,
        sectors: file.data.sectors.map((item) => {
          const copy = { ...item };
          delete copy.tags;
          return copy;
        }),
        services: file.data.services.map((item) => {
          const copy = { ...item, description: item.name === service.name ? "Descrição da versão 1" : item.description };
          delete copy.checklist;
          return copy;
        }),
      },
    };
    const tagsBefore = await tagsOf(sector.id);
    const checklistBefore = await checklistOf(service.id);

    const preview = await previewConfigurationImport(JSON.stringify(legacy), prisma);
    expect(preview.accepted).toBe(true);
    expect(preview.items.some(({ kind }) => kind === "tag" || kind === "checklistItem")).toBe(false);
    await expect(previewAndApply(JSON.stringify(legacy))).resolves.toMatchObject({ new: 0, changed: 1 });

    expect(await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).toMatchObject({ description: "Descrição da versão 1" });
    expect(await tagsOf(sector.id)).toEqual(tagsBefore);
    expect(await checklistOf(service.id)).toEqual(checklistBefore);
    expect(await prisma.auditEntry.count({ where: { entityType: { in: ["SECTOR_TAG", "CHECKLIST_ITEM"] } } })).toBe(0);
  });

  it("the preview refuses an invalid tag color and a checklist text too long, with the path, and nothing is written", async () => {
    const { file, sector, service } = await scenario();
    file.data.sectors.find(({ name }) => name === sector.name)!.tags![1].color = "pink";
    const long = "x".repeat(121);
    file.data.services.find(({ name }) => name === service.name)!.checklist!.push({ text: long, isRequired: true, position: 3, isActive: true, condition: null });
    const content = JSON.stringify(file);

    const preview = await previewConfigurationImport(content, prisma);
    expect(preview).toMatchObject({ accepted: false, items: [] });
    expect(preview.problems.map(({ path }) => path)).toEqual([`sectors › ${sector.name} › tags › Urgente › color`, `services › ${service.name} › checklist › ${long} › text`]);
    expect(preview.problems.every(({ message }) => message.length > 0)).toBe(true);
    await expect(applyConfigurationImport({ content, digest: preview.digest, destinationDigest: preview.destinationDigest }, prisma)).rejects.toThrow();
    expect((await tagsOf(sector.id)).map(({ color }) => color)).toEqual(["gray", "red"]);
    expect(await checklistOf(service.id)).toHaveLength(2);
  });
});
