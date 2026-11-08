import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 6.3 item 4 (SF-188; CA-CFG-03).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { exportConfiguration, previewConfigurationImport, type ConfigurationFile } from "@/modules/configuration";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const diego = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  await prisma.serviceField.create({ data: { serviceId: service.id, label: "Sistema", type: "SELECT", isRequired: true, options: ["ERP", "CRM"], position: 1 } });
  await prisma.serviceStage.create({ data: { serviceId: service.id, name: "Liberação", position: 1, assigneeId: diego.id } });
  await prisma.sectorEscalationRule.create({ data: { sectorId: sector.id, name: "Atraso", trigger: "OVERDUE_DAYS", overdueDays: 2, assignToId: diego.id } });
  actAs(admin);
  const file = JSON.parse((await exportConfiguration(prisma)).content) as ConfigurationFile;
  return { sector, category, service, admin, diego, rita, file };
}

/** Counts of every configuration table, to show the preview writes nothing. */
async function tableCounts() {
  return Promise.all([
    prisma.sector.count(),
    prisma.category.count(),
    prisma.service.count(),
    prisma.serviceField.count(),
    prisma.serviceStage.count(),
    prisma.sectorEscalationRule.count(),
    prisma.auditEntry.count(),
  ]);
}

describe("the import's preview (6.3 item 4; CA-CFG-03)", () => {
  it("only the administrator previews; exporting and previewing back gives equal everywhere", async () => {
    const { file, diego, rita } = await scenario();
    for (const person of [diego, rita]) {
      actAs(person);
      await expect(previewConfigurationImport(JSON.stringify(file), prisma)).rejects.toBeInstanceOf(AuthorizationError);
    }

    const { admin } = await scenario();
    actAs(admin);
    const again = JSON.parse((await exportConfiguration(prisma)).content);
    const before = await tableCounts();
    const preview = await previewConfigurationImport(JSON.stringify(again), prisma);
    expect(preview).toMatchObject({ accepted: true, problems: [], warnings: [], summary: { new: 0, changed: 0 } });
    expect(preview.summary.equal).toBe(preview.items.length);
    expect(preview.items.length).toBeGreaterThan(5);
    expect(await tableCounts()).toEqual(before);
  });

  it("classifies new and changed items and warns about people who cannot take the role", async () => {
    const { file, sector, service } = await scenario();
    const own = file.data.services.find(({ name }) => name === service.name)!;
    own.description = "Descrição nova";
    own.fields.push({ ...own.fields[0], label: "Módulo", type: "SHORT_TEXT", options: [], position: 2 });
    own.stages[0].assignee = "ninguem@exemplo.test";
    file.data.categories.push({ name: "Categoria nova", isActive: true });
    const rule = file.data.sectors.find(({ name }) => name === sector.name)!.escalationRules[0];
    rule.notify = ["fora@exemplo.test"];

    const preview = await previewConfigurationImport(JSON.stringify(file), prisma);
    expect(preview).toMatchObject({ accepted: true, summary: { new: 2, changed: 2 } });
    expect(preview.items.filter((item) => item.status !== "equal")).toEqual(
      expect.arrayContaining([
        { kind: "service", label: service.name, status: "changed", changes: ["description"] },
        { kind: "field", label: `${service.name} › Módulo`, status: "new", changes: [] },
        { kind: "category", label: "Categoria nova", status: "new", changes: [] },
        { kind: "stage", label: `${service.name} › Liberação`, status: "changed", changes: ["assignee"] },
        // The person stays out, so the rule itself does not change.
        { kind: "escalationRule", label: `${sector.name} › Atraso`, status: "equal", changes: [] },
      ].filter((item) => item.status !== "equal")),
    );
    expect(preview.warnings.map(({ path }) => path)).toEqual([
      `sectors › ${sector.name} › escalationRules › Atraso › notify`,
      `services › ${service.name} › stages › Liberação › assignee`,
    ]);
  });

  it("refuses an invalid file with the list of problems, and changes the screens do not allow", async () => {
    const { file, service, sector } = await scenario();
    const own = file.data.services.find(({ name }) => name === service.name)!;
    own.fields[0].type = "MULTI_SELECT";
    own.slaHours = 5000;
    file.data.services.push({ ...own, name: "Sem setor", sector: "Setor inexistente", fields: [], stages: [] });
    // The sector has an active attendant: it cannot be deactivated.
    file.data.sectors.find(({ name }) => name === sector.name)!.isActive = false;

    const preview = await previewConfigurationImport(JSON.stringify(file), prisma);
    expect(preview).toMatchObject({ accepted: false, items: [], summary: { new: 0, changed: 0, equal: 0 } });
    expect(preview.problems.map(({ path }) => path)).toEqual([
      `sectors › ${sector.name} › isActive`,
      `services › ${service.name} › slaHours`,
      // The active service would be left with its sector deactivated.
      `services › ${service.name}`,
      `services › ${service.name} › fields › Sistema › type`,
      "services › Sem setor › slaHours",
      "services › Sem setor › sector",
    ]);
    expect(preview.problems.every(({ message }) => message.length > 0)).toBe(true);
  });

  it("refuses names it cannot match", async () => {
    const { file, category, sector } = await scenario();
    await createDomainService({ categoryId: category.id, sectorId: sector.id });
    const names = await prisma.service.findMany({ select: { id: true } });
    await prisma.service.updateMany({ where: { id: { in: names.map(({ id }) => id) } }, data: { name: "Repetido" } });
    file.data.services[0].name = "repetido";

    const preview = await previewConfigurationImport(JSON.stringify(file), prisma);
    expect(preview.accepted).toBe(false);
    expect(preview.problems[0]).toMatchObject({ path: "serviços: Repetido" });
  });
});
