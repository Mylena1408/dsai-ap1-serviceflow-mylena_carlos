import { ConflictError, ValidationError } from "@/server/errors";
import { normalizeNote } from "./lifecycle";
import type { RequestStatus } from "./request";

// Stages of the attendance flow (SPEC 2026-11-01-fluxos-configuraveis, sections 5.2 to 5.4).
// Callers load the state from the database; these functions only decide.

export type StageDirection = "advance" | "return";

export interface StageState {
  status: RequestStatus;
  /** Copy of the stage names taken when the attendance started; empty without a flow. */
  stageNamesSnapshot: readonly string[];
  /** Position in the copy; null exactly when the copy is empty. */
  stageIndex: number | null;
}

export interface StageCopy {
  stageNamesSnapshot: string[];
  stageIndex: number | null;
}

export interface StageMove {
  fromIndex: number;
  toIndex: number;
  fromStage: string;
  toStage: string;
  note: string | null;
}

export function hasStages(state: Pick<StageState, "stageNamesSnapshot">): boolean {
  return state.stageNamesSnapshot.length > 0;
}

// Section 5.2 item 2 (decision W3): starting the attendance copies the active stages, in order,
// and enters the first one. Without active stages nothing is copied, as before.
export function stageCopyOnStart(activeStageNames: readonly string[]): StageCopy {
  return activeStageNames.length === 0
    ? { stageNamesSnapshot: [], stageIndex: null }
    : { stageNamesSnapshot: [...activeStageNames], stageIndex: 0 };
}

// Section 5.4: a reopened request has no stage until the attendance starts again.
export const NO_STAGE: StageCopy = { stageNamesSnapshot: [], stageIndex: null };

// Section 5.3 (decision W2): one stage at a time; going back needs a reason of 1 to 1,000
// characters. Only an in-progress request with a flow moves, and never past either end.
export function planStageMove(state: StageState, direction: StageDirection, rawNote?: string | null): StageMove {
  if (state.status !== "IN_PROGRESS" || !hasStages(state) || state.stageIndex === null) {
    throw new ConflictError();
  }

  const fromIndex = state.stageIndex;
  const toIndex = direction === "advance" ? fromIndex + 1 : fromIndex - 1;

  if (toIndex < 0 || toIndex >= state.stageNamesSnapshot.length) {
    throw new ConflictError();
  }

  let note: string | null = null;

  if (direction === "return") {
    note = normalizeNote(rawNote);
    if (note === null) {
      throw new ValidationError([{ path: ["note"], code: "too_small" }]);
    }
  }

  return {
    fromIndex,
    toIndex,
    fromStage: state.stageNamesSnapshot[fromIndex],
    toStage: state.stageNamesSnapshot[toIndex],
    note,
  };
}

// Section 5.3 item 3: a request with a flow is completed only at its last stage.
export function assertCanCompleteAtStage(state: StageState): void {
  if (hasStages(state) && state.stageIndex !== state.stageNamesSnapshot.length - 1) {
    throw new ConflictError();
  }
}
