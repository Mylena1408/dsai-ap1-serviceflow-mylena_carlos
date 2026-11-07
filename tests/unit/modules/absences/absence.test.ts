import { describe, expect, it } from "vitest";
import {
  absenceDays,
  absenceInForce,
  assertAbsenceFits,
  assertAbsencePeriod,
  canCancelAbsence,
  periodsOverlap,
} from "@/modules/absences/domain/absence";
import { assertCanDecideApproval, decisionOnBehalfOf } from "@/modules/requests/domain/approval";
import { assertRequestReadable } from "@/server/authorization/policy";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.4 and 4.3.5 (SF-165).

const TODAY = "2026-11-07";

describe("absence period (SF-165)", () => {
  it("counts both days and accepts up to 90 days that have not ended", () => {
    expect(absenceDays({ startsOn: TODAY, endsOn: TODAY })).toBe(1);
    expect(absenceDays({ startsOn: "2026-11-01", endsOn: "2027-01-29" })).toBe(90);
    expect(() => assertAbsencePeriod({ startsOn: "2026-11-01", endsOn: "2027-01-29" }, TODAY)).not.toThrow();
    expect(() => assertAbsencePeriod({ startsOn: "2026-11-01", endsOn: "2027-01-30" }, TODAY)).toThrow(ValidationError);
    expect(() => assertAbsencePeriod({ startsOn: "2026-11-10", endsOn: "2026-11-09" }, TODAY)).toThrow(ValidationError);
    expect(() => assertAbsencePeriod({ startsOn: "2026-11-01", endsOn: "2026-11-06" }, TODAY)).toThrow(ValidationError);
    // Started in the past, still running: accepted.
    expect(() => assertAbsencePeriod({ startsOn: "2026-11-01", endsOn: TODAY }, TODAY)).not.toThrow();
  });

  it("refuses overlapping periods of the manager and a substitute absent the whole period", () => {
    const period = { startsOn: "2026-11-10", endsOn: "2026-11-12" };
    expect(periodsOverlap(period, { startsOn: "2026-11-12", endsOn: "2026-11-20" })).toBe(true);
    expect(periodsOverlap(period, { startsOn: "2026-11-13", endsOn: "2026-11-20" })).toBe(false);
    expect(() => assertAbsenceFits(period, [{ startsOn: "2026-11-01", endsOn: "2026-11-10" }], [])).toThrow(ConflictError);
    expect(() => assertAbsenceFits(period, [], [{ startsOn: "2026-11-09", endsOn: "2026-11-12" }])).toThrow(ConflictError);
    expect(() => assertAbsenceFits(period, [], [{ startsOn: "2026-11-11", endsOn: "2026-11-30" }])).not.toThrow();
  });

  it("is in force on its days unless cancelled, and is cancelled only before it ends", () => {
    const absence = { startsOn: "2026-11-05", endsOn: TODAY, cancelledAt: null };
    expect(absenceInForce(absence, TODAY)).toBe(true);
    expect(absenceInForce(absence, "2026-11-08")).toBe(false);
    expect(absenceInForce({ ...absence, cancelledAt: new Date() }, TODAY)).toBe(false);
    expect(canCancelAbsence(absence, TODAY)).toBe(true);
    expect(canCancelAbsence(absence, "2026-11-08")).toBe(false);
    expect(canCancelAbsence({ ...absence, cancelledAt: new Date() }, TODAY)).toBe(false);
  });
});

describe("decisions and reading by a substitute (SF-165)", () => {
  const request = {
    sectorId: "purchasing",
    status: "OPEN" as const,
    approvalState: "PENDING" as const,
    approvalSectorIdsSnapshot: ["purchasing"],
    approvalLevel: 1,
    approvalPendingSectorId: "purchasing",
  };
  const fred = { id: "fred", role: "MANAGER" as const, isActive: true, sectorId: "finance" };

  it("decides the covered sector's pending level, on behalf of its absent manager", () => {
    expect(() => assertCanDecideApproval(fred, request)).toThrow(NotFoundError);
    expect(() => assertCanDecideApproval(fred, request, ["purchasing"])).not.toThrow();
    const coverage = [{ sectorId: "purchasing", managerId: "gabi" }];
    expect(decisionOnBehalfOf("finance", "purchasing", coverage)).toBe("gabi");
    expect(decisionOnBehalfOf("purchasing", "purchasing", coverage)).toBeNull();
    expect(decisionOnBehalfOf("finance", null, coverage)).toBeNull();
  });

  it("reads approval requests of the own sector, of a level, or of a covered sector", () => {
    const scope = { requesterId: "rita", sectorId: "purchasing", requiresApproval: true, approvalSectorIds: ["purchasing", "board"] };
    const manager = (sectorId: string) => ({ id: `m-${sectorId}`, role: "MANAGER" as const, isActive: true, sectorId });

    expect(() => assertRequestReadable(manager("purchasing"), scope)).not.toThrow();
    expect(() => assertRequestReadable(manager("board"), scope)).not.toThrow();
    expect(() => assertRequestReadable(manager("finance"), scope)).toThrow(NotFoundError);
    expect(() => assertRequestReadable(manager("finance"), scope, { coveredSectorIds: ["board"] })).not.toThrow();
    // Without approval, a covered sector gives nothing: the substitute only handles approvals.
    expect(() => assertRequestReadable(manager("finance"), { ...scope, requiresApproval: false }, { coveredSectorIds: ["purchasing"] })).toThrow(
      NotFoundError,
    );
    // Before levels the scope has no list: only the request's sector, as before.
    expect(() => assertRequestReadable(manager("board"), { requesterId: "rita", sectorId: "purchasing", requiresApproval: true })).toThrow(
      NotFoundError,
    );
  });
});
