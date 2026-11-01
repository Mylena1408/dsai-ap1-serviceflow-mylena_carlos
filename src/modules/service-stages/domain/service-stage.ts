import { ConflictError } from "@/server/errors";

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
