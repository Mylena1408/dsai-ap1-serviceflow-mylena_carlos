import { describe, expect, it } from "vitest";
import { approvalDueAtFrom, approvalOverdue } from "@/modules/requests/domain/approval";
import {
  approvalOverdueAlert,
  recordApprovalDeadlineAlerts,
  type ApprovalDeadlineCandidate,
  type ApprovalDeadlineStore,
} from "@/modules/requests/application/approval-deadline-alerts";
import { plannedNotifications } from "@/modules/notifications/domain/recipients";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.6 (SF-166).

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-07T12:00:00.000Z");

function candidate(overrides: Partial<ApprovalDeadlineCandidate> = {}): ApprovalDeadlineCandidate {
  return {
    id: "r1",
    sectorId: "purchasing",
    approvalState: "PENDING",
    approvalLevel: 2,
    approvalPendingSectorId: "finance",
    approvalDueAt: new Date(NOW.getTime() - 1000),
    ...overrides,
  };
}

describe("approval deadline rules (SF-166)", () => {
  it("counts calendar days from the moment the level became pending", () => {
    expect(approvalDueAtFrom(NOW, 3)).toEqual(new Date(NOW.getTime() + 3 * DAY));
    expect(approvalDueAtFrom(NOW, null)).toBeNull();
    expect(approvalDueAtFrom(NOW, undefined)).toBeNull();
  });

  it("is late only while pending and at or after the due date", () => {
    const pending = { approvalState: "PENDING" as const, approvalDueAt: NOW };
    expect(approvalOverdue(pending, NOW)).toBe(true);
    expect(approvalOverdue(pending, new Date(NOW.getTime() - 1))).toBe(false);
    expect(approvalOverdue({ ...pending, approvalState: "APPROVED" }, NOW)).toBe(false);
    expect(approvalOverdue({ approvalState: "PENDING", approvalDueAt: null }, NOW)).toBe(false);
  });

  it("announces the pending level and the sector that decides it", () => {
    expect(approvalOverdueAlert(candidate(), NOW)).toEqual({ level: 2, sectorId: "finance" });
    // Opened before levels: level 1, the request's sector.
    expect(approvalOverdueAlert(candidate({ approvalLevel: null, approvalPendingSectorId: null }), NOW)).toEqual({ level: 1, sectorId: "purchasing" });
    expect(approvalOverdueAlert(candidate({ approvalDueAt: new Date(NOW.getTime() + 1000) }), NOW)).toBeNull();
    expect(approvalOverdueAlert(candidate({ approvalState: "REJECTED" }), NOW)).toBeNull();
  });
});

describe("daily job of the approval deadlines (SF-166)", () => {
  function store(candidates: ApprovalDeadlineCandidate[], changed: (id: string) => boolean = () => true) {
    const marked: Array<{ id: string; level: number; sectorId: string }> = [];
    const value: ApprovalDeadlineStore = {
      async findCandidates(_now, limit) {
        return candidates.slice(0, limit);
      },
      async markAndRecord(item, alert) {
        if (!changed(item.id)) return false;
        marked.push({ id: item.id, ...alert });
        return true;
      },
    };
    return { value, marked };
  }

  it("marks each late level once and counts only what was marked", async () => {
    const { value, marked } = store(
      [candidate({ id: "late" }), candidate({ id: "future", approvalDueAt: new Date(NOW.getTime() + DAY) }), candidate({ id: "changed" })],
      (id) => id !== "changed",
    );
    await expect(recordApprovalDeadlineAlerts(NOW, value)).resolves.toEqual({ overdue: 1 });
    expect(marked).toEqual([{ id: "late", level: 2, sectorId: "finance" }]);
  });

  it("respects the batch limit", async () => {
    const { value, marked } = store([candidate({ id: "a" }), candidate({ id: "b" }), candidate({ id: "c" })]);
    await expect(recordApprovalDeadlineAlerts(NOW, value, 2)).resolves.toEqual({ overdue: 2 });
    expect(marked.map(({ id }) => id)).toEqual(["a", "b"]);
  });
});

describe("notifications of a late level (SF-166)", () => {
  it("goes to who decides the level, never to the requester", () => {
    expect(
      plannedNotifications(
        { type: "request.approval_overdue", payload: { sectorId: "finance" } },
        { requesterId: "rita", effectiveAssigneeId: null, approvalManagerIds: ["fred", "sub"] },
      ),
    ).toEqual([
      { recipientId: "fred", type: "approval.overdue" },
      { recipientId: "sub", type: "approval.overdue" },
    ]);
    expect(
      plannedNotifications({ type: "request.approval_overdue", payload: { sectorId: "finance" } }, { requesterId: "rita", effectiveAssigneeId: null }),
    ).toEqual([]);
  });
});
