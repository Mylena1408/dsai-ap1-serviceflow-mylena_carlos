import { describe, expect, it, vi } from "vitest";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainSector, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-09-comunicacao-e-calendarios, 3.3 item 4 (SF-237; decision K5; CA-AVI-03 for the dismissal): a person
// dismisses an information notice of their strip, once, and only for themselves.

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { dismissAnnouncement, getAnnouncementStrip } from "@/modules/announcements";

type Person = { id: string; name: string; role: Role; sectorId: string | null };
const as = (person: Person) => session.getCurrentUser.mockResolvedValue({ ...person, isActive: true, email: `${person.id}@example.test` });
const HOUR = 3_600_000;
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * HOUR);

async function scenario() {
  const sector = await createDomainSector();
  const admin = await createDomainUser({ role: "ADMIN" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const create = (title: string, data: Partial<Prisma.AnnouncementUncheckedCreateInput> = {}) =>
    prisma.announcement.create({
      data: { title, body: "Texto.", level: "INFO", kind: "NOTICE", audience: "ALL", startsAt: hoursFromNow(-1), endsAt: hoursFromNow(24), createdById: admin.id, ...data },
    });
  return { sector, ana, rita, create };
}

const titles = async () => (await getAnnouncementStrip()).map(({ title }) => title);

describe("dismissing an announcement (SF-237)", () => {
  it("hides it from that person only, and dismissing again changes nothing", async () => {
    const { ana, rita, create } = await scenario();
    const notice = await create("Novo catálogo");

    as(rita);
    await dismissAnnouncement(notice.id);
    await dismissAnnouncement(notice.id);
    expect(await titles()).toEqual([]);
    expect(await prisma.announcementDismissal.count({ where: { announcementId: notice.id } })).toBe(1);

    as(ana);
    expect(await titles()).toEqual(["Novo catálogo"]);
  });

  it("two dismissals at the same time store one row", async () => {
    const { rita, create } = await scenario();
    const notice = await create("Novo catálogo");
    as(rita);
    await Promise.all([dismissAnnouncement(notice.id), dismissAnnouncement(notice.id), dismissAnnouncement(notice.id)]);
    expect(await prisma.announcementDismissal.count({ where: { announcementId: notice.id, userId: rita.id } })).toBe(1);
  });

  it("refuses a warning, a maintenance, another audience, an ended and a future announcement, storing nothing", async () => {
    const { sector, rita, create } = await scenario();
    const refused = [
      await create("Atenção", { level: "WARNING" }),
      await create("Manutenção", { kind: "MAINTENANCE", level: "WARNING", startsAt: hoursFromNow(2), endsAt: hoursFromNow(4), leadHours: 24 }),
      await create("Do setor", { audience: "SECTOR", audienceSectorId: sector.id }),
      await create("Encerrado", { startsAt: hoursFromNow(-5), endsAt: hoursFromNow(-1) }),
      await create("Futuro", { startsAt: hoursFromNow(5) }),
    ];
    as(rita);
    for (const announcement of refused) {
      await expect(dismissAnnouncement(announcement.id)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(await prisma.announcementDismissal.count({ where: { userId: rita.id } })).toBe(0);
  });

  it("a dismissed announcement whose level becomes a warning shows again", async () => {
    const { rita, create } = await scenario();
    const notice = await create("Novo catálogo");
    as(rita);
    await dismissAnnouncement(notice.id);
    await prisma.announcement.update({ where: { id: notice.id }, data: { level: "WARNING" } });
    expect(await titles()).toEqual(["Novo catálogo"]);
  });
});
