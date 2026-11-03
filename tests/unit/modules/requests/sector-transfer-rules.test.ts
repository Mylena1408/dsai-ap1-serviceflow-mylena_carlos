import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { outboxPayload } from "@/modules/events";
import {
  assertCanSendToSector,
  assertSectorDestination,
  isSectorDestination,
  sectorTransferNote,
  type LifecycleRequest,
  type LifecycleUser,
} from "@/modules/requests/domain/lifecycle";

// SPEC 2026-11-03-transferencia-entre-setores, 5.1 and 5.2 (SF-120).

const attendant = (id: string, overrides: Partial<LifecycleUser> = {}): LifecycleUser => ({
  id,
  role: "ATTENDANT",
  isActive: true,
  sectorId: "sector-1",
  ...overrides,
});
const ana = attendant("ana");
const bia = attendant("bia");

function request(overrides: Partial<LifecycleRequest> = {}): LifecycleRequest {
  return { requesterId: "owner", sectorId: "sector-1", status: "OPEN", completedAt: null, assignee: null, approvalState: null, ...overrides };
}

describe("who sends a request to another sector (5.1)", () => {
  it("lets any attendant of the sector send an open request without assignee", () => {
    expect(() => assertCanSendToSector(ana, request())).not.toThrow();
    expect(() => assertCanSendToSector(ana, request({ approvalState: "APPROVED" }))).not.toThrow();
  });

  it("with an assignee, lets only the assignee or a supervisor send it", () => {
    const held = request({ assignee: bia });
    expect(() => assertCanSendToSector(bia, held)).not.toThrow();
    expect(() => assertCanSendToSector(ana, held)).toThrow(ConflictError);
    expect(() => assertCanSendToSector(ana, held, true)).not.toThrow();
    // An assignee who left the sector no longer holds it.
    expect(() => assertCanSendToSector(ana, request({ assignee: attendant("bia", { sectorId: "sector-9" }) }))).not.toThrow();
  });

  it("refuses requests that are not open or wait for an approval (T1, T3)", () => {
    for (const status of ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) {
      expect(() => assertCanSendToSector(ana, request({ status })), status).toThrow(ConflictError);
    }
    expect(() => assertCanSendToSector(ana, request({ approvalState: "PENDING" }))).toThrow(ConflictError);
  });

  it("hides the request from anyone who is not an active attendant of its sector", () => {
    const outsiders: LifecycleUser[] = [
      attendant("caio", { sectorId: "sector-2" }),
      attendant("dani", { isActive: false }),
      { id: "owner", role: "REQUESTER", isActive: true, sectorId: null },
      { id: "gil", role: "MANAGER", isActive: true, sectorId: "sector-1" },
      { id: "adm", role: "ADMIN", isActive: true, sectorId: null },
    ];
    for (const actor of outsiders) {
      expect(() => assertCanSendToSector(actor, request()), actor.id).toThrow(NotFoundError);
    }
  });

  it("requires a reason of 1 to 1,000 characters", () => {
    expect(sectorTransferNote("  Pedido é de manutenção  ")).toBe("Pedido é de manutenção");
    expect(() => sectorTransferNote("   ")).toThrow(ValidationError);
    expect(() => sectorTransferNote(undefined)).toThrow(ValidationError);
    expect(sectorTransferNote("x".repeat(1_000))).toHaveLength(1_000);
    expect(() => sectorTransferNote("x".repeat(1_001))).toThrow(ValidationError);
  });
});

describe("sectors that may receive it (5.2, decision T4)", () => {
  const destination = { id: "sector-2", name: "Manutenção", isActive: true, activeAttendants: 1 };

  it("accepts an active, different sector with an active attendant", () => {
    expect(isSectorDestination(request(), destination)).toBe(true);
    expect(() => assertSectorDestination(request(), destination)).not.toThrow();
  });

  it("refuses the current, an inactive, an unknown or an unattended sector on the sectorId field", () => {
    const refused = [
      { ...destination, id: "sector-1" },
      { ...destination, isActive: false },
      { ...destination, activeAttendants: 0 },
      null,
    ];
    for (const sector of refused) {
      expect(isSectorDestination(request(), sector)).toBe(false);
      try {
        assertSectorDestination(request(), sector);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).issues[0]?.path).toEqual(["sectorId"]);
      }
    }
  });
});

describe("request.sector_changed event (5.3.5)", () => {
  it("carries only the two sectors and the actor", () => {
    const payload = outboxPayload({
      type: "request.sector_changed",
      requestId: "r",
      occurredAt: new Date(),
      payload: { fromSectorId: "s1", toSectorId: "s2", actorId: "ana", note: "segredo" } as never,
    });
    expect(payload).toEqual({ fromSectorId: "s1", toSectorId: "s2", actorId: "ana" });
  });
});
