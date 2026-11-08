import { describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({ transitionRequestStatus: vi.fn() }));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/modules/requests", () => requests);
vi.mock("@/modules/comments", () => ({ addComment: vi.fn() }));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { completeRequestAction } from "@/app/(attendant)/queue/actions";
import { checklistPendingText } from "@/app/_components/request-checklist";
import { ChecklistPendingError } from "@/modules/checklists/domain/checklist";

// SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 4 (SF-204; decision I8): the refused completion on the screen.

describe("the completion refused by the checklist", () => {
  it("goes back to the request with its own message code", async () => {
    requests.transitionRequestStatus.mockRejectedValue(new ChecklistPendingError(["Instalar"]));
    const data = new FormData();
    data.set("requestId", "request-id");

    await expect(completeRequestAction(data)).rejects.toThrow("REDIRECT:/queue/request-id?error=checklist-pending");
  });

  it("lists the pending items in order, or nothing", () => {
    expect(checklistPendingText([{ textSnapshot: "Instalar" }, { textSnapshot: "Testar" }])).toBe('Falta marcar: "Instalar", "Testar".');
    expect(checklistPendingText([])).toBeNull();
  });
});
