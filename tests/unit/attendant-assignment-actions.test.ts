import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

const requests = vi.hoisted(() => ({
  transitionRequestStatus: vi.fn(),
  assumeRequest: vi.fn(),
  releaseRequest: vi.fn(),
  transferRequest: vi.fn(),
}));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
const nextCache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@/modules/requests", () => requests);
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => nextCache);

import {
  assumeRequestAction,
  releaseRequestAction,
  transferRequestAction,
} from "@/app/(attendant)/queue/actions";

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("attendant assignment Server Actions (SPEC 2026-10-31, section 5.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes only identifiers and confirms each action", async () => {
    const forged = { requestId: "request-id", actorId: "forged", sectorId: "forged", assigneeId: "colleague" };

    await expect(assumeRequestAction(formData(forged))).rejects.toThrow(
      "REDIRECT:/queue/request-id?notice=assumed",
    );
    await expect(releaseRequestAction(formData(forged))).rejects.toThrow(
      "REDIRECT:/queue/request-id?notice=released",
    );
    await expect(transferRequestAction(formData(forged))).rejects.toThrow(
      "REDIRECT:/queue/request-id?notice=transferred",
    );

    expect(requests.assumeRequest).toHaveBeenCalledWith({ requestId: "request-id" });
    expect(requests.releaseRequest).toHaveBeenCalledWith({ requestId: "request-id" });
    expect(requests.transferRequest).toHaveBeenCalledWith({ requestId: "request-id", assigneeId: "colleague" });
    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/queue");
    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/queue/request-id");
  });

  it("maps known errors to safe feedback and rethrows unexpected ones", async () => {
    const data = formData({ requestId: "request-id" });

    requests.assumeRequest.mockRejectedValueOnce(new ConflictError());
    await expect(assumeRequestAction(data)).rejects.toThrow("REDIRECT:/queue/request-id?error=state");

    requests.releaseRequest.mockRejectedValueOnce(new NotFoundError());
    await expect(releaseRequestAction(data)).rejects.toThrow("REDIRECT:/queue/request-id?error=missing");

    requests.transferRequest.mockRejectedValueOnce(new ValidationError([]));
    await expect(transferRequestAction(data)).rejects.toThrow("REDIRECT:/queue/request-id?error=validation");

    requests.assumeRequest.mockRejectedValueOnce(new Error("database detail"));
    await expect(assumeRequestAction(data)).rejects.toThrow("database detail");
    expect(nextCache.revalidatePath).not.toHaveBeenCalled();
  });
});
