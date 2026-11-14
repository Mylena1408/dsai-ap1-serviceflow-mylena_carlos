import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainSector, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-09-comunicacao-e-calendarios, 3.1 item 1 and 3.3 items 1, 2 and 5 (SF-235; CA-AVI-02): the
// administrator creates, changes, closes and deletes announcements, each in the audit trail.

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { closeAnnouncement, createAnnouncement, deleteAnnouncement, listAnnouncementsForAdmin, toLocalDateTimeInput, updateAnnouncement } from "@/modules/announcements";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const HOUR = 3_600_000;

/** A date and time of the organization (UTC-3) some hours from now, as the form sends it. */
const local = (hoursFromNow: number) => toLocalDateTimeInput(new Date(Date.now() + hoursFromNow * HOUR));

async function administrator() {
  const admin = await createDomainUser({ role: "ADMIN" });
  actAs({ id: admin.id, name: admin.name, role: "ADMIN", sectorId: null, isActive: true });
  return admin;
}

const form = (overrides: Record<string, unknown> = {}) => ({
  title: "Novo catálogo",
  body: "O catálogo foi reorganizado.",
  kind: "NOTICE",
  level: "INFO",
  audience: "ALL",
  startsAt: local(2),
  endsAt: local(48),
  ...overrides,
});

const auditOf = (entityId: string) =>
  prisma.auditEntry.findMany({ where: { entityType: "ANNOUNCEMENT", entityId }, orderBy: { occurredAt: "asc" }, select: { action: true, changes: true, entityLabel: true } });

describe("announcements in the administration (SF-235)", () => {
  it("creates a maintenance for a sector with the audit trail naming the audience as the target", async () => {
    const admin = await administrator();
    const sector = await createDomainSector();

    const created = await createAnnouncement(form({ kind: "MAINTENANCE", level: "", audience: "SECTOR", audienceSectorId: sector.id, endsAt: local(6), leadHours: "" }));
    const row = await prisma.announcement.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ kind: "MAINTENANCE", level: "WARNING", leadHours: 24, audienceSectorId: sector.id, audienceRole: null, createdById: admin.id });

    const [entry] = await auditOf(created.id);
    expect(entry).toMatchObject({ action: "CREATED", entityLabel: "Novo catálogo" });
    const fields = (entry!.changes as Array<{ field: string; after: unknown }>).map(({ field, after }) => [field, after]);
    expect(fields).toEqual(
      expect.arrayContaining([
        ["kind", "MAINTENANCE"],
        ["level", "WARNING"],
        ["target", "SECTOR"],
        ["targetSectorId", sector.id],
        ["leadHours", 24],
      ]),
    );
    expect(fields.map(([field]) => field)).not.toContain("audience");
  });

  it("changes, closes and lists one going on; the audit trail records each change", async () => {
    await administrator();
    const created = await createAnnouncement(form({ startsAt: local(-1) }));

    await updateAnnouncement(created.id, form({ startsAt: local(-1), title: "Catálogo novo", level: "WARNING" }));
    await closeAnnouncement(created.id);
    const row = await prisma.announcement.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.title).toBe("Catálogo novo");
    // The end is the database's instant of the closing: before the end it had, and near now (the database's clock
    // and Node's may differ by a few milliseconds, so they are not compared exactly).
    expect(row.endsAt.getTime()).toBeLessThan(created.endsAt.getTime());
    expect(Math.abs(row.endsAt.getTime() - Date.now())).toBeLessThan(60_000);

    const entries = await auditOf(created.id);
    expect(entries.map(({ action }) => action)).toEqual(["CREATED", "UPDATED", "UPDATED"]);
    expect((entries[2]!.changes as Array<{ field: string }>).map(({ field }) => field)).toEqual(["endsAt"]);

    const overview = await listAnnouncementsForAdmin();
    expect(overview.announcements.find(({ id }) => id === created.id)).toMatchObject({ status: "ended", createdByName: expect.any(String) });
  });

  it("deletes one scheduled with the audit trail, and refuses deleting one going on", async () => {
    await administrator();
    const scheduled = await createAnnouncement(form());
    const current = await createAnnouncement(form({ startsAt: local(-1) }));

    await deleteAnnouncement(scheduled.id);
    expect(await prisma.announcement.findUnique({ where: { id: scheduled.id } })).toBeNull();
    expect((await auditOf(scheduled.id)).map(({ action }) => action)).toEqual(["CREATED", "DELETED"]);

    await expect(deleteAnnouncement(current.id)).rejects.toMatchObject({ reason: "not_scheduled" });
    await expect(closeAnnouncement(scheduled.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses an inactive sector, an end already past, and moving the start of one going on past now", async () => {
    await administrator();
    const inactive = await createDomainSector(false);
    await expect(createAnnouncement(form({ audience: "SECTOR", audienceSectorId: inactive.id }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createAnnouncement(form({ startsAt: local(-5), endsAt: local(-1) }))).rejects.toMatchObject({ reason: "ends_in_past" });

    const current = await createAnnouncement(form({ startsAt: local(-1) }));
    await expect(updateAnnouncement(current.id, form({ startsAt: local(1) }))).rejects.toMatchObject({ reason: "start_moved" });
    expect(await prisma.announcement.count({ where: { title: "Novo catálogo", createdAt: { gte: new Date(Date.now() - 60_000) } } })).toBe(1);
  });

  it("refuses a manager and an attendant", async () => {
    const sector = await createDomainSector();
    for (const role of ["MANAGER", "ATTENDANT"] as const) {
      const person = await createDomainUser({ role, sectorId: sector.id });
      actAs({ id: person.id, name: person.name, role, sectorId: sector.id, isActive: true });
      await expect(createAnnouncement(form())).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(listAnnouncementsForAdmin()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await prisma.announcement.count()).toBe(0);
  });
});
