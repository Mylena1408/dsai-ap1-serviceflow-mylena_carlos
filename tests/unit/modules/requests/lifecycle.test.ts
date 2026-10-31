import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { RequestStatus } from "@/modules/requests/domain/request";
import {
  assertCanAssume,
  assertCanCancel,
  assertCanChangeStatusWithAssignee,
  assertCanRelease,
  assertCanReopen,
  assertCanTransfer,
  effectiveAssigneeId,
  isLifecycleTransitionAllowed,
  normalizeNote,
  REOPEN_WINDOW_MS,
  type LifecycleRequest,
  type LifecycleUser,
} from "@/modules/requests/domain/lifecycle";

const attendant = (id: string, overrides: Partial<LifecycleUser> = {}): LifecycleUser => ({
  id,
  role: "ATTENDANT",
  isActive: true,
  sectorId: "sector-1",
  ...overrides,
});
const ana = attendant("ana");
const bia = attendant("bia");
const otherSector = attendant("caio", { sectorId: "sector-2" });
const owner: LifecycleUser = { id: "owner", role: "REQUESTER", isActive: true, sectorId: null };
const stranger: LifecycleUser = { id: "stranger", role: "REQUESTER", isActive: true, sectorId: null };
const admin: LifecycleUser = { id: "admin", role: "ADMIN", isActive: true, sectorId: null };
const completedAt = new Date("2026-10-20T12:00:00.000Z");

function request(overrides: Partial<LifecycleRequest> = {}): LifecycleRequest {
  return {
    requesterId: "owner",
    sectorId: "sector-1",
    status: "OPEN",
    completedAt: null,
    assignee: null,
    ...overrides,
  };
}

describe("lifecycle transitions (SPEC 2026-10-31, section 5.6)", () => {
  it("allows exactly the table of section 5.6", () => {
    const statuses: RequestStatus[] = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
    const allowed = statuses.flatMap((from) =>
      statuses.filter((to) => isLifecycleTransitionAllowed(from, to)).map((to) => `${from}->${to}`),
    );

    expect(allowed).toEqual([
      "OPEN->IN_PROGRESS",
      "OPEN->CANCELLED",
      "IN_PROGRESS->COMPLETED",
      "IN_PROGRESS->CANCELLED",
      "COMPLETED->OPEN",
    ]);
  });
});

describe("effective assignee (section 5.1)", () => {
  it("counts only an active attendant of the request's current sector", () => {
    expect(effectiveAssigneeId(request())).toBeNull();
    expect(effectiveAssigneeId(request({ assignee: ana }))).toBe("ana");
    expect(effectiveAssigneeId(request({ assignee: { ...ana, isActive: false } }))).toBeNull();
    expect(effectiveAssigneeId(request({ assignee: { ...ana, sectorId: "sector-2" } }))).toBeNull();
    expect(effectiveAssigneeId(request({ assignee: { ...ana, role: "REQUESTER" } }))).toBeNull();
  });
});

describe("assume, release and transfer (section 5.2)", () => {
  it("lets an attendant of the sector assume an open or in-progress request without effective assignee", () => {
    expect(() => assertCanAssume(ana, request())).not.toThrow();
    expect(() => assertCanAssume(ana, request({ status: "IN_PROGRESS" }))).not.toThrow();
    expect(() => assertCanAssume(bia, request({ assignee: { ...ana, isActive: false } }))).not.toThrow();
    expect(() => assertCanAssume(bia, request({ assignee: { ...ana, sectorId: "sector-2" } }))).not.toThrow();
  });

  it("rejects assuming a held, finished or cancelled request as a conflict", () => {
    for (const blocked of [
      request({ assignee: ana }),
      request({ status: "COMPLETED" }),
      request({ status: "CANCELLED" }),
    ]) {
      expect(() => assertCanAssume(bia, blocked)).toThrow(ConflictError);
    }
  });

  it("hides the request from anyone outside the sector", () => {
    for (const actor of [otherSector, owner, admin, { ...ana, isActive: false }]) {
      expect(() => assertCanAssume(actor, request())).toThrow(NotFoundError);
    }
  });

  it("lets only the effective assignee release", () => {
    expect(() => assertCanRelease(ana, request({ assignee: ana }))).not.toThrow();
    expect(() => assertCanRelease(bia, request({ assignee: ana }))).toThrow(ConflictError);
    expect(() => assertCanRelease(ana, request())).toThrow(ConflictError);
  });

  it("lets only the effective assignee transfer to another active attendant of the sector (D1)", () => {
    const held = request({ assignee: ana });

    expect(() => assertCanTransfer(ana, held, bia)).not.toThrow();
    expect(() => assertCanTransfer(bia, held, attendant("dani"))).toThrow(ConflictError);
    for (const target of [ana, otherSector, { ...bia, isActive: false }, owner, admin, null]) {
      expect(() => assertCanTransfer(ana, held, target)).toThrow(ValidationError);
    }
  });
});

describe("status changes with an assignee (section 5.3, D2)", () => {
  it("keeps the old rule without assignee and restricts it to the effective assignee", () => {
    expect(() => assertCanChangeStatusWithAssignee("bia", request())).not.toThrow();
    expect(() => assertCanChangeStatusWithAssignee("ana", request({ assignee: ana }))).not.toThrow();
    expect(() => assertCanChangeStatusWithAssignee("bia", request({ assignee: ana }))).toThrow(ConflictError);
    expect(() =>
      assertCanChangeStatusWithAssignee("bia", request({ assignee: { ...ana, isActive: false } })),
    ).not.toThrow();
  });
});

describe("cancellation (section 5.4, D3)", () => {
  it("lets the owner cancel only an open request, with or without a reason", () => {
    expect(() => assertCanCancel(owner, request(), null)).not.toThrow();
    expect(() => assertCanCancel(owner, request(), "Não preciso mais")).not.toThrow();
    for (const status of ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) {
      expect(() => assertCanCancel(owner, request({ status }), null)).toThrow(ConflictError);
    }
  });

  it("requires a reason from the attendant and respects the assignee", () => {
    expect(() => assertCanCancel(ana, request({ status: "IN_PROGRESS" }), "Duplicada")).not.toThrow();
    expect(() => assertCanCancel(ana, request(), null)).toThrow(ValidationError);
    expect(() => assertCanCancel(bia, request({ assignee: ana }), "Duplicada")).toThrow(ConflictError);
    expect(() => assertCanCancel(ana, request({ status: "COMPLETED" }), "Duplicada")).toThrow(ConflictError);
  });

  it("hides the request from other requesters, other sectors and administrators", () => {
    for (const actor of [stranger, otherSector, admin]) {
      expect(() => assertCanCancel(actor, request(), "x")).toThrow(NotFoundError);
    }
  });
});

describe("reopening (section 5.5, D4)", () => {
  const completed = request({ status: "COMPLETED", completedAt, assignee: ana });
  const at = (ms: number) => new Date(completedAt.getTime() + ms);

  it("lets the owner reopen within 7 days, inclusive", () => {
    expect(() => assertCanReopen(owner, completed, at(0), "Voltou a falhar")).not.toThrow();
    expect(() => assertCanReopen(owner, completed, at(REOPEN_WINDOW_MS), "Voltou a falhar")).not.toThrow();
    expect(() => assertCanReopen(owner, completed, at(REOPEN_WINDOW_MS + 1), "Voltou")).toThrow(ConflictError);
  });

  it("requires a reason and a completed request", () => {
    expect(() => assertCanReopen(owner, completed, at(1), null)).toThrow(ValidationError);
    for (const status of ["OPEN", "IN_PROGRESS", "CANCELLED"] as const) {
      expect(() => assertCanReopen(owner, request({ status }), at(1), "x")).toThrow(ConflictError);
    }
  });

  it("is denied to anyone but the owner", () => {
    for (const actor of [stranger, ana, admin, { ...owner, isActive: false }]) {
      expect(() => assertCanReopen(actor, completed, at(1), "x")).toThrow(NotFoundError);
    }
  });
});

describe("reasons (section 5.9)", () => {
  it("trims, treats blank as absent and limits to 1,000 characters", () => {
    expect(normalizeNote("  Duplicada  ")).toBe("Duplicada");
    expect(normalizeNote("   ")).toBeNull();
    expect(normalizeNote(undefined)).toBeNull();
    expect(normalizeNote("é".repeat(1_000))).toHaveLength(1_000);
    expect(() => normalizeNote("a".repeat(1_001))).toThrow(ValidationError);
  });
});
