import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { organizationToday } from "@/server/authorization/effective-permissions";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { deleteTimeEntry, logTime, updateTimeEntry } from "@/modules/time-entries";

// SPEC 2026-11-08-atendimento-dia-a-dia, 5.3 items 1 to 3 (SF-207; the entries of CA-HRS-02).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const DAY = 24 * 60 * 60 * 1000;

function shift(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
}

async function scenario() {
  const sector = await createDomainSector();
  const other = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: other.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  const today = await organizationToday(prisma);
  return { ana, bia, caio, gabi, rita, request, today };
}

const events = (requestId: string) =>
  prisma.requestTimeEntryEvent.findMany({ where: { requestId }, orderBy: { occurredAt: "asc" }, select: { action: true, minutes: true, actorId: true } });

describe("logging time (5.3 items 1 and 2)", () => {
  it("any attendant of the sector logs, not only the assignee, with the history", async () => {
    const { ana, bia, request, today } = await scenario();
    actAs(bia);
    const entry = await logTime({ requestId: request.id, workedOn: today, hours: 1, minutes: 30, note: "Visita" });
    expect(entry).toMatchObject({ userId: bia.id, workedOn: today, minutes: 90, note: "Visita", deletedAt: null });
    actAs(ana);
    await logTime({ requestId: request.id, workedOn: today, hours: 0, minutes: 20 });
    expect(await events(request.id)).toEqual([
      { action: "CREATED", minutes: 90, actorId: bia.id },
      { action: "CREATED", minutes: 20, actorId: ana.id },
    ]);
  });

  it("refuses other sectors, the manager and the requester; a day before the opening or after today", async () => {
    const { ana, caio, gabi, rita, request, today } = await scenario();
    for (const actor of [caio, gabi, rita]) {
      actAs(actor);
      await expect(logTime({ requestId: request.id, workedOn: today, hours: 1, minutes: 0 })).rejects.toBeInstanceOf(NotFoundError);
    }
    actAs(ana);
    await expect(logTime({ requestId: request.id, workedOn: shift(today, 1), hours: 1, minutes: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(logTime({ requestId: request.id, workedOn: shift(today, -1), hours: 1, minutes: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(logTime({ requestId: request.id, workedOn: today, hours: 0, minutes: 0 })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.requestTimeEntry.count({ where: { requestId: request.id } })).toBe(0);
  });

  it("never on a cancelled request; after the completion, for up to 7 days (decision I10)", async () => {
    const { ana, request, today } = await scenario();
    actAs(ana);
    await prisma.request.update({ where: { id: request.id }, data: { status: "COMPLETED", completedAt: new Date(Date.now() - 6 * DAY) } });
    await expect(logTime({ requestId: request.id, workedOn: today, hours: 1, minutes: 0 })).resolves.toMatchObject({ minutes: 60 });

    await prisma.request.update({ where: { id: request.id }, data: { completedAt: new Date(Date.now() - 8 * DAY) } });
    await expect(logTime({ requestId: request.id, workedOn: today, hours: 1, minutes: 0 })).rejects.toBeInstanceOf(ConflictError);

    await prisma.request.update({ where: { id: request.id }, data: { status: "CANCELLED", completedAt: null, cancelledAt: new Date() } });
    await expect(logTime({ requestId: request.id, workedOn: today, hours: 1, minutes: 0 })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("changing and removing (5.3 item 3; decision I11)", () => {
  it("only the person who logged it changes and removes it; removing marks it and keeps the history", async () => {
    const { ana, bia, request, today } = await scenario();
    actAs(ana);
    const entry = await logTime({ requestId: request.id, workedOn: today, hours: 1, minutes: 0 });

    actAs(bia);
    await expect(updateTimeEntry(entry.id, { workedOn: today, hours: 2, minutes: 0 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteTimeEntry(entry.id)).rejects.toBeInstanceOf(NotFoundError);

    actAs(ana);
    await expect(updateTimeEntry(entry.id, { workedOn: today, hours: 2, minutes: 15, note: "Revisado" })).resolves.toMatchObject({
      minutes: 135,
      note: "Revisado",
    });
    // The same values change nothing and record nothing.
    await updateTimeEntry(entry.id, { workedOn: today, hours: 2, minutes: 15, note: "Revisado" });
    await deleteTimeEntry(entry.id);
    await expect(prisma.requestTimeEntry.findUniqueOrThrow({ where: { id: entry.id } })).resolves.toMatchObject({ deletedAt: expect.any(Date) });
    expect((await events(request.id)).map(({ action, minutes }) => [action, minutes])).toEqual([
      ["CREATED", 60],
      ["UPDATED", 135],
      ["DELETED", 135],
    ]);
    // A removed entry no longer changes.
    await expect(updateTimeEntry(entry.id, { workedOn: today, hours: 1, minutes: 0 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("up to 7 days after logging", async () => {
    const { ana, request, today } = await scenario();
    actAs(ana);
    const entry = await logTime({ requestId: request.id, workedOn: today, hours: 1, minutes: 0 });
    await prisma.requestTimeEntry.update({ where: { id: entry.id }, data: { createdAt: new Date(Date.now() - 8 * DAY) } });
    await expect(updateTimeEntry(entry.id, { workedOn: today, hours: 2, minutes: 0 })).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteTimeEntry(entry.id)).rejects.toBeInstanceOf(ConflictError);
  });
});
