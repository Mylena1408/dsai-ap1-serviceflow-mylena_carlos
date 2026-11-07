import { ValidationError } from "@/server/errors";

// Approval levels and condition of a service (SPEC 2026-11-06-aprofundamento-configurabilidade,
// 4.3.1 and 4.3.7, decisions G4 and G7). The request module copies them at the opening.

export const MAX_APPROVAL_LEVELS = 3;

/**
 * Levels: at most 3, each an active sector, without the same sector in two consecutive levels. An
 * empty list keeps one level with the service's sector (the behavior before levels).
 */
export function assertApprovalLevels(sectorIds: readonly string[], activeSectorIds: ReadonlySet<string>): void {
  if (
    sectorIds.length > MAX_APPROVAL_LEVELS ||
    sectorIds.some((sectorId) => !activeSectorIds.has(sectorId)) ||
    sectorIds.some((sectorId, index) => index > 0 && sectorIds[index - 1] === sectorId)
  ) {
    throw new ValidationError([{ path: ["sectorIds"], code: "invalid_value" }]);
  }
}
