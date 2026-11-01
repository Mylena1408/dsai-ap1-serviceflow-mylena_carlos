import { describe, expect, it } from "vitest";
import { ValidationError } from "@/server/errors";
import { parseSlaHours } from "@/modules/services/domain/sla-config";
import {
  completedLateAt,
  dueAtFrom,
  effectiveSlaMinutes,
  isRequestPriority,
  slaSituation,
  type SlaState,
} from "@/modules/requests/domain/sla";

// SPEC 2026-11-01-sla-prioridades, sections 5.2 to 5.4 (SF-065).

const opened = new Date("2026-11-02T12:00:00.000Z");
const MINUTE = 60_000;
const at = (minutesAfterOpening: number) => new Date(opened.getTime() + minutesAfterOpening * MINUTE);

function state(overrides: Partial<SlaState> = {}): SlaState {
  return {
    status: "OPEN",
    priority: "NORMAL",
    slaHoursSnapshot: 10,
    dueAt: dueAtFrom(opened, 10, overrides.priority ?? "NORMAL"),
    completedLate: null,
    ...overrides,
  };
}

describe("effective SLA (S2)", () => {
  it("scales the base by 25, 50, 100 and 200 percent and rounds minutes up", () => {
    expect(["URGENT", "HIGH", "NORMAL", "LOW"].map((p) => effectiveSlaMinutes(10, p as never))).toEqual([
      150, 300, 600, 1200,
    ]);
    expect(effectiveSlaMinutes(1, "URGENT")).toBe(15);
    expect(effectiveSlaMinutes(3, "URGENT")).toBe(45);
    expect(effectiveSlaMinutes(2_000, "LOW")).toBe(240_000);
  });

  it("counts calendar time from the start and has no due date without an SLA (S1)", () => {
    expect(dueAtFrom(opened, 10, "HIGH")).toEqual(at(300));
    expect(dueAtFrom(opened, null, "URGENT")).toBeNull();
  });
});

describe("SLA situation (CA-SLA-05)", () => {
  it("is on time until 20 percent remain, due soon up to the due date, overdue after it", () => {
    // NORMAL, 10 h: 600 minutes; the warning window is the last 120 minutes.
    expect(slaSituation(state(), at(0))).toBe("on_time");
    expect(slaSituation(state(), new Date(at(480).getTime() - 1))).toBe("on_time");
    expect(slaSituation(state(), at(480))).toBe("due_soon");
    expect(slaSituation(state(), at(600))).toBe("due_soon");
    expect(slaSituation(state(), new Date(at(600).getTime() + 1))).toBe("overdue");
  });

  it("uses the window of the current priority", () => {
    const urgent = state({ priority: "URGENT" }); // 150 minutes, window of 30
    expect(slaSituation(urgent, at(119))).toBe("on_time");
    expect(slaSituation(urgent, at(120))).toBe("due_soon");
  });

  it("reports the completion result, nothing for cancelled requests or without SLA", () => {
    expect(slaSituation(state({ status: "COMPLETED", completedLate: false }), at(9999))).toBe("completed_on_time");
    expect(slaSituation(state({ status: "COMPLETED", completedLate: true }), at(0))).toBe("completed_late");
    expect(slaSituation(state({ status: "CANCELLED" }), at(9999))).toBe("none");
    expect(slaSituation(state({ slaHoursSnapshot: null, dueAt: null }), at(9999))).toBe("none");
    expect(slaSituation(state({ status: "IN_PROGRESS" }), at(601))).toBe("overdue");
  });
});

describe("completion result (CA-SLA-08)", () => {
  it("is late only after the due date and absent without an SLA", () => {
    const dueAt = at(600);
    expect(completedLateAt(dueAt, at(600))).toBe(false);
    expect(completedLateAt(dueAt, new Date(dueAt.getTime() + 1))).toBe(true);
    expect(completedLateAt(null, at(9999))).toBeNull();
  });
});

describe("configuration values", () => {
  it("accepts empty or a whole number of hours from 1 to 2,000 (CA-SLA-02)", () => {
    expect(parseSlaHours("")).toBeNull();
    expect(parseSlaHours(undefined)).toBeNull();
    expect(parseSlaHours(" 24 ")).toBe(24);
    expect(parseSlaHours(2_000)).toBe(2_000);
    for (const raw of ["0", "2001", "1.5", "-3", "abc", 0, 1.5]) {
      expect(() => parseSlaHours(raw)).toThrow(ValidationError);
    }
  });

  it("recognizes the four priorities only", () => {
    expect(["LOW", "NORMAL", "HIGH", "URGENT"].every(isRequestPriority)).toBe(true);
    expect(isRequestPriority("CRITICAL")).toBe(false);
  });
});
