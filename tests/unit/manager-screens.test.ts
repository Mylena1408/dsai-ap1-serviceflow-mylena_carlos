import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { assertRequestReadable, type AuthorizationActor } from "@/server/authorization/policy";

// SPEC 2026-11-01-aprovacoes, sections 5.7 and 5.8 (SF-085).

const notifications = vi.hoisted(() => ({ openNotification: vi.fn() }));
const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
const requests = vi.hoisted(() => ({ decideApproval: vi.fn() }));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/modules/notifications", () => notifications);
vi.mock("@/server/authorization", () => authorization);
vi.mock("@/modules/requests", () => requests);
vi.mock("@/server/jobs/schedule", () => ({ scheduleEventProcessing: vi.fn() }));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { GET } from "@/app/api/notifications/[notificationId]/route";
import { approveRequestAction, rejectRequestAction } from "@/app/(manager)/approvals/actions";

const manager: AuthorizationActor = { id: "m", role: "MANAGER", sectorId: "sector-1", isActive: true };
const scope = { requesterId: "r", sectorId: "sector-1", requiresApproval: true };

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("manager read rule (SF-085; CA-APR-09)", () => {
  it("lets a manager read only requests of the sector that require approval", () => {
    expect(assertRequestReadable(manager, scope)).toBe(manager);
    expect(() => assertRequestReadable(manager, { ...scope, requiresApproval: false })).toThrow(NotFoundError);
    expect(() => assertRequestReadable(manager, { requesterId: "r", sectorId: "sector-1" })).toThrow(NotFoundError);
    expect(() => assertRequestReadable(manager, { ...scope, sectorId: "sector-2" })).toThrow(NotFoundError);
  });

  it("keeps the rule of the other profiles", () => {
    const attendant = { ...manager, id: "a", role: "ATTENDANT" as const };
    const admin = { ...manager, id: "x", role: "ADMIN" as const, sectorId: null };
    expect(assertRequestReadable(attendant, { ...scope, requiresApproval: false })).toBe(attendant);
    expect(() => assertRequestReadable(admin, scope)).toThrow(NotFoundError);
  });
});

describe("manager notifications route (SF-085)", () => {
  const call = () =>
    GET(new Request("http://localhost:3100/api/notifications/n-1"), { params: Promise.resolve({ notificationId: "n-1" }) });

  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireCurrentActor.mockResolvedValue(manager);
  });

  it("opens the request in the approvals area", async () => {
    notifications.openNotification.mockResolvedValue("request-1");
    expect((await call()).headers.get("location")).toBe("/approvals/request-1");
  });

  it("goes back to the manager notifications when the notification is not the reader's", async () => {
    notifications.openNotification.mockResolvedValue(null);
    expect((await call()).headers.get("location")).toBe("/approvals/notifications");
  });
});

describe("manager decision actions (SF-085)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests.decideApproval.mockResolvedValue(undefined);
  });

  it("approves and rejects with the note from the form", async () => {
    await expect(approveRequestAction(form({ requestId: "r1", note: "Ok" }))).rejects.toThrow(
      "REDIRECT:/approvals/r1?notice=approved",
    );
    await expect(rejectRequestAction(form({ requestId: "r1", note: "Fora do orçamento" }))).rejects.toThrow(
      "REDIRECT:/approvals/r1?notice=rejected",
    );
    expect(requests.decideApproval.mock.calls.map(([input]) => input)).toEqual([
      { requestId: "r1", decision: "APPROVED", note: "Ok" },
      { requestId: "r1", decision: "REJECTED", note: "Fora do orçamento" },
    ]);
  });

  it("shows fixed messages for a missing note, a decided request and a hidden request", async () => {
    requests.decideApproval.mockRejectedValueOnce(new ValidationError([{ path: ["note"], code: "too_small" }]));
    await expect(rejectRequestAction(form({ requestId: "r1" }))).rejects.toThrow("REDIRECT:/approvals/r1?error=note");

    requests.decideApproval.mockRejectedValueOnce(new ConflictError());
    await expect(approveRequestAction(form({ requestId: "r1" }))).rejects.toThrow("REDIRECT:/approvals/r1?error=decided");

    requests.decideApproval.mockRejectedValueOnce(new NotFoundError());
    await expect(approveRequestAction(form({ requestId: "r1" }))).rejects.toThrow("REDIRECT:/approvals/r1?error=missing");
  });
});
