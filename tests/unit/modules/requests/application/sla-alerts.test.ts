import { describe, expect, it, vi } from "vitest";
import { recordSlaAlerts, type SlaAlertCandidate, type SlaAlertStore } from "@/modules/requests/application/sla-alerts";
import { pendingSlaAlert } from "@/modules/requests/domain/sla";
import { plannedNotifications } from "@/modules/notifications/domain/recipients";

// SPEC 2026-11-01-sla-prioridades, section 5.5 (SF-069).

const now = new Date("2026-11-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function candidate(id: string, dueInMs: number, marks: Partial<SlaAlertCandidate> = {}): SlaAlertCandidate {
  return {
    id,
    status: "OPEN",
    priority: "NORMAL",
    slaHoursSnapshot: 10,
    dueAt: new Date(now.getTime() + dueInMs),
    completedLate: null,
    slaWarningNotifiedAt: null,
    slaBreachNotifiedAt: null,
    ...marks,
  };
}

describe("pending SLA alert", () => {
  it("owes one alert per situation and only the breach once overdue", () => {
    expect(pendingSlaAlert(candidate("a", 3 * HOUR), now)).toBeNull();
    expect(pendingSlaAlert(candidate("a", 2 * HOUR), now)).toBe("warning");
    expect(pendingSlaAlert(candidate("a", 0), now)).toBe("warning");
    expect(pendingSlaAlert(candidate("a", HOUR, { slaWarningNotifiedAt: now }), now)).toBeNull();
    expect(pendingSlaAlert(candidate("a", -1), now)).toBe("breach");
    expect(pendingSlaAlert(candidate("a", -1, { slaBreachNotifiedAt: now }), now)).toBeNull();
    expect(pendingSlaAlert({ ...candidate("a", -1), status: "COMPLETED", completedLate: true }, now)).toBeNull();
    expect(pendingSlaAlert({ ...candidate("a", -1), slaHoursSnapshot: null, dueAt: null }, now)).toBeNull();
  });

  it("records each owed alert and counts only the ones still as read", async () => {
    const markAndRecord = vi.fn<SlaAlertStore["markAndRecord"]>(async (item) => item.id !== "changed");
    const store: SlaAlertStore = {
      findCandidates: vi.fn(async () => [
        candidate("soon", HOUR),
        candidate("late", -HOUR),
        candidate("changed", -HOUR),
        candidate("fine", 5 * HOUR),
      ]),
      markAndRecord,
    };

    await expect(recordSlaAlerts(now, store, 10)).resolves.toEqual({ warnings: 1, breaches: 1 });
    expect(store.findCandidates).toHaveBeenCalledWith(now, 10);
    expect(markAndRecord.mock.calls.map(([item, kind]) => [item.id, kind])).toEqual([
      ["soon", "warning"],
      ["late", "breach"],
      ["changed", "breach"],
    ]);
  });
});

describe("SLA alert recipients (CA-SLA-07)", () => {
  const team = { requestActive: true, sectorAttendantIds: ["ana", "bia"] };

  it("notifies the effective assignee, or the whole sector team without one", () => {
    expect(
      plannedNotifications({ type: "request.sla_warning" }, { requesterId: "rita", effectiveAssigneeId: "ana", slaRecipients: team }),
    ).toEqual([{ recipientId: "ana", type: "sla.warning" }]);
    expect(
      plannedNotifications({ type: "request.sla_breached" }, { requesterId: "rita", effectiveAssigneeId: null, slaRecipients: team }),
    ).toEqual([
      { recipientId: "ana", type: "sla.breached" },
      { recipientId: "bia", type: "sla.breached" },
    ]);
  });

  it("notifies nobody once the request is finished or without the SLA context", () => {
    expect(
      plannedNotifications(
        { type: "request.sla_breached" },
        { requesterId: "rita", effectiveAssigneeId: "ana", slaRecipients: { ...team, requestActive: false } },
      ),
    ).toEqual([]);
    expect(plannedNotifications({ type: "request.sla_warning" }, { requesterId: "rita", effectiveAssigneeId: "ana" })).toEqual(
      [],
    );
  });
});
