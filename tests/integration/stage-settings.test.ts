import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { configureServiceStage, createServiceStage, deactivateServiceStage } from "@/modules/service-stages";
import { createServiceField, deactivateServiceField, updateServiceField } from "@/modules/service-fields";
import { createService } from "@/modules/services";
import { assumeRequest, createRequest, reopenRequest, transitionRequestStatus } from "@/modules/requests";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3 and 5.4 (SF-168; CA-ETP-01, 02, 05 and 07).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const DAY = 24 * 60 * 60 * 1000;

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  const inactive = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id, isActive: false });
  actAs(admin);
  const service = await createService(
    { name: `Reparo ${sector.id}`, description: "Reparo", categoryId: category.id, sectorId: sector.id },
    prisma,
  );
  const kind = await createServiceField(
    service.id,
    { label: "Tipo", helpText: null, type: "SELECT", isRequired: true, options: ["Hardware", "Software"], minValue: null, maxValue: null },
    prisma,
  );
  const note = await createServiceField(
    service.id,
    { label: "Obs", helpText: null, type: "SHORT_TEXT", isRequired: false, options: [], minValue: null, maxValue: null },
    prisma,
  );
  const triage = await createServiceStage(service.id, { name: "Triagem" }, prisma);
  const bench = await createServiceStage(service.id, { name: "Bancada" }, prisma);
  const tests = await createServiceStage(service.id, { name: "Testes" }, prisma);
  return { sector, admin, rita, ana, bia, caio, inactive, service, kind, note, triage, bench, tests };
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });
const settings = (input: Partial<{ assigneeId: string | null; targetDays: number | null; conditionFieldId: string | null; conditionValue: string | null }>) => ({
  assigneeId: null,
  targetDays: null,
  conditionFieldId: null,
  conditionValue: null,
  ...input,
});

describe("stage settings (SF-168)", () => {
  it("validates the attendant, the target and the condition of a stage, and records them in the audit (CA-ETP-02)", async () => {
    const { admin, ana, caio, inactive, rita, kind, note, bench, triage } = await scenario();
    actAs(admin);

    await expect(configureServiceStage(bench.id, settings({ assigneeId: caio.id }), prisma)).rejects.toThrow(ValidationError);
    await expect(configureServiceStage(bench.id, settings({ assigneeId: inactive.id }), prisma)).rejects.toThrow(ValidationError);
    await expect(configureServiceStage(bench.id, settings({ assigneeId: rita.id }), prisma)).rejects.toThrow(ValidationError);
    await expect(configureServiceStage(bench.id, settings({ targetDays: 0 }), prisma)).rejects.toThrow(ValidationError);
    await expect(configureServiceStage(bench.id, settings({ targetDays: 31 }), prisma)).rejects.toThrow(ValidationError);
    await expect(configureServiceStage(bench.id, settings({ conditionFieldId: note.id, conditionValue: "x" }), prisma)).rejects.toThrow(ValidationError);
    await expect(configureServiceStage(bench.id, settings({ conditionFieldId: kind.id, conditionValue: "Rede" }), prisma)).rejects.toThrow(ValidationError);
    await expect(configureServiceStage(bench.id, settings({ conditionFieldId: kind.id }), prisma)).rejects.toThrow(ValidationError);

    await expect(
      configureServiceStage(bench.id, settings({ assigneeId: ana.id, targetDays: 2, conditionFieldId: kind.id, conditionValue: "Hardware" }), prisma),
    ).resolves.toMatchObject({ assigneeId: ana.id, targetDays: 2, conditionFieldId: kind.id, conditionValue: "Hardware" });

    const entry = await prisma.auditEntry.findFirstOrThrow({ where: { entityId: bench.id, action: "UPDATED" } });
    expect(entry.changes).toEqual(
      expect.arrayContaining([
        { field: "assigneeId", before: null, after: ana.id },
        { field: "targetDays", before: null, after: 2 },
      ]),
    );

    // An inactive stage is not configured; other profiles are refused.
    await deactivateServiceStage(triage.id, prisma);
    await expect(configureServiceStage(triage.id, settings({ targetDays: 1 }), prisma)).rejects.toThrow(ConflictError);
    actAs(ana);
    await expect(configureServiceStage(bench.id, settings({ targetDays: 1 }), prisma)).rejects.toThrow();
  });

  it("copies only the stages whose condition is met, with their attendant and target, on start (CA-ETP-05)", async () => {
    const { admin, rita, ana, bia, service, kind, bench, tests } = await scenario();
    actAs(admin);
    await configureServiceStage(bench.id, settings({ assigneeId: bia.id, targetDays: 3, conditionFieldId: kind.id, conditionValue: "Hardware" }), prisma);
    await configureServiceStage(tests.id, settings({ targetDays: 1 }), prisma);

    actAs(rita);
    const hardware = await createRequest({ serviceId: service.id, description: "Tela", fieldValues: { [kind.id]: "Hardware" } }, prisma);
    const software = await createRequest({ serviceId: service.id, description: "Office", fieldValues: { [kind.id]: "Software" } }, prisma);

    actAs(ana);
    for (const { id } of [hardware, software]) {
      await assumeRequest({ requestId: id }, prisma);
      await transitionRequestStatus({ requestId: id, toStatus: "IN_PROGRESS" }, prisma);
    }

    await expect(stored(hardware.id)).resolves.toMatchObject({
      stageNamesSnapshot: ["Triagem", "Bancada", "Testes"],
      stageIndex: 0,
      stageAssigneeIdsSnapshot: ["", bia.id, ""],
      stageTargetDaysSnapshot: [0, 3, 1],
      stageDueAt: null,
    });
    await expect(stored(software.id)).resolves.toMatchObject({
      stageNamesSnapshot: ["Triagem", "Testes"],
      stageAssigneeIdsSnapshot: ["", ""],
      stageTargetDaysSnapshot: [0, 1],
    });
  });

  it("starts the first stage's deadline with the attendance and clears everything on reopening (CA-ETP-07)", async () => {
    const { admin, rita, ana, service, kind, triage, bench, tests } = await scenario();
    actAs(admin);
    await configureServiceStage(triage.id, settings({ targetDays: 2 }), prisma);
    await deactivateServiceStage(bench.id, prisma);
    await deactivateServiceStage(tests.id, prisma);

    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Tela", fieldValues: { [kind.id]: "Software" } }, prisma);
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    const started = await stored(request.id);
    expect(started.stageDueAt!.getTime() - started.updatedAt.getTime()).toBe(2 * DAY);

    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);
    actAs(rita);
    await reopenRequest({ requestId: request.id, note: "Voltou a falhar" }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({
      stageNamesSnapshot: [],
      stageIndex: null,
      stageAssigneeIdsSnapshot: [],
      stageTargetDaysSnapshot: [],
      stageDueAt: null,
    });
  });

  it("has no flow when no stage's condition is met, and keeps stages without settings as before (CA-ETP-01 and 05)", async () => {
    const { admin, rita, ana, service, kind, triage, bench, tests } = await scenario();
    actAs(admin);
    for (const stage of [triage, bench, tests]) {
      await configureServiceStage(stage.id, settings({ conditionFieldId: kind.id, conditionValue: "Hardware" }), prisma);
    }
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Office", fieldValues: { [kind.id]: "Software" } }, prisma);
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ status: "IN_PROGRESS", stageNamesSnapshot: [], stageIndex: null });
    await expect(prisma.requestStageEvent.count({ where: { requestId: request.id } })).resolves.toBe(0);
  });

  it("protects the field and the option a stage's condition uses (decision G18)", async () => {
    const { admin, kind, bench } = await scenario();
    actAs(admin);
    await configureServiceStage(bench.id, settings({ conditionFieldId: kind.id, conditionValue: "Hardware" }), prisma);
    const edit = (options: string[], extra: Record<string, unknown> = {}) =>
      updateServiceField(kind.id, { label: "Tipo", helpText: null, type: "SELECT", isRequired: true, options, minValue: null, maxValue: null, ...extra }, prisma);

    await expect(deactivateServiceField(kind.id, prisma)).rejects.toThrow(ConflictError);
    await expect(edit(["Software", "Rede"])).rejects.toThrow(ConflictError);
    await expect(edit(["Hardware", "Software"], { audience: "ATTENDANT" })).rejects.toThrow(ConflictError);
    await expect(edit(["Hardware", "Software", "Rede"])).resolves.toBeTruthy();
    // A deactivated stage no longer holds the field.
    await deactivateServiceStage(bench.id, prisma);
    await expect(deactivateServiceField(kind.id, prisma)).resolves.toMatchObject({ isActive: false });
  });
});

describe("stage settings schema (SF-168)", () => {
  it("keeps the targets from 1 to 30, the condition complete and the lists along the stage names", async () => {
    const { rita, service, kind, triage } = await scenario();
    const update = (data: Record<string, unknown>) => prisma.serviceStage.update({ where: { id: triage.id }, data });
    await expect(update({ targetDays: 31 })).rejects.toThrow(/ServiceStage_settings_check/);
    await expect(update({ conditionFieldId: kind.id })).rejects.toThrow(/ServiceStage_settings_check/);
    await expect(update({ conditionValue: "Hardware" })).rejects.toThrow(/ServiceStage_settings_check/);

    const request = await createRequest({ serviceId: service.id, description: "x", fieldValues: { [kind.id]: "Hardware" } }, prisma).catch(async () => {
      actAs(rita);
      return createRequest({ serviceId: service.id, description: "x", fieldValues: { [kind.id]: "Hardware" } }, prisma);
    });
    // In progress, so the older "no stage while open" rule does not decide these cases.
    const write = (data: Record<string, unknown>) => prisma.request.update({ where: { id: request.id }, data: { status: "IN_PROGRESS", ...data } });
    await expect(write({ stageNamesSnapshot: ["A", "B"], stageIndex: 0, stageAssigneeIdsSnapshot: [""], stageTargetDaysSnapshot: [] })).rejects.toThrow(/Request_stage_details_check/);
    await expect(write({ stageNamesSnapshot: ["A", "B"], stageIndex: 0, stageTargetDaysSnapshot: [0, 31] })).rejects.toThrow(/Request_stage_details_check/);
    // A due date without a stage.
    await expect(write({ stageNamesSnapshot: [], stageIndex: null, stageDueAt: new Date() })).rejects.toThrow(/Request_stage_details_check/);
    await expect(write({ stageNamesSnapshot: ["A", "B"], stageIndex: 0, stageAssigneeIdsSnapshot: ["", ""], stageTargetDaysSnapshot: [1, 0] })).resolves.toBeTruthy();
    await expect(write({ stageOverdueNotifiedAt: new Date() })).rejects.toThrow(/Request_stage_details_check/);
  });
});
