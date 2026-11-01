import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { LifecycleUser } from "@/modules/requests/domain/lifecycle";
import {
  approvalStateOnOpening,
  assertCanDecideApproval,
  assertCanStartWithApproval,
  decisionNote,
  dueAtOnApproval,
  dueAtOnOpening,
  type ApprovalRequest,
} from "@/modules/requests/domain/approval";

// SPEC 2026-11-01-aprovacoes, sections 5.2 to 5.5 (SF-081; rules of CA-APR-05, 06 and 07).

const HOUR = 60 * 60 * 1000;
const manager: LifecycleUser = { id: "m1", role: "MANAGER", isActive: true, sectorId: "sector-1" };
const pending: ApprovalRequest = { sectorId: "sector-1", status: "OPEN", approvalState: "PENDING" };

describe("approval at opening and start (SF-081)", () => {
  it("starts pending only for services that require approval", () => {
    expect(approvalStateOnOpening(true)).toBe("PENDING");
    expect(approvalStateOnOpening(false)).toBeNull();
  });

  it("blocks the start only while the approval is pending (CA-APR-05)", () => {
    expect(() => assertCanStartWithApproval("PENDING")).toThrow(ConflictError);
    expect(() => assertCanStartWithApproval("APPROVED")).not.toThrow();
    expect(() => assertCanStartWithApproval(null)).not.toThrow();
  });
});

describe("who decides (SF-081)", () => {
  it("lets an active manager of the request's sector decide a pending, open request", () => {
    expect(() => assertCanDecideApproval(manager, pending)).not.toThrow();
  });

  it("hides the request from anyone else (CA-APR-06)", () => {
    for (const actor of [
      { ...manager, sectorId: "sector-2" },
      { ...manager, isActive: false },
      { ...manager, role: "ATTENDANT" as const },
      { ...manager, role: "REQUESTER" as const, sectorId: null },
      { ...manager, role: "ADMIN" as const, sectorId: null },
    ]) {
      expect(() => assertCanDecideApproval(actor, pending)).toThrow(NotFoundError);
    }
    expect(() => assertCanDecideApproval(manager, { ...pending, approvalState: null })).toThrow(NotFoundError);
  });

  it("decides only once and only while the request is open (CA-APR-06)", () => {
    expect(() => assertCanDecideApproval(manager, { ...pending, approvalState: "APPROVED" })).toThrow(ConflictError);
    expect(() => assertCanDecideApproval(manager, { ...pending, status: "CANCELLED" })).toThrow(ConflictError);
  });
});

describe("decision note (SF-081)", () => {
  it("is optional when approving and trimmed when given", () => {
    expect(decisionNote("APPROVED", undefined)).toBeNull();
    expect(decisionNote("APPROVED", "  ")).toBeNull();
    expect(decisionNote("APPROVED", "  Dentro do orçamento ")).toBe("Dentro do orçamento");
  });

  it("is required when rejecting, up to 1,000 characters", () => {
    for (const note of [undefined, null, "", "   "]) {
      expect(() => decisionNote("REJECTED", note)).toThrow(ValidationError);
    }
    expect(decisionNote("REJECTED", "a".repeat(1000))).toHaveLength(1000);
    expect(() => decisionNote("REJECTED", "a".repeat(1001))).toThrow(ValidationError);
    expect(() => decisionNote("APPROVED", "a".repeat(1001))).toThrow(ValidationError);
  });
});

describe("SLA with approval (SF-081; CA-APR-07)", () => {
  const openedAt = new Date("2026-11-01T12:00:00.000Z");
  const approvedAt = new Date("2026-11-02T09:00:00.000Z");

  it("has no due date while the approval is pending", () => {
    expect(dueAtOnOpening(openedAt, 10, "NORMAL", "PENDING")).toBeNull();
  });

  it("keeps the opening rule for requests without approval", () => {
    expect(dueAtOnOpening(openedAt, 10, "NORMAL", null)?.getTime()).toBe(openedAt.getTime() + 10 * HOUR);
    expect(dueAtOnOpening(openedAt, null, "NORMAL", null)).toBeNull();
  });

  it("counts from the approval with the current priority", () => {
    expect(dueAtOnApproval(approvedAt, 10, "NORMAL")?.getTime()).toBe(approvedAt.getTime() + 10 * HOUR);
    expect(dueAtOnApproval(approvedAt, 10, "URGENT")?.getTime()).toBe(approvedAt.getTime() + 2.5 * HOUR);
    expect(dueAtOnApproval(approvedAt, null, "NORMAL")).toBeNull();
  });
});
