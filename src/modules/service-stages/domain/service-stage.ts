import { ConflictError, ValidationError } from "@/server/errors";

// SPEC 2026-11-01-fluxos-configuraveis, sections 5.1 and 6.

// Section 5.1 item 3: from 0 (no flow) to 8 active stages per service.
export const MAX_ACTIVE_SERVICE_STAGES = 8;
export const MAX_STAGE_NAME_LENGTH = 60;

export interface ServiceStageRecord {
  id: string;
  serviceId: string;
  name: string;
  position: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /**
   * SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3: the attendant who receives the request on
   * entering the stage, the target in days and the condition on a requester answer. Optional so
   * older doubles stay valid.
   */
  assigneeId?: string | null;
  targetDays?: number | null;
  conditionFieldId?: string | null;
  conditionValue?: string | null;
}

export const MIN_STAGE_TARGET_DAYS = 1;
export const MAX_STAGE_TARGET_DAYS = 30;

/**
 * 5.3.1 (decision G9): the stage's attendant is an active attendant of the service's sector when
 * configured. The request module checks again, against the request's current sector, on entering.
 */
export function assertStageAssignee(
  assignee: { role: string; isActive: boolean; sectorId: string | null } | null,
  serviceSectorId: string,
): void {
  if (!assignee || assignee.role !== "ATTENDANT" || !assignee.isActive || assignee.sectorId !== serviceSectorId) {
    throw new ValidationError([{ path: ["assigneeId"], code: "invalid_value" }]);
  }
}

export function assertCanAddActiveStage(activeStageCount: number): void {
  if (activeStageCount >= MAX_ACTIVE_SERVICE_STAGES) {
    throw new ConflictError();
  }
}

// Names are unique among the active stages of a service, ignoring case; the database enforces
// the same rule with a partial unique index on a citext column.
export function assertStageNameAvailable(activeStages: ReadonlyArray<{ name: string }>, name: string): void {
  const wanted = name.toLowerCase();

  if (activeStages.some((stage) => stage.name.toLowerCase() === wanted)) {
    throw new ConflictError();
  }
}
