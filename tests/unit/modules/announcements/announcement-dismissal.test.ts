import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { dismissAnnouncement, type AnnouncementDismissalStore } from "@/modules/announcements/application/announcement-dismissal";
import type { AnnouncementRecord } from "@/modules/announcements";
import { AnnouncementStripView } from "@/app/_components/announcement-strip";
import { AuthenticationError, NotFoundError, ValidationError } from "@/server/errors";

// SPEC 2026-11-09-comunicacao-e-calendarios, 3.3 item 4 (SF-237; decision K5; CA-AVI-03 for the dismissal).

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECTOR = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-22T12:00:00.000Z");

const record = (overrides: Partial<AnnouncementRecord> = {}): AnnouncementRecord => ({
  id: ID,
  title: "Novo catálogo",
  body: "O catálogo foi reorganizado.",
  kind: "NOTICE",
  level: "INFO",
  audience: "ALL",
  audienceRole: null,
  audienceSectorId: null,
  startsAt: new Date("2026-11-20T12:00:00.000Z"),
  endsAt: new Date("2026-11-27T12:00:00.000Z"),
  leadHours: null,
  createdAt: new Date("2026-11-14T12:00:00.000Z"),
  ...overrides,
});

function store(announcement: AnnouncementRecord | null = record()) {
  return {
    now: vi.fn(async () => NOW),
    find: vi.fn(async () => announcement),
    dismiss: vi.fn(async () => undefined),
  } satisfies AnnouncementDismissalStore;
}

beforeEach(() => {
  vi.clearAllMocks();
  authorization.requireCurrentActor.mockResolvedValue({ id: "u1", role: "ATTENDANT", sectorId: SECTOR, isActive: true });
});

describe("dismissAnnouncement", () => {
  it("stores the dismissal of the person at the database's instant", async () => {
    const target = store();
    await dismissAnnouncement(ID, target);
    expect(target.dismiss).toHaveBeenCalledWith({ announcementId: ID, userId: "u1", dismissedAt: NOW });
  });

  it("accepts an information notice of the person's sector", async () => {
    const target = store(record({ audience: "SECTOR", audienceSectorId: SECTOR }));
    await dismissAnnouncement(ID, target);
    expect(target.dismiss).toHaveBeenCalled();
  });

  it.each([
    ["a warning", record({ level: "WARNING" })],
    ["a maintenance", record({ kind: "MAINTENANCE", level: "WARNING", leadHours: 24, endsAt: new Date("2026-11-22T20:00:00.000Z") })],
    ["one of another audience", record({ audience: "ROLE", audienceRole: "MANAGER" })],
    ["one already ended", record({ endsAt: new Date("2026-11-21T12:00:00.000Z") })],
    ["one not started", record({ startsAt: new Date("2026-11-23T12:00:00.000Z") })],
  ])("refuses %s without storing anything", async (_label, announcement) => {
    const target = store(announcement);
    await expect(dismissAnnouncement(ID, target)).rejects.toMatchObject({ code: "CONFLICT", reason: "not_dismissable" });
    expect(target.dismiss).not.toHaveBeenCalled();
  });

  it("refuses a missing announcement, an invalid id and a person without a session", async () => {
    await expect(dismissAnnouncement(ID, store(null))).rejects.toThrow(NotFoundError);
    const target = store();
    await expect(dismissAnnouncement("x", target)).rejects.toThrow(ValidationError);
    expect(target.find).not.toHaveBeenCalled();
    authorization.requireCurrentActor.mockRejectedValue(new AuthenticationError());
    await expect(dismissAnnouncement(ID, target)).rejects.toThrow(AuthenticationError);
  });
});

describe("\"Dispensar\" in the strip", () => {
  it("only an information notice has the button, naming the announcement", () => {
    const html = renderToStaticMarkup(
      createElement(AnnouncementStripView, {
        announcements: [
          { ...record({ id: "w", level: "WARNING", title: "Sistema lento" }), dismissible: false },
          { ...record({ id: "i", title: "Novo catálogo" }), dismissible: true },
        ],
      }),
    );
    expect(html).toContain('aria-label="Dispensar o aviso Novo catálogo"');
    expect(html).not.toContain("Dispensar o aviso Sistema lento");
    expect(html).toContain('<input type="hidden" name="announcementId" value="i"/>');
    expect(html.match(/Dispensar o aviso/g)).toHaveLength(1);
  });
});
