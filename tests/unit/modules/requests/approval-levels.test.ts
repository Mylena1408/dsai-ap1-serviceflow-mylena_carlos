import { describe, expect, it } from "vitest";
import {
  approvalAfterDecision,
  approvalColumnsOnOpening,
  assertCanDecideApproval,
  canSeeApproval,
  effectiveApprovalSectors,
  pendingApprovalLevel,
  pendingApprovalSector,
  requestApprovalSectors,
} from "@/modules/requests/domain/approval";
import { assertApprovalLevels } from "@/modules/services/domain/approval-config";
import { plannedNotifications } from "@/modules/notifications/domain/recipients";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3 (SF-164).

const PURCHASING = "sector-purchasing";
const FINANCE = "sector-finance";
const manager = (sectorId: string) => ({ id: `m-${sectorId}`, role: "MANAGER" as const, isActive: true, sectorId });

describe("approval levels (SF-164)", () => {
  it("uses the service's sector as the only level when none is configured", () => {
    expect(effectiveApprovalSectors([], PURCHASING)).toEqual([PURCHASING]);
    expect(effectiveApprovalSectors([FINANCE, PURCHASING], PURCHASING)).toEqual([FINANCE, PURCHASING]);
  });

  it("opens at level 1 with its sector, or without approval", () => {
    expect(approvalColumnsOnOpening(true, [PURCHASING, FINANCE])).toEqual({
      approvalState: "PENDING",
      approvalSectorIdsSnapshot: [PURCHASING, FINANCE],
      approvalLevel: 1,
      approvalPendingSectorId: PURCHASING,
    });
    expect(approvalColumnsOnOpening(false, [PURCHASING])).toEqual({
      approvalState: null,
      approvalSectorIdsSnapshot: [],
      approvalLevel: null,
      approvalPendingSectorId: null,
    });
  });

  it("reads requests opened before levels as one level of their own sector", () => {
    const legacy = { sectorId: PURCHASING, approvalState: "PENDING" as const };
    expect(requestApprovalSectors(legacy)).toEqual([PURCHASING]);
    expect(pendingApprovalLevel(legacy)).toBe(1);
    expect(pendingApprovalSector(legacy)).toBe(PURCHASING);
    expect(pendingApprovalSector({ ...legacy, approvalState: "APPROVED" })).toBeNull();
  });

  it("moves to the next level on approval and ends on the last approval or any rejection", () => {
    const request = { sectorId: PURCHASING, approvalSectorIdsSnapshot: [PURCHASING, FINANCE], approvalLevel: 1 };
    expect(approvalAfterDecision(request, "APPROVED")).toEqual({ level: 1, next: { level: 2, sectorId: FINANCE } });
    expect(approvalAfterDecision(request, "REJECTED")).toEqual({ level: 1, next: null });
    expect(approvalAfterDecision({ ...request, approvalLevel: 2 }, "APPROVED")).toEqual({ level: 2, next: null });
    expect(approvalAfterDecision({ sectorId: PURCHASING }, "APPROVED")).toEqual({ level: 1, next: null });
  });

  it("lets only a manager of the pending level decide; other level managers see it but wait", () => {
    const request = {
      sectorId: PURCHASING,
      status: "OPEN" as const,
      approvalState: "PENDING" as const,
      approvalSectorIdsSnapshot: [PURCHASING, FINANCE],
      approvalLevel: 1,
      approvalPendingSectorId: PURCHASING,
    };
    expect(() => assertCanDecideApproval(manager(PURCHASING), request)).not.toThrow();
    expect(() => assertCanDecideApproval(manager(FINANCE), request)).toThrow(ConflictError);
    expect(() => assertCanDecideApproval(manager("other"), request)).toThrow(NotFoundError);
    expect(() => assertCanDecideApproval({ ...manager(PURCHASING), isActive: false }, request)).toThrow(NotFoundError);
    expect(() => assertCanDecideApproval({ ...manager(PURCHASING), role: "ATTENDANT" as never }, request)).toThrow(NotFoundError);

    const second = { ...request, approvalLevel: 2, approvalPendingSectorId: FINANCE };
    expect(() => assertCanDecideApproval(manager(FINANCE), second)).not.toThrow();
    expect(() => assertCanDecideApproval(manager(PURCHASING), second)).toThrow(ConflictError);
    expect(canSeeApproval(FINANCE, request)).toBe(true);
    expect(canSeeApproval("other", request)).toBe(false);
  });

  it("validates the configured levels", () => {
    const active = new Set([PURCHASING, FINANCE, "board"]);
    expect(() => assertApprovalLevels([], active)).not.toThrow();
    expect(() => assertApprovalLevels([PURCHASING, FINANCE, PURCHASING], active)).not.toThrow();
    expect(() => assertApprovalLevels([PURCHASING, FINANCE, "board", PURCHASING], active)).toThrow(ValidationError);
    expect(() => assertApprovalLevels([PURCHASING, PURCHASING], active)).toThrow(ValidationError);
    expect(() => assertApprovalLevels(["closed"], active)).toThrow(ValidationError);
  });
});

describe("notifications of the levels (SF-164)", () => {
  const context = { requesterId: "rita", effectiveAssigneeId: null, approvalManagerIds: ["fred", "gabi"] };

  it("asks the next level's managers, except the author, and leaves the requester waiting", () => {
    expect(
      plannedNotifications(
        { type: "request.approval_decided", payload: { decision: "APPROVED", actorId: "gabi", nextSectorId: FINANCE } },
        context,
      ),
    ).toEqual([{ recipientId: "fred", type: "approval.requested" }]);
  });

  it("tells the requester at the last approval and at a rejection, as before", () => {
    expect(
      plannedNotifications({ type: "request.approval_decided", payload: { decision: "APPROVED", actorId: "fred", nextSectorId: null } }, context),
    ).toEqual([{ recipientId: "rita", type: "approval.approved" }]);
    expect(
      plannedNotifications({ type: "request.approval_decided", payload: { decision: "REJECTED", actorId: "fred", nextSectorId: null } }, context),
    ).toEqual([{ recipientId: "rita", type: "approval.rejected" }]);
    // Events written before levels have no next sector.
    expect(plannedNotifications({ type: "request.approval_decided", payload: { decision: "APPROVED", actorId: "fred" } }, context)).toEqual([
      { recipientId: "rita", type: "approval.approved" },
    ]);
  });
});
