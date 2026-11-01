import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "@/server/errors";

const requests = vi.hoisted(() => ({ changeRequestPriority: vi.fn() }));
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

import { changePriorityAction } from "@/app/(attendant)/queue/actions";

// SPEC 2026-11-01-sla-prioridades, section 5.1 (SF-067).

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("priority Server Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes only the identifier and the priority and confirms the change", async () => {
    const forged = { requestId: "request-id", priority: "URGENT", dueAt: "2026-01-01", actorId: "forged" };

    await expect(changePriorityAction(formData(forged))).rejects.toThrow("REDIRECT:/queue/request-id?notice=priority");

    expect(requests.changeRequestPriority).toHaveBeenCalledWith({ requestId: "request-id", priority: "URGENT" });
    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/queue/request-id");
  });

  it("maps known errors to safe feedback", async () => {
    const data = formData({ requestId: "request-id", priority: "NORMAL" });

    requests.changeRequestPriority.mockRejectedValueOnce(new ValidationError([{ path: ["priority"], code: "invalid_value" }]));
    await expect(changePriorityAction(data)).rejects.toThrow("REDIRECT:/queue/request-id?error=priority");

    requests.changeRequestPriority.mockRejectedValueOnce(new ConflictError());
    await expect(changePriorityAction(data)).rejects.toThrow("REDIRECT:/queue/request-id?error=state");
    expect(nextCache.revalidatePath).not.toHaveBeenCalled();
  });
});
