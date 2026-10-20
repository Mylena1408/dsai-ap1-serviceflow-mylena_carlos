import { ConflictError } from "@/server/errors";
import type { DocumentRequirementMove } from "@/shared/validation";

// SPEC 21.2 item 5: at most five active requirements per service.
export const MAX_ACTIVE_DOCUMENT_REQUIREMENTS = 5;

export interface OrderedRequirement {
  id: string;
  position: number;
}

export function assertCanAddActiveRequirement(activeRequirementCount: number): void {
  if (activeRequirementCount >= MAX_ACTIVE_DOCUMENT_REQUIREMENTS) {
    throw new ConflictError();
  }
}

export function compareRequirementOrder(left: OrderedRequirement, right: OrderedRequirement): number {
  return left.position - right.position || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export function nextRequirementPosition(existing: readonly OrderedRequirement[]): number {
  return existing.reduce((highest, requirement) => Math.max(highest, requirement.position + 1), 0);
}

// Plans "Subir"/"Descer" among the active requirements of one service. Returns only the
// position updates to apply; an empty list means the move has no effect (first moved up,
// last moved down). Active positions are renumbered from 0 so ties cannot persist.
export function planRequirementMove(
  activeRequirements: readonly OrderedRequirement[],
  requirementId: string,
  direction: DocumentRequirementMove,
): OrderedRequirement[] {
  const ordered = [...activeRequirements].sort(compareRequirementOrder);
  const index = ordered.findIndex((requirement) => requirement.id === requirementId);

  if (index === -1) {
    throw new ConflictError();
  }

  const neighbourIndex = direction === "up" ? index - 1 : index + 1;

  if (neighbourIndex < 0 || neighbourIndex >= ordered.length) {
    return [];
  }

  [ordered[index], ordered[neighbourIndex]] = [ordered[neighbourIndex], ordered[index]];

  return ordered
    .map((requirement, position) => ({ id: requirement.id, position }))
    .filter(({ id, position }) => activeRequirements.find((item) => item.id === id)?.position !== position);
}
