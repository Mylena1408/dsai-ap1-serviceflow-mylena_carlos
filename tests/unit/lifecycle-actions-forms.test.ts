import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

const requests = vi.hoisted(() => ({
  createRequest: vi.fn(),
  transitionRequestStatus: vi.fn(),
  assumeRequest: vi.fn(),
  releaseRequest: vi.fn(),
  transferRequest: vi.fn(),
  cancelRequest: vi.fn(),
  reopenRequest: vi.fn(),
}));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
const nextCache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@/modules/requests", () => requests);
vi.mock("@/modules/comments", () => ({ addComment: vi.fn() }));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => nextCache);

import { cancelRequestAction } from "@/app/(attendant)/queue/actions";
import { cancelOwnRequestAction, reopenOwnRequestAction } from "@/app/(requester)/requests/actions";

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const noteError = () => new ValidationError([{ path: ["note"], code: "too_small" }]);

describe("cancellation Server Actions (SPEC 2026-10-31, section 5.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes only the identifier and the reason", async () => {
    const forged = { requestId: "request-id", note: "Duplicada", status: "CANCELLED", actorId: "forged" };

    await expect(cancelOwnRequestAction(formData(forged))).rejects.toThrow(
      "REDIRECT:/requests/request-id?notice=cancelled",
    );
    await expect(cancelRequestAction(formData(forged))).rejects.toThrow(
      "REDIRECT:/queue/request-id?notice=cancelled",
    );

    expect(requests.cancelRequest).toHaveBeenNthCalledWith(1, { requestId: "request-id", note: "Duplicada" });
    expect(requests.cancelRequest).toHaveBeenNthCalledWith(2, { requestId: "request-id", note: "Duplicada" });
    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/requests/request-id");
    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/queue/request-id");
  });

  it("maps errors of the requester's cancellation to safe feedback", async () => {
    const data = formData({ requestId: "request-id" });
    for (const [error, code] of [
      [noteError(), "note"],
      [new ConflictError(), "state"],
      [new NotFoundError(), "missing"],
    ] as const) {
      requests.cancelRequest.mockRejectedValueOnce(error);
      await expect(cancelOwnRequestAction(data)).rejects.toThrow(`REDIRECT:/requests/request-id?error=${code}`);
    }

    requests.cancelRequest.mockRejectedValueOnce(new Error("database detail"));
    await expect(cancelOwnRequestAction(data)).rejects.toThrow("database detail");
  });

  it("tells the attendant when the reason is missing", async () => {
    requests.cancelRequest.mockRejectedValueOnce(noteError());

    await expect(cancelRequestAction(formData({ requestId: "request-id" }))).rejects.toThrow(
      "REDIRECT:/queue/request-id?error=note",
    );
    expect(nextCache.revalidatePath).not.toHaveBeenCalled();
  });

  it("reopens with the reason and maps an expired window to the state feedback (SF-051)", async () => {
    await expect(
      reopenOwnRequestAction(formData({ requestId: "request-id", note: "Voltou", status: "OPEN" })),
    ).rejects.toThrow("REDIRECT:/requests/request-id?notice=reopened");
    expect(requests.reopenRequest).toHaveBeenCalledWith({ requestId: "request-id", note: "Voltou" });

    requests.reopenRequest.mockRejectedValueOnce(new ConflictError());
    await expect(reopenOwnRequestAction(formData({ requestId: "request-id" }))).rejects.toThrow(
      "REDIRECT:/requests/request-id?error=state",
    );
  });
});
