import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "@/server/errors";

const requests = vi.hoisted(() => ({
  transitionRequestStatus: vi.fn(),
}));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
const nextCache = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/modules/requests", () => requests);
vi.mock("@/modules/comments", () => ({ addComment: vi.fn() }));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => nextCache);

import {
  completeRequestAction,
  startRequestAction,
} from "@/app/(attendant)/queue/actions";

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("attendant Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests.transitionRequestStatus.mockResolvedValue({});
  });

  it("chooses transition targets on the server and revalidates the queue", async () => {
    const data = formData({
      requestId: "request-id",
      toStatus: "COMPLETED",
      status: "COMPLETED",
    });

    await expect(startRequestAction(data)).rejects.toThrow(
      "REDIRECT:/queue/request-id?notice=started",
    );
    expect(requests.transitionRequestStatus).toHaveBeenCalledWith({
      requestId: "request-id",
      toStatus: "IN_PROGRESS",
    });
    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/queue");
    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/queue/request-id");

    await expect(
      completeRequestAction(formData({ requestId: "request-id" })),
    ).rejects.toThrow("REDIRECT:/queue/request-id?notice=completed");
    expect(requests.transitionRequestStatus).toHaveBeenLastCalledWith({
      requestId: "request-id",
      toStatus: "COMPLETED",
    });
  });

  it("shows safe feedback for stale or hidden requests and rethrows unexpected failures", async () => {
    requests.transitionRequestStatus.mockRejectedValueOnce(new ConflictError());
    await expect(
      startRequestAction(formData({ requestId: "request-id" })),
    ).rejects.toThrow("REDIRECT:/queue/request-id?error=state");

    requests.transitionRequestStatus.mockRejectedValueOnce(new NotFoundError());
    await expect(
      completeRequestAction(formData({ requestId: "request-id" })),
    ).rejects.toThrow("REDIRECT:/queue/request-id?error=missing");

    requests.transitionRequestStatus.mockRejectedValueOnce(
      new Error("sensitive database detail"),
    );
    await expect(
      startRequestAction(formData({ requestId: "request-id" })),
    ).rejects.toThrow("sensitive database detail");
    expect(nextNavigation.redirect).not.toHaveBeenCalledWith(
      expect.stringContaining("sensitive database detail"),
    );
  });
});
