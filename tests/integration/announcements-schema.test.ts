import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainSector, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-09-comunicacao-e-calendarios, 3.3 items 1, 2 and 4 by the database (SF-234; CA-AVI-05 and the rules of
// CA-AVI-02). Each refusal is checked by the constraint's name; the optional columns are also tried as NULL in the
// branch that needs a value, because a CHECK whose result is NULL passes.

const HOUR = 3_600_000;
const start = new Date("2026-11-20T12:00:00.000Z");
const after = (hours: number) => new Date(start.getTime() + hours * HOUR);

async function base(): Promise<Prisma.AnnouncementUncheckedCreateInput> {
  const admin = await createDomainUser({ role: "ADMIN" });
  return {
    title: "Novo catálogo",
    body: "O catálogo foi reorganizado.",
    level: "INFO",
    kind: "NOTICE",
    audience: "ALL",
    startsAt: start,
    endsAt: after(24),
    createdById: admin.id,
  };
}

describe("announcements in the database (3.3)", () => {
  it("accepts a notice, a maintenance and each audience, at the limits", async () => {
    const data = await base();
    const sector = await createDomainSector();

    await expect(prisma.announcement.create({ data: { ...data, title: "t".repeat(80), body: "b".repeat(500), endsAt: after(90 * 24) } })).resolves.toMatchObject({
      leadHours: null,
    });
    await expect(prisma.announcement.create({ data: { ...data, audience: "ROLE", audienceRole: "ATTENDANT" } })).resolves.toMatchObject({ audienceRole: "ATTENDANT" });
    await expect(prisma.announcement.create({ data: { ...data, audience: "SECTOR", audienceSectorId: sector.id } })).resolves.toMatchObject({
      audienceSectorId: sector.id,
    });
    await expect(prisma.announcement.create({ data: { ...data, kind: "MAINTENANCE", level: "WARNING", endsAt: after(24), leadHours: 168 } })).resolves.toMatchObject({
      leadHours: 168,
    });
    await expect(prisma.announcement.create({ data: { ...data, kind: "MAINTENANCE", level: "WARNING", endsAt: after(1), leadHours: 0 } })).resolves.toMatchObject({
      leadHours: 0,
    });
  });

  it("refuses titles and texts out of the limits or with spaces at the ends, and an end not after the start", async () => {
    const data = await base();
    for (const change of [
      { title: "" },
      { title: " Aviso" },
      { title: "t".repeat(81) },
      { body: "" },
      { body: "Texto " },
      { body: "b".repeat(501) },
      { endsAt: start },
      { endsAt: after(-1) },
    ]) {
      await expect(prisma.announcement.create({ data: { ...data, ...change } })).rejects.toThrow(/Announcement_values_check/);
    }
  });

  it("refuses an audience without its field, or with the field of another audience", async () => {
    const data = await base();
    const sector = await createDomainSector();
    for (const change of [
      { audience: "ROLE" as const },
      { audience: "ROLE" as const, audienceRole: null },
      { audience: "SECTOR" as const },
      { audience: "SECTOR" as const, audienceSectorId: null },
      { audience: "ALL" as const, audienceRole: "ADMIN" as const },
      { audience: "ALL" as const, audienceSectorId: sector.id },
      { audience: "ROLE" as const, audienceRole: "ADMIN" as const, audienceSectorId: sector.id },
      { audience: "SECTOR" as const, audienceSectorId: sector.id, audienceRole: "MANAGER" as const },
    ]) {
      await expect(prisma.announcement.create({ data: { ...data, ...change } })).rejects.toThrow(/Announcement_audience_check/);
    }
  });

  it("refuses a notice with a lead or over 90 days, and a maintenance that is not a warning, without a lead or out of the limits", async () => {
    const data = await base();
    const window = { ...data, kind: "MAINTENANCE" as const, level: "WARNING" as const, endsAt: after(4), leadHours: 24 };
    for (const change of [
      { ...data, leadHours: 0 },
      { ...data, endsAt: after(90 * 24 + 1) },
      { ...window, level: "INFO" as const },
      { ...window, leadHours: null },
      { ...window, leadHours: undefined },
      { ...window, leadHours: -1 },
      { ...window, leadHours: 169 },
      // One minute over 24 hours.
      { ...window, endsAt: new Date(start.getTime() + 24 * HOUR + 60_000) },
    ]) {
      await expect(prisma.announcement.create({ data: change })).rejects.toThrow(/Announcement_kind_check/);
    }
  });

  it("a person dismisses an announcement once; a dismissed or used announcement and its sector are not deleted", async () => {
    const data = await base();
    const sector = await createDomainSector();
    const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    const announcement = await prisma.announcement.create({ data: { ...data, audience: "SECTOR", audienceSectorId: sector.id } });
    const now = new Date();

    await prisma.announcementDismissal.create({ data: { announcementId: announcement.id, userId: ana.id, dismissedAt: now } });
    await expect(prisma.announcementDismissal.create({ data: { announcementId: announcement.id, userId: ana.id, dismissedAt: now } })).rejects.toMatchObject({
      code: "P2002",
    });
    await expect(prisma.announcement.delete({ where: { id: announcement.id } })).rejects.toThrow();
    await expect(prisma.sector.delete({ where: { id: sector.id } })).rejects.toThrow();
  });

  it("the audit trail accepts the announcement as an entity", async () => {
    const admin = await createDomainUser({ role: "ADMIN" });
    await expect(
      prisma.auditEntry.create({
        data: { actorId: admin.id, actorRole: "ADMIN", action: "CREATED", entityType: "ANNOUNCEMENT", entityId: randomUUID(), entityLabel: "Aviso", changes: [] },
      }),
    ).resolves.toMatchObject({ entityType: "ANNOUNCEMENT" });
  });
});
