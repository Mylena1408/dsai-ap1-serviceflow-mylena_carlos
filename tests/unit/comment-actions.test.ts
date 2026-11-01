import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "@/server/errors";

const comments = vi.hoisted(() => ({ addComment: vi.fn() }));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
const nextCache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@/modules/comments", () => comments);
vi.mock("@/modules/requests", () => ({}));
vi.mock("@/modules/service-fields", () => ({ FieldAnswersError: class {} }));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => nextCache);

import { addCommentAction } from "@/app/(attendant)/queue/actions";
import { addOwnCommentAction } from "@/app/(requester)/requests/actions";

// SPEC 2026-10-31-comentarios (SF-054, SF-055).

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("comment Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never lets the requester send an internal note or forge the author", async () => {
    await expect(
      addOwnCommentAction(formData({ requestId: "request-id", body: "Oi", isInternal: "on", authorId: "x" })),
    ).rejects.toThrow("REDIRECT:/requests/request-id?notice=commented");

    expect(comments.addComment).toHaveBeenCalledWith({ requestId: "request-id", body: "Oi" });
  });

  it("passes the internal note checkbox for attendants", async () => {
    await expect(
      addCommentAction(formData({ requestId: "request-id", body: "Nota", isInternal: "on" })),
    ).rejects.toThrow("REDIRECT:/queue/request-id?notice=commented");
    await expect(addCommentAction(formData({ requestId: "request-id", body: "Pública" }))).rejects.toThrow(
      "REDIRECT:/queue/request-id?notice=commented",
    );

    expect(comments.addComment).toHaveBeenNthCalledWith(1, { requestId: "request-id", body: "Nota", isInternal: true });
    expect(comments.addComment).toHaveBeenNthCalledWith(2, { requestId: "request-id", body: "Pública", isInternal: false });
  });

  it("maps text and state errors to their own feedback", async () => {
    const bodyError = new ValidationError([{ path: ["body"], code: "too_small" }]);

    comments.addComment.mockRejectedValueOnce(bodyError);
    await expect(addOwnCommentAction(formData({ requestId: "request-id" }))).rejects.toThrow(
      "REDIRECT:/requests/request-id?error=body",
    );
    comments.addComment.mockRejectedValueOnce(bodyError);
    await expect(addCommentAction(formData({ requestId: "request-id" }))).rejects.toThrow(
      "REDIRECT:/queue/request-id?error=body",
    );
    comments.addComment.mockRejectedValueOnce(new ConflictError());
    await expect(addOwnCommentAction(formData({ requestId: "request-id", body: "x" }))).rejects.toThrow(
      "REDIRECT:/requests/request-id?error=state",
    );
  });
});
