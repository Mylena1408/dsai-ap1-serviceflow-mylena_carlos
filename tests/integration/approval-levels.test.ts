import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";
import { configureServiceApproval, createService, setServiceActive } from "@/modules/services";
import { createServiceField, deactivateServiceField, updateServiceField } from "@/modules/service-fields";
import { createRequest, decideApproval, getManagerRequest, listManagerApprovals } from "@/modules/requests";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3 (SF-164; CA-APM-01 to 03, 06 and 08).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const HOUR = 60 * 60 * 1000;

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const purchasing = await createDomainSector();
  const finance = await createDomainSector();
  const board = await createDomainSector();
  const closed = await createDomainSector(false);
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: purchasing.id });
  const fred = await createDomainUser({ role: "MANAGER", sectorId: finance.id });
  const bia = await createDomainUser({ role: "MANAGER", sectorId: board.id });
  actAs(admin);
  const service = await createService(
    { name: `Compra ${purchasing.id}`, description: "Compra", categoryId: category.id, sectorId: purchasing.id, slaHours: "10", requiresApproval: true },
    prisma,
  );
  return { purchasing, finance, board, closed, category, admin, rita, gabi, fred, bia, service };
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });
const process = () => runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);
const notificationsOf = (recipientId: string) =>
  prisma.requestNotification.findMany({ where: { recipientId }, orderBy: { createdAt: "asc" }, select: { type: true } });

describe("approval levels (SF-164)", () => {
  it("keeps one level with the service's sector when no level is configured (CA-APM-01)", async () => {
    const { purchasing, rita, gabi, service } = await scenario();
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Cadeira" }, prisma);

    await expect(stored(request.id)).resolves.toMatchObject({
      approvalState: "PENDING",
      approvalSectorIdsSnapshot: [purchasing.id],
      approvalLevel: 1,
      approvalPendingSectorId: purchasing.id,
      dueAt: null,
    });
    actAs(gabi);
    await decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma);
    const approved = await stored(request.id);
    expect(approved).toMatchObject({ approvalState: "APPROVED", approvalLevel: 1, approvalPendingSectorId: null });
    expect(approved.dueAt).not.toBeNull();
  });

  it("validates the configured levels and records them in the audit (CA-APM-02)", async () => {
    const { purchasing, finance, board, closed, admin, service } = await scenario();
    actAs(admin);
    const configure = (sectorIds: string[]) =>
      configureServiceApproval(service.id, { sectorIds, conditionFieldId: null, conditionValue: null }, prisma);

    await expect(configure([purchasing.id, finance.id, board.id, purchasing.id])).rejects.toThrow(ValidationError);
    await expect(configure([purchasing.id, closed.id])).rejects.toThrow(ValidationError);
    await expect(configure([purchasing.id, purchasing.id])).rejects.toThrow(ValidationError);
    await expect(configure(["00000000-0000-4000-8000-000000000999"])).rejects.toThrow(ValidationError);
    // The same sector again, but not in consecutive levels, is accepted.
    await expect(configure([purchasing.id, finance.id, purchasing.id])).resolves.toMatchObject({
      approvalSectorIds: [purchasing.id, finance.id, purchasing.id],
    });
    await configure([finance.id, board.id]);

    const entries = await prisma.auditEntry.findMany({ where: { entityId: service.id, action: "UPDATED" }, orderBy: { occurredAt: "asc" } });
    expect(entries.at(-1)!.changes).toEqual(
      expect.arrayContaining([{ field: "approvalSectorIds", before: [purchasing.id, finance.id, purchasing.id], after: [finance.id, board.id] }]),
    );
  });

  it("moves through the levels, each decided only by its sector, and starts the SLA at the last approval (CA-APM-03)", async () => {
    const { purchasing, finance, admin, rita, gabi, fred, service } = await scenario();
    actAs(admin);
    await configureServiceApproval(service.id, { sectorIds: [purchasing.id, finance.id], conditionFieldId: null, conditionValue: null }, prisma);
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Notebook" }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ approvalSectorIdsSnapshot: [purchasing.id, finance.id], approvalPendingSectorId: purchasing.id });

    // Finance sees the request (one of its levels) but it is not its turn yet.
    actAs(fred);
    await expect(listManagerApprovals("pending", prisma)).resolves.toHaveLength(0);
    await expect(listManagerApprovals("all", prisma)).resolves.toHaveLength(1);
    await expect(getManagerRequest(request.id, prisma)).resolves.toMatchObject({ id: request.id });
    await expect(decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma)).rejects.toThrow(ConflictError);

    actAs(gabi);
    await decideApproval({ requestId: request.id, decision: "APPROVED", note: "Ok do setor" }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({
      approvalState: "PENDING",
      approvalLevel: 2,
      approvalPendingSectorId: finance.id,
      dueAt: null,
    });
    // The first level is decided once.
    await expect(decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma)).rejects.toThrow(ConflictError);
    await expect(listManagerApprovals("pending", prisma)).resolves.toHaveLength(0);

    actAs(fred);
    await expect(listManagerApprovals("pending", prisma)).resolves.toHaveLength(1);
    await decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma);
    const approved = await stored(request.id);
    expect(approved).toMatchObject({ approvalState: "APPROVED", approvalLevel: 2, approvalPendingSectorId: null });
    expect(approved.dueAt!.getTime() - approved.updatedAt.getTime()).toBe(10 * HOUR);

    const decisions = await prisma.requestApproval.findMany({ where: { requestId: request.id }, orderBy: { level: "asc" } });
    expect(decisions.map(({ level, deciderId, decision }) => ({ level, deciderId, decision }))).toEqual([
      { level: 1, deciderId: gabi.id, decision: "APPROVED" },
      { level: 2, deciderId: fred.id, decision: "APPROVED" },
    ]);
    // The detail keeps the last decision as before and the full list.
    const detail = await getManagerRequest(request.id, prisma);
    expect(detail.approval).toMatchObject({ level: 2, deciderId: fred.id });
    expect(detail.approvals?.map(({ level }) => level)).toEqual([1, 2]);
  });

  it("asks the next level and tells the requester only at the end (4.3.3)", async () => {
    const { purchasing, finance, admin, rita, gabi, fred, service } = await scenario();
    actAs(admin);
    await configureServiceApproval(service.id, { sectorIds: [purchasing.id, finance.id], conditionFieldId: null, conditionValue: null }, prisma);
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Notebook" }, prisma);
    await process();
    await expect(notificationsOf(gabi.id)).resolves.toEqual([{ type: "approval.requested" }]);
    await expect(notificationsOf(fred.id)).resolves.toEqual([]);

    actAs(gabi);
    await decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma);
    await process();
    await expect(notificationsOf(fred.id)).resolves.toEqual([{ type: "approval.requested" }]);
    await expect(notificationsOf(rita.id)).resolves.toEqual([]);

    actAs(fred);
    await decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma);
    await process();
    await expect(notificationsOf(rita.id)).resolves.toEqual([{ type: "approval.approved" }]);

    const events = await prisma.outboxEvent.findMany({ where: { requestId: request.id, type: "request.approval_decided" }, orderBy: { occurredAt: "asc" } });
    expect(events.map(({ payload }) => payload)).toEqual([
      { decision: "APPROVED", actorId: gabi.id, level: 1, nextSectorId: finance.id },
      { decision: "APPROVED", actorId: fred.id, level: 2, nextSectorId: null },
    ]);
  });

  it("cancels the request when a later level rejects", async () => {
    const { purchasing, finance, admin, rita, gabi, fred, service } = await scenario();
    actAs(admin);
    await configureServiceApproval(service.id, { sectorIds: [purchasing.id, finance.id], conditionFieldId: null, conditionValue: null }, prisma);
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Notebook" }, prisma);
    actAs(gabi);
    await decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma);
    actAs(fred);
    await expect(decideApproval({ requestId: request.id, decision: "REJECTED", note: "" }, prisma)).rejects.toThrow(ValidationError);
    await decideApproval({ requestId: request.id, decision: "REJECTED", note: "Sem verba" }, prisma);

    await expect(stored(request.id)).resolves.toMatchObject({
      status: "CANCELLED",
      approvalState: "REJECTED",
      approvalLevel: 2,
      approvalPendingSectorId: null,
      dueAt: null,
    });
  });

  it("counts one of two simultaneous decisions on the same level", async () => {
    const { purchasing, finance, admin, rita, service } = await scenario();
    const hugo = await createDomainUser({ role: "MANAGER", sectorId: purchasing.id });
    actAs(admin);
    await configureServiceApproval(service.id, { sectorIds: [purchasing.id, finance.id], conditionFieldId: null, conditionValue: null }, prisma);
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Notebook" }, prisma);
    actAs(hugo);

    const results = await Promise.allSettled([
      decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma),
      decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    await expect(prisma.requestApproval.count({ where: { requestId: request.id } })).resolves.toBe(1);
    await expect(stored(request.id)).resolves.toMatchObject({ approvalLevel: 2, approvalPendingSectorId: finance.id });
  });

  it("requires approval only when the condition is met, and protects the field it uses (CA-APM-06)", async () => {
    const { purchasing, admin, rita, gabi, service } = await scenario();
    actAs(admin);
    const value = await createServiceField(
      service.id,
      { label: "Faixa de valor", helpText: null, type: "SELECT", isRequired: true, options: ["Até R$ 1.000", "Acima de R$ 1.000"], minValue: null, maxValue: null },
      prisma,
    );
    const note = await createServiceField(
      service.id,
      { label: "Obs", helpText: null, type: "SHORT_TEXT", isRequired: false, options: [], minValue: null, maxValue: null },
      prisma,
    );
    const configure = (conditionFieldId: string, conditionValue: string) =>
      configureServiceApproval(service.id, { sectorIds: [], conditionFieldId, conditionValue }, prisma);

    await expect(configure(note.id, "x")).rejects.toThrow(ValidationError);
    await expect(configure(value.id, "Outra")).rejects.toThrow(ValidationError);
    await configure(value.id, "Acima de R$ 1.000");

    actAs(rita);
    const cheap = await createRequest({ serviceId: service.id, description: "Mouse", fieldValues: { [value.id]: "Até R$ 1.000" } }, prisma);
    const expensive = await createRequest({ serviceId: service.id, description: "Notebook", fieldValues: { [value.id]: "Acima de R$ 1.000" } }, prisma);
    const cheapRow = await stored(cheap.id);
    expect(cheapRow).toMatchObject({ approvalState: null, approvalSectorIdsSnapshot: [], approvalLevel: null });
    expect(cheapRow.dueAt).not.toBeNull();
    await expect(stored(expensive.id)).resolves.toMatchObject({ approvalState: "PENDING", approvalPendingSectorId: purchasing.id });
    actAs(gabi);
    await expect(listManagerApprovals("pending", prisma)).resolves.toHaveLength(1);

    // The field and the option used by the approval condition are protected (decision G18).
    actAs(admin);
    await expect(deactivateServiceField(value.id, prisma)).rejects.toThrow(ConflictError);
    const edit = (changes: Record<string, unknown>) =>
      updateServiceField(
        value.id,
        { label: "Faixa de valor", helpText: null, type: "SELECT", isRequired: true, options: ["Até R$ 1.000", "Acima de R$ 1.000"], minValue: null, maxValue: null, ...changes },
        prisma,
      );
    await expect(edit({ options: ["Até R$ 1.000", "Mais de R$ 1.000"] })).rejects.toThrow(ConflictError);
    await expect(edit({ audience: "ATTENDANT" })).rejects.toThrow(ConflictError);
    await expect(edit({ options: ["Até R$ 1.000", "Acima de R$ 1.000", "Doação"] })).resolves.toBeTruthy();
    // Without the condition, the field is free again.
    await configureServiceApproval(service.id, { sectorIds: [], conditionFieldId: null, conditionValue: null }, prisma);
    await expect(deactivateServiceField(value.id, prisma)).resolves.toMatchObject({ isActive: false });
  });

  it("refuses the configuration to people without the catalog permission", async () => {
    const { rita, gabi, service } = await scenario();
    for (const actor of [rita, gabi]) {
      actAs(actor);
      await expect(
        configureServiceApproval(service.id, { sectorIds: [], conditionFieldId: null, conditionValue: null }, prisma),
      ).rejects.toThrow();
    }
  });

  it("keeps requests opened before levels decided by their own sector (CA-APM-01, CA-APM-08)", async () => {
    const { purchasing, finance, admin, rita, gabi, fred, service } = await scenario();
    actAs(admin);
    await setServiceActive(service.id, true, prisma);
    // A request written as before levels: approval pending, without the list of level sectors.
    const legacy = await prisma.request.create({
      data: {
        requesterId: rita.id,
        serviceId: service.id,
        sectorId: purchasing.id,
        serviceNameSnapshot: "Compra",
        serviceDescriptionSnapshot: "Compra",
        categoryIdSnapshot: service.categoryId,
        categoryNameSnapshot: "Categoria",
        sectorNameSnapshot: "Compras",
        description: "Antiga",
        approvalState: "PENDING",
      },
    });
    actAs(fred);
    await expect(getManagerRequest(legacy.id, prisma)).rejects.toThrow(NotFoundError);
    actAs(gabi);
    await expect(listManagerApprovals("pending", prisma)).resolves.toEqual([expect.objectContaining({ id: legacy.id })]);
    await decideApproval({ requestId: legacy.id, decision: "APPROVED", note: "" }, prisma);
    await expect(stored(legacy.id)).resolves.toMatchObject({ approvalState: "APPROVED", approvalSectorIdsSnapshot: [], approvalLevel: null });
    await expect(prisma.requestApproval.findFirstOrThrow({ where: { requestId: legacy.id } })).resolves.toMatchObject({ level: 1 });
    void finance;
  });
});

describe("approval levels schema (SF-164)", () => {
  it("keeps the request's list, level and pending sector coherent", async () => {
    const { purchasing, finance, rita, service } = await scenario();
    const base = {
      requesterId: rita.id,
      serviceId: service.id,
      sectorId: purchasing.id,
      serviceNameSnapshot: "Compra",
      serviceDescriptionSnapshot: "Compra",
      categoryIdSnapshot: service.categoryId,
      categoryNameSnapshot: "Categoria",
      sectorNameSnapshot: "Compras",
      description: "Teste",
    };
    const create = (data: Record<string, unknown>) => prisma.request.create({ data: { ...base, ...data } });

    await expect(
      create({ approvalState: "PENDING", approvalSectorIdsSnapshot: [purchasing.id, finance.id], approvalLevel: 2, approvalPendingSectorId: finance.id }),
    ).resolves.toBeTruthy();
    // Pending sector different from the level's sector.
    await expect(
      create({ approvalState: "PENDING", approvalSectorIdsSnapshot: [purchasing.id, finance.id], approvalLevel: 2, approvalPendingSectorId: purchasing.id }),
    ).rejects.toThrow();
    // Level outside the list, pending without a sector, decided with a sector, list without approval.
    await expect(create({ approvalState: "PENDING", approvalSectorIdsSnapshot: [purchasing.id], approvalLevel: 2, approvalPendingSectorId: purchasing.id })).rejects.toThrow();
    await expect(create({ approvalState: "PENDING", approvalSectorIdsSnapshot: [purchasing.id], approvalLevel: 1 })).rejects.toThrow();
    await expect(create({ approvalState: "APPROVED", approvalSectorIdsSnapshot: [purchasing.id], approvalLevel: 1, approvalPendingSectorId: purchasing.id })).rejects.toThrow();
    await expect(create({ approvalSectorIdsSnapshot: [purchasing.id], approvalLevel: 1 })).rejects.toThrow();
    // More than 3 levels.
    await expect(
      create({ approvalState: "APPROVED", approvalSectorIdsSnapshot: [purchasing.id, finance.id, purchasing.id, finance.id], approvalLevel: 1 }),
    ).rejects.toThrow();
    // Before levels: no list, no level, no pending sector.
    await expect(create({ approvalState: "PENDING", approvalLevel: 1 })).rejects.toThrow();
  });

  it("keeps one decision per level, from 1 to 3, and the service's levels and condition well formed", async () => {
    const { purchasing, finance, rita, gabi, service } = await scenario();
    const request = await prisma.request.create({
      data: {
        requesterId: rita.id,
        serviceId: service.id,
        sectorId: purchasing.id,
        serviceNameSnapshot: "Compra",
        serviceDescriptionSnapshot: "Compra",
        categoryIdSnapshot: service.categoryId,
        categoryNameSnapshot: "Categoria",
        sectorNameSnapshot: "Compras",
        description: "Teste",
        status: "CANCELLED",
        cancelledAt: new Date(),
        approvalState: "REJECTED",
      },
    });
    const decide = (level: number) =>
      prisma.requestApproval.create({ data: { requestId: request.id, level, deciderId: gabi.id, decision: "APPROVED", decidedAt: new Date() } });
    await expect(decide(1)).resolves.toBeTruthy();
    await expect(decide(1)).rejects.toThrow();
    await expect(decide(2)).resolves.toBeTruthy();
    await expect(decide(4)).rejects.toThrow();
    await expect(decide(0)).rejects.toThrow();

    const update = (data: Record<string, unknown>) => prisma.service.update({ where: { id: service.id }, data });
    await expect(update({ approvalSectorIds: [purchasing.id, finance.id, purchasing.id, finance.id] })).rejects.toThrow();
    await expect(update({ approvalConditionValue: "x" })).rejects.toThrow();
  });
});
