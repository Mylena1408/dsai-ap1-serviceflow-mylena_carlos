import { ConflictError, ValidationError } from "@/server/errors";
import { conditionMet, type ServiceFieldType } from "@/modules/service-fields";
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

// Stage settings (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3 and 5.4): the attendant,
// target days and condition of each stage. They travel next to the copy of the names, so the copy
// type above stays as it was.

export interface StageSettings {
  name: string;
  assigneeId: string | null;
  targetDays: number | null;
  conditionFieldId: string | null;
  conditionValue: string | null;
}

/** Per stage of the copy: the attendant ("" for none) and the target days (0 for none). */
export interface StageDetails {
  stageAssigneeIdsSnapshot: string[];
  stageTargetDaysSnapshot: number[];
}

/** A reopened request has no stage details either (5.4), nor a stage due date. */
export const NO_STAGE_DETAILS = {
  stageAssigneeIdsSnapshot: [] as string[],
  stageTargetDaysSnapshot: [] as number[],
  stageDueAt: null,
  stageOverdueNotifiedAt: null,
};

export type OpeningAnswer = { fieldId: string; type: ServiceFieldType; value: string };

/**
 * 5.3.3 (decision G11): the copy has only the stages without a condition or whose condition the
 * requester's answers meet, in order, with their attendant and target. Without any stage left, the
 * request has no flow, as a service without stages.
 */
export function stageCopyFromSettings(
  stages: readonly StageSettings[],
  answers: readonly OpeningAnswer[],
): StageCopy & StageDetails {
  const kept = stages.filter((stage) => {
    if (stage.conditionFieldId === null || stage.conditionValue === null) return true;
    const answer = answers.find((item) => item.fieldId === stage.conditionFieldId);
    return conditionMet(
      { conditionFieldId: stage.conditionFieldId, conditionValue: stage.conditionValue },
      answer ? { type: answer.type, value: answer.value } : undefined,
    );
  });

  return kept.length === 0
    ? { ...NO_STAGE, stageAssigneeIdsSnapshot: [], stageTargetDaysSnapshot: [] }
    : {
        stageNamesSnapshot: kept.map(({ name }) => name),
        stageIndex: 0,
        stageAssigneeIdsSnapshot: kept.map(({ assigneeId }) => assigneeId ?? ""),
        stageTargetDaysSnapshot: kept.map(({ targetDays }) => targetDays ?? 0),
      };
}

/** The attendant of a stage of the copy, or null (none, or a copy taken before details existed). */
export function stageAssigneeAt(details: Partial<StageDetails>, index: number): string | null {
  const value = details.stageAssigneeIdsSnapshot?.[index];
  return value ? value : null;
}

/** The target days of a stage of the copy, or null. */
export function stageTargetDaysAt(details: Partial<StageDetails>, index: number): number | null {
  const value = details.stageTargetDaysSnapshot?.[index];
  return value ? value : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 5.3.2 (decision G10): the due date of a stage entered at `enteredAt`, or null without a target. */
export function stageDueAtFrom(enteredAt: Date, targetDays: number | null): Date | null {
  return targetDays ? new Date(enteredAt.getTime() + targetDays * DAY_MS) : null;
}

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
