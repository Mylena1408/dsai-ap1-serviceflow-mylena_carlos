import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 4.3 item 7 (SF-182; CA-DST-05).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { cancelAttendantAbsence, listAttendantAbsences, registerAttendantAbsence } from "@/modules/absences";
import { handOverAbsentAttendants } from "@/modules/requests";
import { runDailyJob } from "@/server/jobs";
import { organizationToday } from "@/server/authorization/effective-permissions";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

function shift(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

async function named(role: Role, name: string, sectorId: string | null = null) {
  const user = await createDomainUser({ role, sectorId });
  return prisma.user.update({ where: { id: user.id }, data: { name } });
}

async function scenario(settings: { distributionMode?: "NONE" | "ROUND_ROBIN" | "LEAST_LOAD"; redistributeOnAbsence?: boolean } = {}) {
  const sector = await createDomainSector();
  await prisma.sector.update({ where: { id: sector.id }, data: { distributionMode: "ROUND_ROBIN", redistributeOnAbsence: true, ...settings } });
  const service = await createDomainService({ categoryId: (await createDomainCategory()).id, sectorId: sector.id });
  const admin = await named("ADMIN", "Admin");
  const gabi = await named("MANAGER", "Gabi", sector.id);
  const rita = await named("REQUESTER", "Rita");
  const ana = await named("ATTENDANT", "Ana", sector.id);
  const bia = await named("ATTENDANT", "Bia", sector.id);
  const caio = await named("ATTENDANT", "Caio", sector.id);
  const today = await organizationToday(prisma);
  const held = async (assigneeId: string, status: "OPEN" | "IN_PROGRESS" = "OPEN") => {
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    return prisma.request.update({ where: { id: request.id }, data: { assigneeId, status } });
  };
  return { sector, admin, gabi, rita, ana, bia, caio, today, held };
}

describe("registering attendants' absences (4.3 item 7)", () => {
  it("by the administrator, the sector's manager or the attendant; refused for others and out of the rules", async () => {
    const { admin, gabi, ana, bia, today } = await scenario();
    actAs(admin);
    await registerAttendantAbsence({ userId: ana.id, startsOn: today, endsOn: shift(today, 2) }, prisma);
    await expect(registerAttendantAbsence({ userId: ana.id, startsOn: shift(today, 1), endsOn: shift(today, 3) }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(registerAttendantAbsence({ userId: ana.id, startsOn: shift(today, 10), endsOn: shift(today, 101) }, prisma)).rejects.toBeInstanceOf(ValidationError);

    actAs(gabi);
    await registerAttendantAbsence({ userId: bia.id, startsOn: shift(today, 5), endsOn: shift(today, 6) }, prisma);
    const other = await createDomainSector();
    const zeca = await named("ATTENDANT", "Zeca", other.id);
    await expect(registerAttendantAbsence({ userId: zeca.id, startsOn: today, endsOn: today }, prisma)).rejects.toBeInstanceOf(NotFoundError);

    actAs(bia);
    await registerAttendantAbsence({ startsOn: shift(today, 20), endsOn: shift(today, 21) }, prisma);
    await expect(registerAttendantAbsence({ userId: ana.id, startsOn: shift(today, 30), endsOn: shift(today, 31) }, prisma)).rejects.toBeInstanceOf(NotFoundError);
    const own = await listAttendantAbsences(prisma);
    expect(own.absences.map(({ attendant }) => attendant.name)).toEqual(["Bia", "Bia"]);

    actAs(gabi);
    const sector = await listAttendantAbsences(prisma);
    expect(sector.absences).toHaveLength(3);
    expect(sector.attendants.map(({ name }) => name)).toEqual(["Ana", "Bia", "Caio"]);
    const [later] = sector.absences.filter(({ attendant, startsOn }) => attendant.name === "Bia" && startsOn === shift(today, 20));
    await cancelAttendantAbsence(later.id, prisma);
    await expect(cancelAttendantAbsence(later.id, prisma)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("handing over an absent attendant's requests (4.3 item 7; CA-DST-05)", () => {
  it("on the first run of the absence, by the sector's mode, once, with history, event and warning", async () => {
    const { ana, bia, caio, today, held } = await scenario();
    const open = await held(ana.id);
    const started = await held(ana.id, "IN_PROGRESS");
    await prisma.attendantAbsence.create({ data: { userId: ana.id, createdById: ana.id, startsOn: new Date(`${today}T00:00:00Z`), endsOn: new Date(`${shift(today, 2)}T00:00:00Z`) } });

    const summary = await runDailyJob();
    expect(summary.absenceHandover).toEqual({ status: "ok", result: { absences: 1, handedOver: 2, kept: 0 } });
    const holders = await prisma.request.findMany({ where: { id: { in: [open.id, started.id] } }, select: { assigneeId: true } });
    expect(holders.map(({ assigneeId }) => assigneeId).sort()).toEqual([bia.id, caio.id].sort());
    const events = await prisma.requestAssignmentEvent.findMany({ where: { requestId: { in: [open.id, started.id] } } });
    expect(events.every((event) => event.actorId === null && event.reason === "ABSENCE" && event.fromAssigneeId === ana.id)).toBe(true);
    const warned = await prisma.requestNotification.findMany({ where: { type: "assignment.received", requestId: { in: [open.id, started.id] } } });
    expect(warned.map(({ recipientId }) => recipientId).sort()).toEqual([bia.id, caio.id].sort());

    // A second run hands over nothing more, even with a new request held by Ana.
    await held(ana.id);
    await expect(handOverAbsentAttendants(prisma)).resolves.toEqual({ absences: 0, handedOver: 0, kept: 0 });
  });

  it("without anyone available the request stays; a sector that did not choose it or a future absence hands over nothing", async () => {
    const lone = await scenario();
    await prisma.user.updateMany({ where: { id: { in: [lone.bia.id, lone.caio.id] } }, data: { isActive: false } });
    const kept = await lone.held(lone.ana.id);
    await prisma.attendantAbsence.create({ data: { userId: lone.ana.id, createdById: lone.ana.id, startsOn: new Date(`${lone.today}T00:00:00Z`), endsOn: new Date(`${lone.today}T00:00:00Z`) } });
    await expect(handOverAbsentAttendants(prisma)).resolves.toEqual({ absences: 1, handedOver: 0, kept: 1 });
    expect((await prisma.request.findUniqueOrThrow({ where: { id: kept.id } })).assigneeId).toBe(lone.ana.id);

    const off = await scenario({ redistributeOnAbsence: false });
    const stays = await off.held(off.ana.id);
    await prisma.attendantAbsence.create({ data: { userId: off.ana.id, createdById: off.ana.id, startsOn: new Date(`${off.today}T00:00:00Z`), endsOn: new Date(`${off.today}T00:00:00Z`) } });
    const future = await scenario();
    await future.held(future.ana.id);
    await prisma.attendantAbsence.create({ data: { userId: future.ana.id, createdById: future.ana.id, startsOn: new Date(`${shift(future.today, 1)}T00:00:00Z`), endsOn: new Date(`${shift(future.today, 2)}T00:00:00Z`) } });
    await expect(handOverAbsentAttendants(prisma)).resolves.toEqual({ absences: 0, handedOver: 0, kept: 0 });
    expect((await prisma.request.findUniqueOrThrow({ where: { id: stays.id } })).assigneeId).toBe(off.ana.id);
  });

  it("the absent attendant receives nothing by the distribution while away", async () => {
    const { ana, bia, today, rita, sector } = await scenario();
    await prisma.attendantAbsence.create({ data: { userId: ana.id, createdById: ana.id, startsOn: new Date(`${today}T00:00:00Z`), endsOn: new Date(`${today}T00:00:00Z`) } });
    const service = await prisma.service.findFirstOrThrow({ where: { sectorId: sector.id } });
    const { createRequest } = await import("@/modules/requests");
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Durante a ausência" }, prisma);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: request.id } })).assigneeId).toBe(bia.id);
  });
});
