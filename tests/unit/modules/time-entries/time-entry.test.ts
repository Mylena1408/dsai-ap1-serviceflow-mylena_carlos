import { describe, expect, it } from "vitest";
import {
  assertCanChangeEntry,
  assertCanLogTime,
  assertWorkedOnInRange,
  canChangeEntry,
  estimateLabel,
  estimatedHoursSchema,
  formatMinutes,
  timeEntryInputSchema,
  timeTotals,
  type TimeActor,
  type TimedRequest,
} from "@/modules/time-entries";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

// SPEC 2026-11-08-atendimento-dia-a-dia, part C and 13.2 (SF-206).

const now = new Date("2026-11-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ana: TimeActor = { id: "ana", role: "ATTENDANT", isActive: true, sectorId: "ti" };
const open: TimedRequest = { sectorId: "ti", status: "IN_PROGRESS", openedOn: "2026-11-10", completedAt: null };

describe("an entry's values (5.3 item 2)", () => {
  it("keeps hours and minutes as minutes, trims the note and turns an empty one into none", () => {
    expect(timeEntryInputSchema.parse({ workedOn: "2026-11-12", hours: 1, minutes: 30, note: "  Visita  " })).toEqual({
      workedOn: "2026-11-12",
      minutes: 90,
      note: "Visita",
    });
    expect(timeEntryInputSchema.parse({ workedOn: "2026-11-12", hours: 12, minutes: 0, note: "" })).toMatchObject({ minutes: 720, note: null });
  });

  it("refuses no time, more than 12 hours, an impossible day and a long note", () => {
    for (const input of [
      { workedOn: "2026-11-12", hours: 0, minutes: 0 },
      { workedOn: "2026-11-12", hours: 12, minutes: 1 },
      { workedOn: "2026-11-12", hours: 1, minutes: 60 },
      { workedOn: "2026-02-30", hours: 1, minutes: 0 },
      { workedOn: "12/11/2026", hours: 1, minutes: 0 },
      { workedOn: "2026-11-12", hours: 1, minutes: 0, note: "x".repeat(201) },
      { workedOn: "2026-11-12", hours: 1, minutes: 0, userId: "ana" },
    ]) {
      expect(timeEntryInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("a day from the opening to today", () => {
    expect(() => assertWorkedOnInRange("2026-11-10", "2026-11-10", "2026-11-20")).not.toThrow();
    expect(() => assertWorkedOnInRange("2026-11-20", "2026-11-10", "2026-11-20")).not.toThrow();
    expect(() => assertWorkedOnInRange("2026-11-09", "2026-11-10", "2026-11-20")).toThrow(ValidationError);
    expect(() => assertWorkedOnInRange("2026-11-21", "2026-11-10", "2026-11-20")).toThrow(ValidationError);
  });
});

describe("who logs (5.3 item 1; decision I10)", () => {
  it("an attendant of the sector, while open, in attendance or up to 7 days after the completion", () => {
    expect(() => assertCanLogTime(ana, open, now)).not.toThrow();
    expect(() => assertCanLogTime(ana, { ...open, status: "OPEN" }, now)).not.toThrow();
    expect(() => assertCanLogTime(ana, { ...open, status: "COMPLETED", completedAt: new Date(now.getTime() - 7 * DAY) }, now)).not.toThrow();
    expect(() => assertCanLogTime(ana, { ...open, status: "COMPLETED", completedAt: new Date(now.getTime() - 7 * DAY - 1) }, now)).toThrow(ConflictError);
    expect(() => assertCanLogTime(ana, { ...open, status: "CANCELLED" }, now)).toThrow(ConflictError);
  });

  it("nobody else: another sector, a manager, an inactive attendant", () => {
    for (const actor of [{ ...ana, sectorId: "rh" }, { ...ana, role: "MANAGER" as const }, { ...ana, isActive: false }]) {
      expect(() => assertCanLogTime(actor, open, now)).toThrow(NotFoundError);
    }
  });
});

describe("changing an entry (5.3 item 3)", () => {
  const entry = { userId: "ana", createdAt: new Date(now.getTime() - DAY), deletedAt: null };

  it("only the person who logged it, up to 7 days, while not removed", () => {
    expect(() => assertCanChangeEntry(ana, entry, now)).not.toThrow();
    expect(canChangeEntry("ana", entry, now)).toBe(true);
    expect(() => assertCanChangeEntry({ ...ana, id: "bia" }, entry, now)).toThrow(NotFoundError);
    expect(() => assertCanChangeEntry(ana, { ...entry, deletedAt: now }, now)).toThrow(NotFoundError);
    expect(() => assertCanChangeEntry(ana, { ...entry, createdAt: new Date(now.getTime() - 8 * DAY) }, now)).toThrow(ConflictError);
    expect(canChangeEntry("bia", entry, now)).toBe(false);
  });
});

describe("totals and the estimate (5.1 item 2; 13.2 item 1)", () => {
  it("adds the entries not removed, in all and by person", () => {
    const { total, byUser } = timeTotals([
      { userId: "ana", minutes: 90, deletedAt: null },
      { userId: "bia", minutes: 30, deletedAt: null },
      { userId: "ana", minutes: 15, deletedAt: null },
      { userId: "ana", minutes: 600, deletedAt: now },
    ]);
    expect(total).toBe(135);
    expect([...byUser.entries()]).toEqual([
      ["ana", 105],
      ["bia", 30],
    ]);
  });

  it("writes hours and minutes, against the estimate when there is one", () => {
    expect(formatMinutes(45)).toBe("45min");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(195)).toBe("3h 15min");
    expect(estimateLabel(180, 4)).toBe("3h de 4h estimadas");
    expect(estimateLabel(180, null)).toBe("3h");
  });

  it("an estimate of whole hours from 1 to 200, or none", () => {
    expect(estimatedHoursSchema.parse(4)).toBe(4);
    expect(estimatedHoursSchema.parse(null)).toBeNull();
    for (const value of [0, 201, 1.5]) expect(estimatedHoursSchema.safeParse(value).success).toBe(false);
  });
});
