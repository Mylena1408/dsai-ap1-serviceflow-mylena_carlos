import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, ConflictError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 items 1 and 6 and 7.4 (SF-173; CA-ESR-02 and 07,
// and the data of CA-ESR-01).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import {
  createEscalationRule,
  deleteEscalationRule,
  listEscalationRuleOverview,
  setEscalationRuleActive,
  updateEscalationRule,
} from "@/modules/sectors";
import { listAuditTrail } from "@/modules/audit";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const admin = await createDomainUser({ role: "ADMIN" });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  actAs(admin);
  return { sector, otherSector, admin, bia, gabi, caio };
}

const overdue = (days: number, overrides: Record<string, unknown> = {}) => ({
  name: `Vencida há ${days} dias`,
  trigger: "OVERDUE_DAYS",
  overdueDays: days,
  raisePriority: true,
  ...overrides,
});

describe("escalation rule schema (7.4; CA-ESR-07)", () => {
  it("existing escalations read as the sector's option, and the option's rows refuse rule data", async () => {
    const { sector, bia } = await scenario();
    const rita = await createDomainUser({ role: "REQUESTER" });
    const service = await createDomainService({ categoryId: (await createDomainCategory()).id, sectorId: sector.id });
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    const base = { requestId: request.id, fromPriority: "NORMAL" as const, toPriority: "HIGH" as const, occurredAt: new Date() };

    await expect(prisma.requestEscalation.create({ data: base })).resolves.toMatchObject({
      trigger: "OVERDUE",
      ruleId: null,
      ruleName: null,
      assignmentSkipped: false,
    });
    await expect(prisma.requestEscalation.create({ data: { ...base, ruleName: "Regra" } })).rejects.toThrow(/RequestEscalation_trigger_check/);
    await expect(prisma.requestEscalation.create({ data: { ...base, trigger: "DUE_SOON" } })).rejects.toThrow(/RequestEscalation_trigger_check/);
    await expect(
      prisma.requestEscalation.create({ data: { ...base, trigger: "OVERDUE_DAYS", ruleName: "R", dueAt: new Date() } }),
    ).rejects.toThrow(/RequestEscalation_trigger_check/);
    await expect(
      prisma.requestEscalation.create({ data: { ...base, trigger: "DUE_SOON", ruleName: "R", dueAt: new Date(), assignedToId: bia.id, assignmentSkipped: true } }),
    ).rejects.toThrow(/RequestEscalation_trigger_check/);
    await expect(
      prisma.requestEscalation.create({ data: { ...base, trigger: "OVERDUE_DAYS", overdueDays: 2, ruleName: "R", dueAt: new Date(), assignedToId: bia.id } }),
    ).resolves.toMatchObject({ trigger: "OVERDUE_DAYS" });
  });

  it("refuses rule shapes out of the rules, and repeats among the active rules", async () => {
    const { sector, bia } = await scenario();
    const valid = { sectorId: sector.id, name: "Atraso", trigger: "OVERDUE_DAYS" as const, overdueDays: 3, raisePriority: true };
    for (const data of [
      { ...valid, name: " Atraso" },
      { ...valid, name: "x".repeat(61) },
      { ...valid, trigger: "OVERDUE" as const },
      { ...valid, overdueDays: null },
      { ...valid, overdueDays: 31 },
      { ...valid, trigger: "DUE_SOON" as const },
      { ...valid, raisePriority: false },
      { ...valid, notifyUserIds: [bia.id, bia.id] },
    ]) {
      await expect(prisma.sectorEscalationRule.create({ data })).rejects.toThrow(/SectorEscalationRule_values_check/);
    }
    await expect(
      prisma.$executeRaw`INSERT INTO "SectorEscalationRule" ("id", "sectorId", "name", "trigger", "overdueDays", "raisePriority", "notifyUserIds", "updatedAt") VALUES (gen_random_uuid(), ${sector.id}::uuid, 'Nulo', 'OVERDUE_DAYS', 3, true, NULL, now())`,
    ).rejects.toThrow(/SectorEscalationRule_values_check/);

    await prisma.sectorEscalationRule.create({ data: valid });
    await expect(prisma.sectorEscalationRule.create({ data: { ...valid, name: "Outra" } })).rejects.toThrow(/SectorEscalationRule_trigger_active_key|Unique constraint/);
    await expect(prisma.sectorEscalationRule.create({ data: { ...valid, overdueDays: 5, name: "ATRASO" } })).rejects.toThrow(
      /SectorEscalationRule_name_active_key|Unique constraint/,
    );
    await expect(prisma.sectorEscalationRule.create({ data: { ...valid, isActive: false } })).resolves.toMatchObject({ isActive: false });
    await expect(prisma.sectorEscalationRule.create({ data: { ...valid, overdueDays: 5, name: "Atraso maior", notifyUserIds: [bia.id] } })).resolves.toBeTruthy();
  });

  it("applies a rule once per request and due date", async () => {
    const { sector } = await scenario();
    const rita = await createDomainUser({ role: "REQUESTER" });
    const service = await createDomainService({ categoryId: (await createDomainCategory()).id, sectorId: sector.id });
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    const rule = await prisma.sectorEscalationRule.create({ data: { sectorId: sector.id, name: "Perto", trigger: "DUE_SOON", notifyManagers: true } });
    const dueAt = new Date("2026-11-10T12:00:00Z");
    const row = { requestId: request.id, fromPriority: "NORMAL" as const, toPriority: "NORMAL" as const, occurredAt: new Date(), trigger: "DUE_SOON" as const, ruleId: rule.id, ruleName: "Perto", dueAt };

    await prisma.requestEscalation.create({ data: row });
    await expect(prisma.requestEscalation.create({ data: row })).rejects.toThrow(/RequestEscalation_rule_due_key|Unique constraint/);
    // A new due date (a reopening) may escalate again.
    await expect(prisma.requestEscalation.create({ data: { ...row, dueAt: new Date("2026-11-20T12:00:00Z") } })).resolves.toBeTruthy();
  });
});

describe("escalation rules configured by the administrator (7.3 item 1; CA-ESR-02)", () => {
  it("creates, edits, deactivates, reactivates and deletes, with the audit trail", async () => {
    const { sector, admin, bia, gabi } = await scenario();
    const rule = await createEscalationRule({ sectorId: sector.id, ...overdue(3, { assignToId: bia.id, notifyUserIds: [gabi.id] }) }, prisma);
    expect(rule).toMatchObject({ sectorId: sector.id, trigger: "OVERDUE_DAYS", overdueDays: 3, assignToId: bia.id, notifyUserIds: [gabi.id], isActive: true });

    await updateEscalationRule(rule.id, { ...overdue(5), notifyTeam: true }, prisma);
    await setEscalationRuleActive(rule.id, false, prisma);
    await setEscalationRuleActive(rule.id, true, prisma);
    await deleteEscalationRule(rule.id, prisma);
    await expect(prisma.sectorEscalationRule.count()).resolves.toBe(0);

    const entries = await prisma.auditEntry.findMany({ where: { entityType: "ESCALATION_RULE", entityId: rule.id }, orderBy: { occurredAt: "asc" } });
    expect(entries.map(({ action, actorId }) => [action, actorId])).toEqual([
      ["CREATED", admin.id],
      ["UPDATED", admin.id],
      ["DEACTIVATED", admin.id],
      ["REACTIVATED", admin.id],
      ["DELETED", admin.id],
    ]);
    expect(entries[1].changes).toEqual(
      expect.arrayContaining([
        { field: "overdueDays", before: 3, after: 5 },
        { field: "assignToId", before: bia.id, after: null },
        { field: "notifyTeam", before: false, after: true },
      ]),
    );

    // The audit trail names the people of the rule.
    const trail = await listAuditTrail({ entity: "ESCALATION_RULE" }, prisma);
    expect(trail.items).toHaveLength(5);
    expect(trail.names[bia.id]).toBe(bia.name);
    expect(trail.names[gabi.id]).toBe(gabi.name);
  });

  it("refuses more than 5 active rules, a repeated trigger, N out of range, no effect and people of another sector", async () => {
    const { sector, caio, gabi } = await scenario();
    for (const days of [1, 2, 3, 4, 5]) {
      await createEscalationRule({ sectorId: sector.id, ...overdue(days) }, prisma);
    }
    await expect(createEscalationRule({ sectorId: sector.id, ...overdue(6) }, prisma)).rejects.toBeInstanceOf(ConflictError);

    const [first] = await prisma.sectorEscalationRule.findMany({ where: { overdueDays: 1 } });
    await setEscalationRuleActive(first.id, false, prisma);
    await expect(createEscalationRule({ sectorId: sector.id, ...overdue(2, { name: "Repetida" }) }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(createEscalationRule({ sectorId: sector.id, ...overdue(31) }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await expect(createEscalationRule({ sectorId: sector.id, ...overdue(9, { raisePriority: false }) }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await expect(createEscalationRule({ sectorId: sector.id, ...overdue(9, { assignToId: caio.id }) }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await expect(createEscalationRule({ sectorId: sector.id, ...overdue(9, { assignToId: gabi.id }) }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await expect(createEscalationRule({ sectorId: sector.id, ...overdue(9, { notifyUserIds: [caio.id] }) }, prisma)).rejects.toBeInstanceOf(ValidationError);

    // With room again, another rule fits; reactivating the first then exceeds the limit.
    await createEscalationRule({ sectorId: sector.id, ...overdue(9) }, prisma);
    await expect(setEscalationRuleActive(first.id, true, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(prisma.sectorEscalationRule.count({ where: { isActive: true } })).resolves.toBe(5);
  });

  it("other profiles are refused", async () => {
    const { sector, gabi } = await scenario();
    actAs(gabi);
    await expect(createEscalationRule({ sectorId: sector.id, ...overdue(3) }, prisma)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listEscalationRuleOverview(prisma)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("lists the rules and the people a rule may name", async () => {
    const { sector, otherSector, bia, gabi, caio } = await scenario();
    await createDomainUser({ role: "ATTENDANT", sectorId: sector.id, isActive: false });
    await createEscalationRule({ sectorId: sector.id, name: "Perto", trigger: "DUE_SOON", notifyManagers: true }, prisma);
    const overview = await listEscalationRuleOverview(prisma);
    expect(overview.rules).toEqual([expect.objectContaining({ name: "Perto", trigger: "DUE_SOON", overdueDays: null, notifyUserIds: [] })]);
    expect(overview.people.map(({ id, role, sectorId }) => [id, role, sectorId]).sort()).toEqual(
      [
        [bia.id, "ATTENDANT", sector.id],
        [gabi.id, "MANAGER", sector.id],
        [caio.id, "ATTENDANT", otherSector.id],
      ].sort(),
    );
  });

  it("deleting a rule keeps the escalations made, with the rule's name (7.3 item 6)", async () => {
    const { sector } = await scenario();
    const rita = await createDomainUser({ role: "REQUESTER" });
    const service = await createDomainService({ categoryId: (await createDomainCategory()).id, sectorId: sector.id });
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    const rule = await createEscalationRule({ sectorId: sector.id, ...overdue(2) }, prisma);
    await prisma.requestEscalation.create({
      data: {
        requestId: request.id,
        fromPriority: "NORMAL",
        toPriority: "HIGH",
        occurredAt: new Date(),
        trigger: "OVERDUE_DAYS",
        overdueDays: 2,
        ruleId: rule.id,
        ruleName: rule.name,
        dueAt: new Date(),
      },
    });

    await deleteEscalationRule(rule.id, prisma);
    await expect(prisma.requestEscalation.findFirstOrThrow({ where: { requestId: request.id } })).resolves.toMatchObject({
      ruleId: null,
      ruleName: "Vencida há 2 dias",
      trigger: "OVERDUE_DAYS",
      toPriority: "HIGH",
    });
  });
});
