import { ConflictError } from "@/server/errors";

export interface AdministratorRetirement {
  isActiveAdministrator: boolean;
  activeAdministratorCount: number;
  remainsActiveAdministrator: boolean;
}

export function assertAdministratorCanRetire({
  isActiveAdministrator,
  activeAdministratorCount,
  remainsActiveAdministrator,
}: AdministratorRetirement): void {
  if (
    isActiveAdministrator &&
    !remainsActiveAdministrator &&
    activeAdministratorCount <= 1
  ) {
    throw new ConflictError();
  }
}

export interface AttendantSectorChange {
  isActiveAttendant: boolean;
  currentSectorId: string | null;
  nextRole: "ADMIN" | "REQUESTER" | "ATTENDANT";
  nextSectorId: string | null;
  nextIsActive: boolean;
  hasPendingRequests: boolean;
  otherActiveAttendantCount: number;
}

export function assertAttendantCanLeaveSector({
  isActiveAttendant,
  currentSectorId,
  nextRole,
  nextSectorId,
  nextIsActive,
  hasPendingRequests,
  otherActiveAttendantCount,
}: AttendantSectorChange): void {
  const leavesSector =
    !nextIsActive ||
    nextRole !== "ATTENDANT" ||
    currentSectorId !== nextSectorId;

  if (
    isActiveAttendant &&
    currentSectorId &&
    leavesSector &&
    hasPendingRequests &&
    otherActiveAttendantCount === 0
  ) {
    throw new ConflictError();
  }
}
