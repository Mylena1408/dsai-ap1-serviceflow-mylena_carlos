import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";
import { cancelAbsence, listAbsences, registerAbsence } from "@/modules/absences";
import { configureServiceApproval, createService } from "@/modules/services";
import { createServiceField } from "@/modules/service-fields";
import {
  createRequest,
  decideApproval,
  getApprovalActingSectors,
  getManagerRequest,
  listManagerApprovals,
  listRequestFieldAnswers,
} from "@/modules/requests";
import { organizationToday } from "@/modules/requests/infrastructure/approval-coverage";
import { addDays } from "@/shared/time";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.4 and 4.3.5 (SF-165; CA-APM-04).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function today(): Promise<string> {
  return (await organizationToday(prisma)).toISOString().slice(0, 10);
}

async function scenario() {
  const purchasing = await createDomainSector();
  const finance = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: purchasing.id });
  const fred = await createDomainUser({ role: "MANAGER", sectorId: finance.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: purchasing.id });
  actAs(admin);
  const service = await createService(
    { name: `Compra ${purchasing.id}`, description: "Compra", categoryId: category.id, sectorId: purchasing.id, slaHours: "10", requiresApproval: true },
    prisma,
  );
  const asset = await createServiceField(
    service.id,
    { label: "Patrimônio", helpText: null, type: "SHORT_TEXT", isRequired: false, options: [], minValue: null, maxValue: null },
    prisma,
  );
  return { purchasing, finance, category, admin, rita, gabi, fred, ana, service, asset };
}

const process = () => runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);
const notificationsOf = (recipientId: string) =>
  prisma.requestNotification.findMany({ where: { recipientId }, orderBy: { createdAt: "asc" }, select: { type: true } });

describe("manager absences (SF-165)", () => {
  it("lets a manager register and cancel an absence, with the period rules (CA-APM-04)", async () => {
    const { gabi, fred, ana } = await scenario();
    const day = await today();
    actAs(gabi);
    const register = (substituteId: string, startsOn: string, endsOn: string) => registerAbsence({ substituteId, startsOn, endsOn }, prisma);

    await expect(register(fred.id, addDays(day, 5), addDays(day, 4))).rejects.toThrow(ValidationError);
    await expect(register(fred.id, day, addDays(day, 90))).rejects.toThrow(ValidationError);
    await expect(register(fred.id, addDays(day, -10), addDays(day, -1))).rejects.toThrow(ValidationError);
    await expect(register(fred.id, "2026-02-30", day)).rejects.toThrow(ValidationError);
    await expect(register(gabi.id, day, addDays(day, 3))).rejects.toThrow(ConflictError);
    await expect(register(ana.id, day, addDays(day, 3))).rejects.toThrow(ConflictError);

    const first = await register(fred.id, day, addDays(day, 89));
    // Overlapping the first one.
    await expect(register(fred.id, addDays(day, 10), addDays(day, 12))).rejects.toThrow(ConflictError);

    // Another manager does not cancel it; the owner does, once.
    actAs(fred);
    await expect(cancelAbsence(first.id, prisma)).rejects.toThrow(NotFoundError);
    actAs(gabi);
    await cancelAbsence(first.id, prisma);
    await expect(cancelAbsence(first.id, prisma)).rejects.toThrow(ConflictError);
    // Cancelled, it no longer blocks a new period.
    await expect(register(fred.id, addDays(day, 10), addDays(day, 12))).resolves.toMatchObject({ id: expect.any(String) });

    const { absences } = await listAbsences(prisma);
    expect(absences.map(({ startsOn, cancelledAt }) => ({ startsOn, cancelled: cancelledAt !== null }))).toEqual([
      { startsOn: addDays(day, 10), cancelled: false },
      { startsOn: day, cancelled: true },
    ]);
    // The substitute lists the absences where they replace someone, cancelled ones included.
    actAs(fred);
    const received = (await listAbsences(prisma)).absences;
    expect(received).toHaveLength(2);
    expect(received.every(({ substitute }) => substitute.id === fred.id)).toBe(true);
  });

  it("refuses a substitute absent during the whole period, and people who are not managers or administrators", async () => {
    const { gabi, fred, rita, ana, admin } = await scenario();
    const day = await today();
    actAs(fred);
    await registerAbsence({ substituteId: gabi.id, startsOn: day, endsOn: addDays(day, 10) }, prisma);
    actAs(gabi);
    await expect(registerAbsence({ substituteId: fred.id, startsOn: addDays(day, 2), endsOn: addDays(day, 5) }, prisma)).rejects.toThrow(ConflictError);
    // Partly overlapping is accepted: the substitute is back for part of it.
    await expect(registerAbsence({ substituteId: fred.id, startsOn: addDays(day, 8), endsOn: addDays(day, 15) }, prisma)).resolves.toBeTruthy();

    for (const actor of [rita, ana]) {
      actAs(actor);
      await expect(registerAbsence({ substituteId: fred.id, startsOn: day, endsOn: day }, prisma)).rejects.toThrow(AuthorizationError);
    }
    // The administrator names the manager; a manager cannot name somebody else.
    actAs(admin);
    await expect(
      registerAbsence({ managerId: fred.id, substituteId: gabi.id, startsOn: addDays(day, 20), endsOn: addDays(day, 21) }, prisma),
    ).resolves.toBeTruthy();
    await expect(registerAbsence({ substituteId: gabi.id, startsOn: day, endsOn: day }, prisma)).rejects.toThrow(NotFoundError);
    actAs(gabi);
    await expect(
      registerAbsence({ managerId: fred.id, substituteId: gabi.id, startsOn: addDays(day, 30), endsOn: addDays(day, 31) }, prisma),
    ).rejects.toThrow(NotFoundError);
  });

  it("lets the substitute see, read and decide the absent manager's approvals, recorded on their behalf (CA-APM-04)", async () => {
    const { purchasing, finance, rita, gabi, fred, service, asset } = await scenario();
    const day = await today();
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Cadeira", fieldValues: { [asset.id]: "PAT-9" } }, prisma);

    // Before the absence, Fred (another sector) does not see it.
    actAs(fred);
    await expect(getManagerRequest(request.id, prisma)).rejects.toThrow(NotFoundError);
    await expect(listRequestFieldAnswers(request.id, prisma)).rejects.toThrow(NotFoundError);

    actAs(gabi);
    await registerAbsence({ substituteId: fred.id, startsOn: day, endsOn: addDays(day, 3) }, prisma);

    actAs(fred);
    await expect(getApprovalActingSectors(prisma)).resolves.toEqual([finance.id, purchasing.id]);
    await expect(listManagerApprovals("pending", prisma)).resolves.toEqual([expect.objectContaining({ id: request.id })]);
    await expect(listRequestFieldAnswers(request.id, prisma)).resolves.toEqual([expect.objectContaining({ value: "PAT-9" })]);
    await decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma);

    await expect(prisma.requestApproval.findFirstOrThrow({ where: { requestId: request.id } })).resolves.toMatchObject({
      deciderId: fred.id,
      onBehalfOfId: gabi.id,
    });
    const detail = await getManagerRequest(request.id, prisma);
    expect(detail.approval).toMatchObject({ onBehalfOf: { id: gabi.id } });

    // The absent manager still decides in the meantime.
    actAs(rita);
    const other = await createRequest({ serviceId: service.id, description: "Mesa" }, prisma);
    actAs(gabi);
    await decideApproval({ requestId: other.id, decision: "APPROVED", note: "" }, prisma);
    await expect(prisma.requestApproval.findFirstOrThrow({ where: { requestId: other.id } })).resolves.toMatchObject({ onBehalfOfId: null });
  });

  it("gives no power outside the period or after a cancellation", async () => {
    const { rita, gabi, fred, service } = await scenario();
    const day = await today();
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Cadeira" }, prisma);
    actAs(gabi);
    const future = await registerAbsence({ substituteId: fred.id, startsOn: addDays(day, 1), endsOn: addDays(day, 2) }, prisma);
    actAs(fred);
    await expect(listManagerApprovals("pending", prisma)).resolves.toEqual([]);
    await expect(decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma)).rejects.toThrow(NotFoundError);

    actAs(gabi);
    await cancelAbsence(future.id, prisma);
    const now = await registerAbsence({ substituteId: fred.id, startsOn: day, endsOn: day }, prisma);
    await cancelAbsence(now.id, prisma);
    actAs(fred);
    await expect(getManagerRequest(request.id, prisma)).rejects.toThrow(NotFoundError);
  });

  it("asks the substitutes in force for a pending approval (4.3.5)", async () => {
    const { rita, gabi, fred, service } = await scenario();
    const day = await today();
    actAs(gabi);
    await registerAbsence({ substituteId: fred.id, startsOn: day, endsOn: addDays(day, 1) }, prisma);
    actAs(rita);
    await createRequest({ serviceId: service.id, description: "Cadeira" }, prisma);
    await process();

    await expect(notificationsOf(gabi.id)).resolves.toEqual([{ type: "approval.requested" }]);
    await expect(notificationsOf(fred.id)).resolves.toEqual([{ type: "approval.requested" }]);
  });

  it("lets a manager of a later level read the answers of a request of another sector (gap of SF-164)", async () => {
    const { purchasing, finance, admin, rita, gabi, fred, service, asset } = await scenario();
    actAs(admin);
    await configureServiceApproval(service.id, { sectorIds: [purchasing.id, finance.id], conditionFieldId: null, conditionValue: null }, prisma);
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Notebook", fieldValues: { [asset.id]: "PAT-1" } }, prisma);
    actAs(fred);
    await expect(listRequestFieldAnswers(request.id, prisma)).resolves.toEqual([expect.objectContaining({ value: "PAT-1" })]);
    void gabi;
  });
});

describe("manager absences schema (SF-165)", () => {
  it("keeps the period within 90 days, the end after the start and somebody else as substitute", async () => {
    const { gabi, fred } = await scenario();
    const absence = (data: Record<string, unknown>) =>
      prisma.managerAbsence.create({
        data: { managerId: gabi.id, substituteId: fred.id, createdById: gabi.id, startsOn: new Date("2026-12-01"), endsOn: new Date("2026-12-10"), ...data },
      });
    await expect(absence({})).resolves.toBeTruthy();
    await expect(absence({ endsOn: new Date("2026-11-30") })).rejects.toThrow();
    await expect(absence({ endsOn: new Date("2027-03-01") })).rejects.toThrow();
    await expect(absence({ endsOn: new Date("2027-02-28") })).resolves.toBeTruthy();
    await expect(absence({ substituteId: gabi.id })).rejects.toThrow();
  });
});
