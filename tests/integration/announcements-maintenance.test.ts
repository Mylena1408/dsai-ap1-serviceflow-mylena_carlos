import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-09-comunicacao-e-calendarios, 3.1 item 3 (SF-238; decision K2; CA-AVI-04): a maintenance shows from
// its lead and during its window, and blocks nothing.

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});
const schedule = vi.hoisted(() => ({ scheduleEventProcessing: vi.fn() }));
vi.mock("@/server/jobs/schedule", () => schedule);

import { createAnnouncement, getAnnouncementStrip, toLocalDateTimeInput } from "@/modules/announcements";
import { createRequest } from "@/modules/requests";

type Person = { id: string; name: string; role: Role; sectorId: string | null };
const as = (person: Person) => session.getCurrentUser.mockResolvedValue({ ...person, isActive: true, email: `${person.id}@example.test` });
const HOUR = 3_600_000;
const local = (hoursFromNow: number) => toLocalDateTimeInput(new Date(Date.now() + hoursFromNow * HOUR));

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  as(admin);
  const maintenance = (startsIn: number, hours: number, leadHours: number, title = "Atualização do sistema") =>
    createAnnouncement({ title, body: "O sistema pode ficar lento.", kind: "MAINTENANCE", audience: "ALL", startsAt: local(startsIn), endsAt: local(startsIn + hours), leadHours: String(leadHours) });
  return { service, admin, rita, maintenance };
}

describe("scheduled maintenance (SF-238)", () => {
  it("shows as scheduled in its lead and in progress during its window; not before the lead", async () => {
    const { rita, maintenance } = await scenario();
    await maintenance(5, 2, 24, "Anunciada");
    await maintenance(-1, 3, 24, "Em andamento");
    await maintenance(30, 2, 24, "Ainda longe");

    as(rita);
    const strip = await getAnnouncementStrip();
    expect(strip.map(({ title, phase, level, dismissible }) => [title, phase, level, dismissible])).toEqual([
      ["Anunciada", "scheduled", "WARNING", false],
      ["Em andamento", "in_progress", "WARNING", false],
    ]);
  });

  it("with no lead, appears only when the window starts", async () => {
    const { rita, maintenance } = await scenario();
    await maintenance(1, 2, 0, "Sem antecedência");
    as(rita);
    expect(await getAnnouncementStrip()).toEqual([]);
  });

  it("blocks nothing: a request is opened during the window (decision K2)", async () => {
    const { service, rita, maintenance } = await scenario();
    await maintenance(-1, 3, 24);

    as(rita);
    expect((await getAnnouncementStrip())[0]).toMatchObject({ phase: "in_progress" });
    const request = await createRequest({ serviceId: service.id, description: "Pedido durante a manutenção." }, prisma);
    expect(await prisma.request.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "OPEN", requesterId: rita.id });
  });
});
