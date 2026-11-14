import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_HISTORY_DAYS,
  DEFAULT_LEAD_HOURS,
  MAX_VISIBLE_ANNOUNCEMENTS,
  announcementHistory,
  announcementInputSchema,
  announcementStatus,
  assertCanBeDismissed,
  assertCanChange,
  assertCanDelete,
  assertEndsInFuture,
  canDismiss,
  closingEnd,
  isShownAt,
  maintenancePhase,
  parseLocalDateTime,
  reaches,
  stripStartsAt,
  visibleAnnouncements,
  type AnnouncementRecord,
  type AnnouncementViewer,
} from "@/modules/announcements";
import { ConflictError } from "@/server/errors";
import { validateInput } from "@/server/validation";

// SPEC 2026-11-09-comunicacao-e-calendarios, 3.3 (SF-234; decisions K2, K5 and K6).

const SECTOR = "11111111-1111-4111-8111-111111111111";
const OTHER_SECTOR = "22222222-2222-4222-8222-222222222222";
const HOUR = 3_600_000;
const at = (iso: string) => new Date(iso);

const notice = {
  title: "Novo catálogo",
  body: "O catálogo de serviços foi reorganizado.",
  kind: "NOTICE",
  level: "INFO",
  audience: "ALL",
  startsAt: "2026-11-20T09:00",
  endsAt: "2026-11-27T18:00",
};

const maintenance = {
  title: "Manutenção do sistema",
  body: "O sistema pode ficar lento.",
  kind: "MAINTENANCE",
  audience: "ALL",
  startsAt: "2026-11-21T22:00",
  endsAt: "2026-11-22T02:00",
};

const parse = (input: object) => announcementInputSchema.safeParse(input);
const failedPaths = (input: object) => {
  const result = parse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("parseLocalDateTime", () => {
  it("reads a date and time of the organization's time zone (UTC-3)", () => {
    expect(parseLocalDateTime("2026-11-20T09:00")).toEqual(at("2026-11-20T12:00:00.000Z"));
    expect(parseLocalDateTime("2026-12-31T23:59")).toEqual(at("2027-01-01T02:59:00.000Z"));
  });

  it.each(["", "2026-11-20", "2026-11-20 09:00", "2026-11-20T9:00", "2026-11-20T24:00", "2026-11-20T09:60", "2026-02-30T10:00", "2026-11-20T09:00:00"])(
    "refuses %j",
    (value) => {
      expect(parseLocalDateTime(value)).toBeNull();
    },
  );
});

describe("announcementInputSchema (3.3 items 1 and 2)", () => {
  it("keeps a notice as typed, trimmed, with the instants and no lead", () => {
    expect(validateInput(announcementInputSchema, { ...notice, title: "  Novo catálogo  ", leadHours: "12" })).toEqual({
      title: "Novo catálogo",
      body: "O catálogo de serviços foi reorganizado.",
      kind: "NOTICE",
      level: "INFO",
      audience: "ALL",
      audienceRole: null,
      audienceSectorId: null,
      startsAt: at("2026-11-20T12:00:00.000Z"),
      endsAt: at("2026-11-27T21:00:00.000Z"),
      leadHours: null,
    });
  });

  it("makes a maintenance a warning with the default lead of 24 hours", () => {
    const data = validateInput(announcementInputSchema, { ...maintenance, level: "INFO" });
    expect(data).toMatchObject({ kind: "MAINTENANCE", level: "WARNING", leadHours: DEFAULT_LEAD_HOURS });
    expect(validateInput(announcementInputSchema, { ...maintenance, leadHours: "0" }).leadHours).toBe(0);
    expect(validateInput(announcementInputSchema, { ...maintenance, leadHours: 168 }).leadHours).toBe(168);
  });

  it("keeps only the field of the chosen audience, and empty fields are absent", () => {
    expect(validateInput(announcementInputSchema, { ...notice, audience: "ROLE", audienceRole: "ATTENDANT", audienceSectorId: SECTOR })).toMatchObject({
      audienceRole: "ATTENDANT",
      audienceSectorId: null,
    });
    expect(validateInput(announcementInputSchema, { ...notice, audience: "SECTOR", audienceRole: "", audienceSectorId: SECTOR })).toMatchObject({
      audienceRole: null,
      audienceSectorId: SECTOR,
    });
    expect(validateInput(announcementInputSchema, { ...notice, audienceRole: "MANAGER", audienceSectorId: "" })).toMatchObject({
      audience: "ALL",
      audienceRole: null,
      audienceSectorId: null,
    });
  });

  it("accepts the limits: 80 and 500 characters, 90 days for a notice, 24 hours for a maintenance", () => {
    expect(parse({ ...notice, title: "t".repeat(80), body: "b".repeat(500) }).success).toBe(true);
    expect(parse({ ...notice, startsAt: "2026-11-01T00:00", endsAt: "2027-01-30T00:00" }).success).toBe(true);
    expect(parse({ ...maintenance, startsAt: "2026-11-21T22:00", endsAt: "2026-11-22T22:00" }).success).toBe(true);
  });

  it.each([
    ["an empty title", { ...notice, title: "   " }, ["title"]],
    ["a title of 81 characters", { ...notice, title: "t".repeat(81) }, ["title"]],
    ["a text of 501 characters", { ...notice, body: "b".repeat(501) }, ["body"]],
    ["a notice without a level", { ...notice, level: "" }, ["level"]],
    ["an unknown level", { ...notice, level: "URGENT" }, ["level"]],
    ["the audience of a role without the role", { ...notice, audience: "ROLE" }, ["audienceRole"]],
    ["the audience of a sector without the sector", { ...notice, audience: "SECTOR" }, ["audienceSectorId"]],
    ["a sector that is not an id", { ...notice, audience: "SECTOR", audienceSectorId: "TI" }, ["audienceSectorId"]],
    ["an end at the start", { ...notice, endsAt: notice.startsAt }, ["endsAt"]],
    ["an end before the start", { ...notice, endsAt: "2026-11-19T09:00" }, ["endsAt"]],
    ["a notice over 90 days", { ...notice, startsAt: "2026-11-01T00:00", endsAt: "2027-01-30T00:01" }, ["endsAt"]],
    ["a maintenance over 24 hours", { ...maintenance, endsAt: "2026-11-22T22:01" }, ["endsAt"]],
    ["a lead over 168 hours", { ...maintenance, leadHours: "169" }, ["leadHours"]],
    ["a negative lead", { ...maintenance, leadHours: -1 }, ["leadHours"]],
    ["a lead that is not whole", { ...maintenance, leadHours: "1.5" }, ["leadHours"]],
    ["a start that is not a date and time", { ...notice, startsAt: "amanhã" }, ["startsAt"]],
    ["an unknown field", { ...notice, color: "red" }, [""]],
  ])("refuses %s", (_label, input, paths) => {
    expect(failedPaths(input)).toEqual(paths);
  });
});

const record = (overrides: Partial<AnnouncementRecord> = {}): AnnouncementRecord => ({
  id: "a1",
  title: "Aviso",
  body: "Texto",
  kind: "NOTICE",
  level: "INFO",
  audience: "ALL",
  audienceRole: null,
  audienceSectorId: null,
  startsAt: at("2026-11-20T12:00:00.000Z"),
  endsAt: at("2026-11-27T12:00:00.000Z"),
  leadHours: null,
  createdAt: at("2026-11-14T12:00:00.000Z"),
  ...overrides,
});

const attendant: AnnouncementViewer = { id: "u1", role: "ATTENDANT", sectorId: SECTOR };
const requester: AnnouncementViewer = { id: "u2", role: "REQUESTER", sectorId: null };
const during = at("2026-11-22T12:00:00.000Z");

describe("audience and period (3.3 item 2; 3.1 item 3)", () => {
  it("reaches everyone, the people of a role, or the people of a sector", () => {
    expect(reaches(record(), requester)).toBe(true);
    expect(reaches(record({ audience: "ROLE", audienceRole: "ATTENDANT" }), attendant)).toBe(true);
    expect(reaches(record({ audience: "ROLE", audienceRole: "ATTENDANT" }), requester)).toBe(false);
    expect(reaches(record({ audience: "SECTOR", audienceSectorId: SECTOR }), attendant)).toBe(true);
    expect(reaches(record({ audience: "SECTOR", audienceSectorId: OTHER_SECTOR }), attendant)).toBe(false);
    expect(reaches(record({ audience: "SECTOR", audienceSectorId: SECTOR }), requester)).toBe(false);
  });

  it("shows a notice from its start until its end, the end excluded", () => {
    const announcement = record();
    expect(isShownAt(announcement, at("2026-11-20T11:59:59.999Z"))).toBe(false);
    expect(isShownAt(announcement, at("2026-11-20T12:00:00.000Z"))).toBe(true);
    expect(isShownAt(announcement, at("2026-11-27T11:59:59.999Z"))).toBe(true);
    expect(isShownAt(announcement, at("2026-11-27T12:00:00.000Z"))).toBe(false);
  });

  it("shows a maintenance from the lead before the window, and tells the phase", () => {
    const window = record({ kind: "MAINTENANCE", level: "WARNING", startsAt: at("2026-11-22T01:00:00.000Z"), endsAt: at("2026-11-22T05:00:00.000Z"), leadHours: 24 });
    expect(stripStartsAt(window)).toEqual(at("2026-11-21T01:00:00.000Z"));
    expect(isShownAt(window, at("2026-11-21T00:59:00.000Z"))).toBe(false);
    expect(isShownAt(window, at("2026-11-21T01:00:00.000Z"))).toBe(true);
    expect(maintenancePhase(window, at("2026-11-21T20:00:00.000Z"))).toBe("scheduled");
    expect(maintenancePhase(window, at("2026-11-22T01:00:00.000Z"))).toBe("in_progress");
    expect(isShownAt(window, at("2026-11-22T05:00:00.000Z"))).toBe(false);
    expect(maintenancePhase(record(), during)).toBeNull();
    // Without a lead, the strip starts with the window.
    expect(stripStartsAt({ ...window, leadHours: 0 })).toEqual(window.startsAt);
  });
});

describe("the strip (3.3 items 3 and 4)", () => {
  it("only an information notice can be dismissed", () => {
    expect(canDismiss(record())).toBe(true);
    expect(canDismiss(record({ level: "WARNING" }))).toBe(false);
    expect(canDismiss(record({ kind: "MAINTENANCE", level: "WARNING" }))).toBe(false);
  });

  it("puts warnings and maintenance first, then the most recent start, at most three", () => {
    const list = [
      record({ id: "old-info", startsAt: at("2026-11-18T12:00:00.000Z") }),
      record({ id: "new-info", startsAt: at("2026-11-21T12:00:00.000Z") }),
      record({ id: "warning", level: "WARNING", startsAt: at("2026-11-15T12:00:00.000Z") }),
      record({ id: "maintenance", kind: "MAINTENANCE", level: "WARNING", startsAt: at("2026-11-22T14:00:00.000Z"), endsAt: at("2026-11-22T16:00:00.000Z"), leadHours: 24 }),
    ];
    const shown = visibleAnnouncements(list, attendant, during, new Set());
    expect(shown.map(({ id }) => id)).toEqual(["maintenance", "warning", "new-info"]);
    expect(shown).toHaveLength(MAX_VISIBLE_ANNOUNCEMENTS);
  });

  it("leaves out other audiences, the ones not shown now and the dismissed information", () => {
    const list = [
      record({ id: "dismissed" }),
      record({ id: "dismissed-warning", level: "WARNING" }),
      record({ id: "other-sector", audience: "SECTOR", audienceSectorId: OTHER_SECTOR }),
      record({ id: "future", startsAt: at("2026-11-25T12:00:00.000Z") }),
      record({ id: "ended", endsAt: at("2026-11-21T12:00:00.000Z") }),
      record({ id: "mine", audience: "SECTOR", audienceSectorId: SECTOR }),
    ];
    // A dismissal of a warning is never stored, and would not hide it anyway (rule 4).
    const shown = visibleAnnouncements(list, attendant, during, new Set(["dismissed", "dismissed-warning"]));
    expect(shown.map(({ id }) => id)).toEqual(["dismissed-warning", "mine"]);
  });

  it("orders by creation and then id when the start is the same", () => {
    const list = [
      record({ id: "b", createdAt: at("2026-11-14T10:00:00.000Z") }),
      record({ id: "c", createdAt: at("2026-11-14T11:00:00.000Z") }),
      record({ id: "a", createdAt: at("2026-11-14T10:00:00.000Z") }),
    ];
    expect(visibleAnnouncements(list, requester, during, new Set()).map(({ id }) => id)).toEqual(["c", "a", "b"]);
  });

  it("a person dismisses only an information notice of their audience shown now", () => {
    expect(() => assertCanBeDismissed(record(), attendant, during)).not.toThrow();
    expect(() => assertCanBeDismissed(record({ level: "WARNING" }), attendant, during)).toThrow(ConflictError);
    expect(() => assertCanBeDismissed(record({ audience: "ROLE", audienceRole: "MANAGER" }), attendant, during)).toThrow(ConflictError);
    expect(() => assertCanBeDismissed(record(), attendant, at("2026-11-28T12:00:00.000Z"))).toThrow(ConflictError);
  });
});

describe("the page \"Avisos\" (3.1 item 4)", () => {
  it("lists the ones of the audience shown now first, then the ended ones of the last 90 days by start", () => {
    const now = during;
    const list = [
      record({ id: "ended-recent", startsAt: at("2026-11-01T12:00:00.000Z"), endsAt: at("2026-11-05T12:00:00.000Z") }),
      record({ id: "current" }),
      record({ id: "ended-old", startsAt: at("2026-08-01T12:00:00.000Z"), endsAt: at(new Date(now.getTime() - ANNOUNCEMENT_HISTORY_DAYS * 24 * HOUR).toISOString()) }),
      record({ id: "future", startsAt: at("2026-11-25T12:00:00.000Z") }),
      record({ id: "other", audience: "ROLE", audienceRole: "MANAGER" }),
      record({ id: "ended-later", startsAt: at("2026-11-10T12:00:00.000Z"), endsAt: at("2026-11-12T12:00:00.000Z") }),
    ];
    expect(announcementHistory(list, attendant, now).map(({ id }) => id)).toEqual(["current", "ended-later", "ended-recent"]);
  });

  it("includes a maintenance announced in its lead", () => {
    const window = record({ id: "m", kind: "MAINTENANCE", level: "WARNING", startsAt: at("2026-11-23T01:00:00.000Z"), endsAt: at("2026-11-23T03:00:00.000Z"), leadHours: 24 });
    expect(announcementHistory([window], requester, during).map(({ id }) => id)).toEqual(["m"]);
  });
});

describe("what the administration may do (3.3 item 5)", () => {
  const announcement = record();

  it("tells the status from the start (the window, for a maintenance)", () => {
    expect(announcementStatus(announcement, at("2026-11-20T11:59:00.000Z"))).toBe("scheduled");
    expect(announcementStatus(announcement, at("2026-11-20T12:00:00.000Z"))).toBe("current");
    expect(announcementStatus(announcement, at("2026-11-27T12:00:00.000Z"))).toBe("ended");
    // A maintenance in its lead is still scheduled: it may be changed or deleted (cancelled).
    const window = record({ kind: "MAINTENANCE", level: "WARNING", startsAt: at("2026-11-23T01:00:00.000Z"), endsAt: at("2026-11-23T03:00:00.000Z"), leadHours: 24 });
    expect(announcementStatus(window, at("2026-11-22T12:00:00.000Z"))).toBe("scheduled");
  });

  it("deletes only before the start", () => {
    expect(() => assertCanDelete(announcement, at("2026-11-19T12:00:00.000Z"))).not.toThrow();
    expect(() => assertCanDelete(announcement, during)).toThrow(ConflictError);
  });

  it("closes only while it goes on, with the end at that instant", () => {
    expect(closingEnd(announcement, during)).toEqual(during);
    expect(() => closingEnd(announcement, at("2026-11-19T12:00:00.000Z"))).toThrow(ConflictError);
    expect(() => closingEnd(announcement, at("2026-11-28T12:00:00.000Z"))).toThrow(ConflictError);
  });

  it("changes until it ends, and only with an end still in the future", () => {
    expect(() => assertCanChange(announcement, during)).not.toThrow();
    expect(() => assertCanChange(announcement, at("2026-11-27T12:00:00.000Z"))).toThrow(ConflictError);
    expect(() => assertEndsInFuture(announcement, during)).not.toThrow();
    expect(() => assertEndsInFuture(announcement, at("2026-11-27T12:00:00.000Z"))).toThrow(ConflictError);
  });
});
