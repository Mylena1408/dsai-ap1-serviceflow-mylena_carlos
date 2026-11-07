import { describe, expect, it } from "vitest";
import { stageAssigneeAvailable, stageEntryDue } from "@/modules/requests/application/stage-entry";
import {
  recordStageDeadlineAlerts,
  stageOverdueAlert,
  type StageDeadlineCandidate,
  type StageDeadlineStore,
} from "@/modules/requests/application/stage-deadline-alerts";
import { plannedNotifications } from "@/modules/notifications/domain/recipients";
import { stageOverdue } from "@/app/_components/request-stage";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.1 and 5.3.2 (SF-169).

const NOW = new Date("2026-11-07T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("entering a stage (SF-169)", () => {
  it("accepts as the stage's attendant only an active attendant of the request's current sector", () => {
    const bia = { id: "bia", role: "ATTENDANT" as const, isActive: true, sectorId: "s1" };
    expect(stageAssigneeAvailable(bia, "s1")).toBe(true);
    expect(stageAssigneeAvailable(bia, "s2")).toBe(false);
    expect(stageAssigneeAvailable({ ...bia, isActive: false }, "s1")).toBe(false);
    expect(stageAssigneeAvailable({ ...bia, role: "MANAGER" }, "s1")).toBe(false);
    expect(stageAssigneeAvailable(null, "s1")).toBe(false);
  });

  it("gives the stage entered its due date and clears the announcement", () => {
    const details = { stageTargetDaysSnapshot: [0, 2] };
    expect(stageEntryDue(details, 1, NOW)).toEqual({ stageDueAt: new Date(NOW.getTime() + 2 * DAY), stageOverdueNotifiedAt: null });
    expect(stageEntryDue(details, 0, NOW)).toEqual({ stageDueAt: null, stageOverdueNotifiedAt: null });
    // A copy taken before the details existed.
    expect(stageEntryDue({}, 0, NOW)).toEqual({ stageDueAt: null, stageOverdueNotifiedAt: null });
  });
});

describe("late stages (SF-169)", () => {
  const candidate = (overrides: Partial<StageDeadlineCandidate> = {}): StageDeadlineCandidate => ({
    id: "r1",
    status: "IN_PROGRESS",
    stageIndex: 1,
    stageDueAt: new Date(NOW.getTime() - 1000),
    ...overrides,
  });

  it("is late only in the attendance, with a stage, at or after its due date", () => {
    expect(stageOverdueAlert(candidate(), NOW)).toBe(1);
    expect(stageOverdueAlert(candidate({ stageDueAt: new Date(NOW.getTime() + 1000) }), NOW)).toBeNull();
    expect(stageOverdueAlert(candidate({ status: "COMPLETED" }), NOW)).toBeNull();
    expect(stageOverdueAlert(candidate({ stageIndex: null }), NOW)).toBeNull();
    expect(stageOverdueAlert(candidate({ stageDueAt: null }), NOW)).toBeNull();
  });

  it("marks each late stage once and counts only what was marked", async () => {
    const marked: Array<[string, number]> = [];
    const store: StageDeadlineStore = {
      async findCandidates(_now, limit) {
        return [candidate({ id: "a" }), candidate({ id: "b", stageDueAt: new Date(NOW.getTime() + DAY) }), candidate({ id: "c" })].slice(0, limit);
      },
      async markAndRecord(item, stageIndex) {
        if (item.id === "c") return false;
        marked.push([item.id, stageIndex]);
        return true;
      },
    };
    await expect(recordStageDeadlineAlerts(NOW, store)).resolves.toEqual({ overdue: 1 });
    expect(marked).toEqual([["a", 1]]);
  });

  it("shows the delay on screens while in the attendance", () => {
    const request = { status: "IN_PROGRESS" as const, stageNamesSnapshot: ["A", "B"], stageIndex: 1, stageDueAt: new Date(NOW.getTime() - 1) };
    expect(stageOverdue(request, NOW)).toBe(true);
    expect(stageOverdue({ ...request, status: "COMPLETED" }, NOW)).toBe(false);
    expect(stageOverdue({ ...request, stageDueAt: null }, NOW)).toBe(false);
  });

  it("reaches the holder or, without one, the sector's team, while the request is active", () => {
    const event = { type: "request.stage_overdue" as const };
    expect(
      plannedNotifications(event, { requesterId: "rita", effectiveAssigneeId: "ana", slaRecipients: { requestActive: true, sectorAttendantIds: ["ana", "bia"] } }),
    ).toEqual([{ recipientId: "ana", type: "stage.overdue" }]);
    expect(
      plannedNotifications(event, { requesterId: "rita", effectiveAssigneeId: null, slaRecipients: { requestActive: true, sectorAttendantIds: ["ana", "bia"] } }),
    ).toEqual([
      { recipientId: "ana", type: "stage.overdue" },
      { recipientId: "bia", type: "stage.overdue" },
    ]);
    expect(
      plannedNotifications(event, { requesterId: "rita", effectiveAssigneeId: "ana", slaRecipients: { requestActive: false, sectorAttendantIds: [] } }),
    ).toEqual([]);
  });
});
