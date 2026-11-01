import { ConflictError } from "@/server/errors";
import {
  compareByPosition,
  nextPosition,
  planPositionMove,
  type PositionMoveDirection,
  type PositionedItem,
} from "@/shared/ordering";

// SPEC 21.2 item 5: at most five active requirements per service.
export const MAX_ACTIVE_DOCUMENT_REQUIREMENTS = 5;

// The ordering rules are shared with custom fields (SF-072); these names are kept for this module.
export type RequirementMoveDirection = PositionMoveDirection;
export type OrderedRequirement = PositionedItem;

export function assertCanAddActiveRequirement(activeRequirementCount: number): void {
  if (activeRequirementCount >= MAX_ACTIVE_DOCUMENT_REQUIREMENTS) {
    throw new ConflictError();
  }
}

export const compareRequirementOrder = compareByPosition;
export const nextRequirementPosition = nextPosition;
export const planRequirementMove = planPositionMove;
