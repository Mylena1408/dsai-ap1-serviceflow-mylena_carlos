import { describe, expect, it } from "vitest";
import type { BusinessCalendar, SlaClock } from "@/shared/business-clock";
import {
  dueAtAfterPriorityChange,
  dueAtFrom,
  slaScheduleAfterPriorityChange,
  slaScheduleAfterResume,
  slaScheduleFrom,
  slaSituation,
} from "@/modules/requests/domain/sla";
import { assertCanPauseSla, assertCanResumeSla, pauseReason, type PausableRequest } from "@/modules/requests/domain/sla-pause";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

// SPEC 2026-11-03-pausa-sla-calendario, 5.2 to 5.4 (SF-128). 2026-11-06 is a Friday; São Paulo
// is UTC-3, so 08:00 there is 11:00Z.

const HOUR = 60 * 60 * 1000;
const calendar: BusinessCalendar = { weekdays: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 1080, timeZone: "America/Sao_Paulo", holidays: [] };
const business: SlaClock = { kind: "business", calendar };
const at = (iso: string) => new Date(iso);

describe("SLA schedule on the request's clock (5.2)", () => {
  it("in calendar hours, matches the due date of the SLA SPEC and the trigger's 'due soon'", () => {
    const start = at("2026-11-06T19:00:00Z");
    for (const priority of ["URGENT", "HIGH", "NORMAL", "LOW"] as const) {
      const schedule = slaScheduleFrom(start, 4, priority)!;
      expect(schedule.dueAt).toEqual(dueAtFrom(start, 4, priority));
      // Trigger factors: 3, 6, 12 or 24 minutes per hour of base SLA.
      const factor = { URGENT: 3, HIGH: 6, NORMAL: 12, LOW: 24 }[priority];
      expect(schedule.dueAt.getTime() - schedule.dueSoonAt.getTime()).toBe(4 * factor * 60_000);
    }
    expect(slaScheduleFrom(start, null, "NORMAL")).toBeNull();
  });

  it("in business hours, skips the weekend for the due date and for 'due soon'", () => {
    // 4 h from Friday 16:00: due Monday 10:00; 20% (48 min) before it in business time is Monday 09:12.
    expect(slaScheduleFrom(at("2026-11-06T19:00:00Z"), 4, "NORMAL", business)).toEqual({
      dueAt: at("2026-11-09T13:00:00Z"),
      dueSoonAt: at("2026-11-09T12:12:00Z"),
    });
    // 10 h from Friday 08:00: due Friday 18:00; "due soon" from Friday 16:00.
    expect(slaScheduleFrom(at("2026-11-06T11:00:00Z"), 10, "NORMAL", business)).toEqual({
      dueAt: at("2026-11-06T21:00:00Z"),
      dueSoonAt: at("2026-11-06T19:00:00Z"),
    });
  });

  it("recalculates a priority change from the start of the current period", () => {
    const opened = at("2026-11-06T19:00:00Z");
    const normal = slaScheduleFrom(opened, 8, "NORMAL", business)!;
    expect(slaScheduleAfterPriorityChange(normal.dueAt, 8, "NORMAL", "URGENT", business)).toEqual(slaScheduleFrom(opened, 8, "URGENT", business));
    // Calendar hours give the same due date as the existing rule.
    const calendarDue = dueAtFrom(opened, 8, "NORMAL");
    expect(slaScheduleAfterPriorityChange(calendarDue, 8, "NORMAL", "HIGH")!.dueAt).toEqual(dueAtAfterPriorityChange(calendarDue, 8, "NORMAL", "HIGH"));
    expect(slaScheduleAfterPriorityChange(null, 8, "NORMAL", "HIGH")).toBeNull();
  });

  it("moves the due date by the paused clock time on resume (5.4.4)", () => {
    // Calendar hours: a 3-hour pause moves everything 3 hours.
    const calendarSchedule = slaScheduleAfterResume(at("2026-11-06T21:00:00Z"), at("2026-11-06T15:00:00Z"), at("2026-11-06T18:00:00Z"), 10, "NORMAL");
    expect(calendarSchedule.dueAt).toEqual(at("2026-11-07T00:00:00Z"));
    expect(calendarSchedule.dueAt.getTime() - calendarSchedule.dueSoonAt.getTime()).toBe(2 * HOUR);

    // Business hours: paused Friday 15:00 with 3 h left (due 18:00), resumed Monday 09:00: due Monday 12:00.
    const resumed = slaScheduleAfterResume(at("2026-11-06T21:00:00Z"), at("2026-11-06T18:00:00Z"), at("2026-11-09T12:00:00Z"), 10, "NORMAL", business);
    expect(resumed).toEqual({ dueAt: at("2026-11-09T15:00:00Z"), dueSoonAt: at("2026-11-09T13:00:00Z") });
    // Paused during the weekend: nothing of business time passed, so nothing moves.
    expect(slaScheduleAfterResume(at("2026-11-09T15:00:00Z"), at("2026-11-07T12:00:00Z"), at("2026-11-08T12:00:00Z"), 10, "NORMAL", business).dueAt).toEqual(
      at("2026-11-09T15:00:00Z"),
    );
  });
});

describe("situation with a pause and in business hours (5.2.4 and 5.3.4)", () => {
  const base = { status: "IN_PROGRESS" as const, priority: "NORMAL" as const, slaHoursSnapshot: 10, completedLate: null };

  it("is 'paused' while the pause runs, even past the due date", () => {
    const state = { ...base, dueAt: at("2026-11-06T21:00:00Z"), slaPausedAt: at("2026-11-06T15:00:00Z") };
    expect(slaSituation(state, at("2026-11-06T16:00:00Z"))).toBe("paused");
    expect(slaSituation(state, at("2026-11-10T16:00:00Z"))).toBe("paused");
    expect(slaSituation({ ...state, status: "COMPLETED", completedLate: false }, at("2026-11-10T16:00:00Z"))).toBe("completed_on_time");
  });

  it("uses the stored 'due soon' in business hours", () => {
    const state = { ...base, dueAt: at("2026-11-09T15:00:00Z"), dueSoonAt: at("2026-11-09T13:00:00Z"), slaBusinessHours: true };
    // Saturday: the wall-clock rule would say "due soon"; the business clock says on time.
    expect(slaSituation(state, at("2026-11-07T15:00:00Z"))).toBe("on_time");
    expect(slaSituation(state, at("2026-11-09T13:00:00Z"))).toBe("due_soon");
    expect(slaSituation(state, at("2026-11-09T15:00:00Z"))).toBe("due_soon");
    expect(slaSituation(state, at("2026-11-09T15:00:00.001Z"))).toBe("overdue");
  });
});

describe("who pauses and resumes (5.3 and 5.4)", () => {
  const ana = { id: "ana", role: "ATTENDANT" as const, isActive: true, sectorId: "s1" };
  const bia = { id: "bia", role: "ATTENDANT" as const, isActive: true, sectorId: "s1" };
  const other = { id: "caio", role: "ATTENDANT" as const, isActive: true, sectorId: "s2" };
  const rita = { id: "rita", role: "REQUESTER" as const, isActive: true, sectorId: null };
  const now = at("2026-11-06T15:00:00Z");
  const request = (overrides: Partial<PausableRequest> = {}): PausableRequest => ({
    requesterId: "rita",
    sectorId: "s1",
    status: "IN_PROGRESS",
    completedAt: null,
    assignee: ana,
    priority: "NORMAL",
    slaHoursSnapshot: 10,
    dueAt: at("2026-11-06T21:00:00Z"),
    slaPausedAt: null,
    ...overrides,
  });

  it("lets the effective assignee, or a supervisor, pause a running SLA", () => {
    expect(() => assertCanPauseSla(ana, request(), now)).not.toThrow();
    expect(() => assertCanPauseSla(bia, request(), now, true)).not.toThrow();
    // At the due date itself the request is still "due soon".
    expect(() => assertCanPauseSla(ana, request(), at("2026-11-06T21:00:00Z"))).not.toThrow();
  });

  it("refuses with the codes of the rules", () => {
    expect(() => assertCanPauseSla(bia, request(), now)).toThrow(ConflictError);
    expect(() => assertCanPauseSla(other, request(), now, true)).toThrow(NotFoundError);
    expect(() => assertCanPauseSla(rita, request(), now)).toThrow(NotFoundError);
    for (const overrides of [
      { status: "OPEN" as const },
      { status: "COMPLETED" as const },
      { slaHoursSnapshot: null, dueAt: null },
      { slaPausedAt: at("2026-11-06T14:00:00Z") },
    ]) {
      expect(() => assertCanPauseSla(ana, request(overrides), now), JSON.stringify(overrides)).toThrow(ConflictError);
    }
    // Overdue: the pause would hide the delay (decision H7).
    expect(() => assertCanPauseSla(ana, request(), at("2026-11-06T21:00:00.001Z"))).toThrow(ConflictError);
  });

  it("resumes only a paused request in progress", () => {
    const paused = request({ slaPausedAt: at("2026-11-06T14:00:00Z") });
    expect(() => assertCanResumeSla(ana, paused)).not.toThrow();
    expect(() => assertCanResumeSla(bia, paused, true)).not.toThrow();
    expect(() => assertCanResumeSla(bia, paused)).toThrow(ConflictError);
    expect(() => assertCanResumeSla(other, paused)).toThrow(NotFoundError);
    expect(() => assertCanResumeSla(ana, request())).toThrow(ConflictError);
  });

  it("requires a reason of 1 to 500 characters once trimmed", () => {
    expect(pauseReason("  Precisamos do número do patrimônio  ")).toBe("Precisamos do número do patrimônio");
    expect(pauseReason("é".repeat(500))).toHaveLength(500);
    for (const raw of ["", "   ", null, undefined, "x".repeat(501)]) {
      expect(() => pauseReason(raw), String(raw).slice(0, 10)).toThrow(ValidationError);
    }
  });
});
