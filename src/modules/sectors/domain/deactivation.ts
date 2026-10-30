import { ConflictError } from "@/server/errors";

export interface SectorDeactivationDependencies {
  hasActiveService: boolean;
  hasPendingRequest: boolean;
  hasActiveAttendant: boolean;
}

export function assertSectorCanBeDeactivated({
  hasActiveService,
  hasPendingRequest,
  hasActiveAttendant,
}: SectorDeactivationDependencies): void {
  if (hasActiveService || hasPendingRequest || hasActiveAttendant) {
    throw new ConflictError();
  }
}
