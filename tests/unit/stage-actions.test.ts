import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "@/server/errors";

// SPEC 2026-11-01-fluxos-configuraveis, section 5.3 (SF-079): attendant stage actions.

const requests = vi.hoisted(() => ({ moveRequestStage: vi.fn() }));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/modules/requests", () => requests);
vi.mock("@/modules/comments", () => ({ addComment: vi.fn() }));
vi.mock("@/server/jobs/schedule", () => ({ scheduleEventProcessing: vi.fn() }));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { advanceStageAction, returnStageAction } from "@/app/(attendant)/queue/actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("stage actions (SF-079)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests.moveRequestStage.mockResolvedValue(undefined);
  });

  it("advances from the stage shown on the page", async () => {
    await expect(advanceStageAction(form({ requestId: "r1", fromStageIndex: "1" }))).rejects.toThrow(
      "REDIRECT:/queue/r1?notice=stage",
    );
    expect(requests.moveRequestStage).toHaveBeenCalledWith({ requestId: "r1", direction: "advance", fromStageIndex: 1 });
  });

  it("returns with the reason from the form", async () => {
    await expect(
      returnStageAction(form({ requestId: "r1", fromStageIndex: "2", note: "Faltou a peça" })),
    ).rejects.toThrow("REDIRECT:/queue/r1?notice=stage");
    expect(requests.moveRequestStage).toHaveBeenCalledWith({
      requestId: "r1",
      direction: "return",
      fromStageIndex: 2,
      note: "Faltou a peça",
    });
  });

  it("passes a malformed stage to server validation instead of guessing one", async () => {
    await advanceStageAction(form({ requestId: "r1", fromStageIndex: "" })).catch(() => undefined);
    await advanceStageAction(form({ requestId: "r1", fromStageIndex: "1.5" })).catch(() => undefined);

    expect(requests.moveRequestStage.mock.calls.map(([input]) => input.fromStageIndex)).toEqual(["", "1.5"]);
  });

  it("uses its own message for a missing reason and the usual one for a stale stage", async () => {
    requests.moveRequestStage.mockRejectedValueOnce(new ValidationError([{ path: ["note"], code: "too_small" }]));
    await expect(returnStageAction(form({ requestId: "r1", fromStageIndex: "1" }))).rejects.toThrow(
      "REDIRECT:/queue/r1?error=stage-note",
    );

    requests.moveRequestStage.mockRejectedValueOnce(new ConflictError());
    await expect(advanceStageAction(form({ requestId: "r1", fromStageIndex: "0" }))).rejects.toThrow(
      "REDIRECT:/queue/r1?error=state",
    );
  });
});
