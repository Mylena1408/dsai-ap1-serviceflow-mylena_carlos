import { ConflictError } from "@/server/errors";
import type { RequestStatus } from "./request";

export function assertRequestStatusTransition(
  fromStatus: RequestStatus,
  toStatus: RequestStatus,
): void {
  const isAllowed =
    (fromStatus === "OPEN" && toStatus === "IN_PROGRESS") ||
    (fromStatus === "IN_PROGRESS" && toStatus === "COMPLETED");

  if (!isAllowed) {
    throw new ConflictError();
  }
}
