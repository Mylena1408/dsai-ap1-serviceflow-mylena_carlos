import { describe, expect, it, vi } from "vitest";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainSector, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-09-comunicacao-e-calendarios, 3.1 item 2 and 3.3 items 2 to 4 (SF-236; CA-AVI-01 and CA-AVI-03): the
// strip of the signed-in person, read from the database at its own instant.

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { getAnnouncementStrip } from "@/modules/announcements";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const HOUR = 3_600_000;
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * HOUR);

async function scenario() {
  const ti = await createDomainSector();
  const rh = await createDomainSector();
  const admin = await createDomainUser({ role: "ADMIN" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const create = (title: string, data: Partial<Prisma.AnnouncementUncheckedCreateInput> = {}) =>
    prisma.announcement.create({
      data: {
        title,
        body: `Texto de ${title}.`,
        level: "INFO",
        kind: "NOTICE",
        audience: "ALL",
        startsAt: hoursFromNow(-2),
        endsAt: hoursFromNow(24),
        createdById: admin.id,
        ...data,
      },
    });
  return { ti, rh, admin, ana, rita, create };
}

const as = (person: { id: string; name: string; role: Role; sectorId: string | null }) => actAs({ ...person, isActive: true });
const titles = async () => (await getAnnouncementStrip()).map(({ title }) => title);

describe("the strip of announcements (SF-236)", () => {
  it("is empty without announcements (CA-AVI-01)", async () => {
    const { ana } = await scenario();
    as(ana);
    expect(await getAnnouncementStrip()).toEqual([]);
  });

  it("shows each person only the announcements of their audience", async () => {
    const { ti, rh, ana, rita, create } = await scenario();
    // Distinct starts: the most recent comes first (3.3 item 3).
    await create("Para todos", { startsAt: hoursFromNow(-1) });
    await create("Para atendentes", { audience: "ROLE", audienceRole: "ATTENDANT", startsAt: hoursFromNow(-2) });
    await create("Para o setor de Ana", { audience: "SECTOR", audienceSectorId: ti.id, startsAt: hoursFromNow(-3) });
    await create("Para outro setor", { audience: "SECTOR", audienceSectorId: rh.id });

    as(ana);
    expect(await titles()).toEqual(["Para todos", "Para atendentes", "Para o setor de Ana"]);
    as(rita);
    expect(await titles()).toEqual(["Para todos"]);
  });

  it("shows only during the period, a maintenance from its lead, and leaves the ended and future ones out", async () => {
    const { rita, create } = await scenario();
    await create("Encerrado", { startsAt: hoursFromNow(-10), endsAt: hoursFromNow(-1) });
    await create("Futuro", { startsAt: hoursFromNow(5) });
    await create("Manutenção anunciada", { kind: "MAINTENANCE", level: "WARNING", startsAt: hoursFromNow(10), endsAt: hoursFromNow(12), leadHours: 24 });
    await create("Manutenção ainda longe", { kind: "MAINTENANCE", level: "WARNING", startsAt: hoursFromNow(30), endsAt: hoursFromNow(32), leadHours: 24 });

    as(rita);
    expect(await titles()).toEqual(["Manutenção anunciada"]);
  });

  it("puts warnings first, keeps three, and leaves out a dismissed information but never a dismissed warning", async () => {
    const { rita, create } = await scenario();
    await create("Informação antiga", { startsAt: hoursFromNow(-5) });
    const dismissed = await create("Informação dispensada", { startsAt: hoursFromNow(-1) });
    await create("Informação recente", { startsAt: hoursFromNow(-1.5) });
    const warning = await create("Atenção", { level: "WARNING", startsAt: hoursFromNow(-6) });
    // A dismissal is only offered for information (SF-237); one stored for a warning would not hide it.
    for (const announcement of [dismissed, warning]) {
      await prisma.announcementDismissal.create({ data: { announcementId: announcement.id, userId: rita.id, dismissedAt: new Date() } });
    }

    as(rita);
    const strip = await getAnnouncementStrip();
    expect(strip.map(({ title, dismissible }) => [title, dismissible])).toEqual([
      ["Atenção", false],
      ["Informação recente", true],
      ["Informação antiga", true],
    ]);
  });

  it("refuses an inactive person, so the strip does not show", async () => {
    const { ana, create } = await scenario();
    await create("Para todos");
    actAs({ ...ana, isActive: false });
    await expect(getAnnouncementStrip()).rejects.toBeDefined();
  });
});
