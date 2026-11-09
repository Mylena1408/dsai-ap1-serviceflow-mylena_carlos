import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError } from "@/server/errors";
import { organizationToday } from "@/server/authorization/effective-permissions";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { exportTimeCsv, getTimeReport, logTime, deleteTimeEntry } from "@/modules/time-entries";

// SPEC 2026-11-08-atendimento-dia-a-dia, 5.1 item 3 and 5.3 item 4 (SF-209; CA-HRS-03).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const ti = await createDomainSector();
  const rh = await createDomainSector();
  const category = await createDomainCategory();
  const tiService = await createDomainService({ categoryId: category.id, sectorId: ti.id });
  const rhService = await createDomainService({ categoryId: category.id, sectorId: rh.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: ti.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
  const rui = await createDomainUser({ role: "ATTENDANT", sectorId: rh.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const tiRequest = await createDomainRequest({ requesterId: rita.id, serviceId: tiService.id, sectorId: ti.id });
  const rhRequest = await createDomainRequest({ requesterId: rita.id, serviceId: rhService.id, sectorId: rh.id });
  const today = await organizationToday(prisma);

  actAs(ana);
  await logTime({ requestId: tiRequest.id, workedOn: today, hours: 1, minutes: 30, note: "Nota interna" });
  const removed = await logTime({ requestId: tiRequest.id, workedOn: today, hours: 5, minutes: 0 });
  await deleteTimeEntry(removed.id);
  actAs(rui);
  await logTime({ requestId: rhRequest.id, workedOn: today, hours: 0, minutes: 45 });
  return { ti, rh, admin, gabi, ana, rita, tiRequest };
}

describe("the time report (5.3 item 4; CA-HRS-03)", () => {
  it("the manager sees their sector, whatever the URL says; removed entries do not count", async () => {
    const { ti, rh, gabi, ana } = await scenario();
    actAs(gabi);
    const report = await getTimeReport({ period: "7", sector: rh.id });
    expect(report.sector).toEqual({ id: ti.id, name: expect.any(String) });
    expect(report.totalMinutes).toBe(90);
    expect(report.byAttendant.map(({ label, minutes }) => [label, minutes])).toEqual([[ana.name, 90]]);
  });

  it("the administrator sees every sector or one", async () => {
    const { rh, admin } = await scenario();
    actAs(admin);
    const all = await getTimeReport({ period: "7" });
    expect(all.totalMinutes).toBeGreaterThanOrEqual(135);
    expect(all.bySector.length).toBeGreaterThanOrEqual(2);
    const one = await getTimeReport({ period: "7", sector: rh.id });
    expect(one.totalMinutes).toBe(45);
  });

  it("attendants and requesters have no report", async () => {
    const { ana, rita } = await scenario();
    for (const actor of [ana, rita]) {
      actAs(actor);
      await expect(getTimeReport({ period: "7" })).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("the CSV has the sector's entries, with the short code and without the note or the description", async () => {
    const { gabi, ana, tiRequest } = await scenario();
    actAs(gabi);
    const csv = await exportTimeCsv({ period: "7" });
    const lines = csv.content.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`;${ana.name};`);
    expect(lines[1]).toContain(`;${tiRequest.id.slice(0, 8).toUpperCase()};90;1,50`);
    expect(csv.content).not.toContain("Nota interna");
    expect(csv.fileName).toMatch(/^serviceflow-horas-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
