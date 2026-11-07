import { chooseAttendant } from "../domain/distribution";
import type { RequestStatus } from "../domain/request";
import type { RequestTransaction } from "./ports";

// Distribution at the entrance of the queue (SPEC 2026-11-07-operacao-e-automacao, 4.3 items 2, 5 and 6,
// decision H7): called in the same transaction as the operation that put the request in the sector's
// queue without an assignee. The sector's row is locked first, so two entries at once neither exceed
// the limit nor skip a turn. Without anyone available, the request stays without an assignee.

export interface QueueEntry {
  requestId: string;
  sectorId: string;
  /** The status the request has now (open, or in progress after a release). */
  status: RequestStatus;
  occurredAt: Date;
  /** People who must not receive it: who released it, for example. */
  exclude?: readonly string[];
}

/** Returns who received the request, or null when nobody did. */
export async function distributeOnEntry(transaction: RequestTransaction, entry: QueueEntry): Promise<string | null> {
  const settings = await transaction.lockSectorDistribution(entry.sectorId);
  if (!settings || settings.mode === "NONE") return null;

  const chosen = chooseAttendant(settings, entry.sectorId, await transaction.distributionCandidates(entry.sectorId), new Set(entry.exclude ?? []));
  if (!chosen) return null;

  const changed = await transaction.updateAssigneeIfCurrent({
    requestId: entry.requestId,
    expectedStatus: entry.status,
    expectedAssigneeId: null,
    assigneeId: chosen.id,
    updatedAt: entry.occurredAt,
  });
  if (changed !== 1) return null;

  // The system is the author (decision G17), with the reason (decision H19); notified as a transfer.
  await transaction.insertAssignmentEvent({
    requestId: entry.requestId,
    actorId: null,
    reason: "DISTRIBUTION",
    fromAssigneeId: null,
    toAssigneeId: chosen.id,
    occurredAt: entry.occurredAt,
  });
  await transaction.recordEvent({
    type: "request.assignment_changed",
    requestId: entry.requestId,
    occurredAt: entry.occurredAt,
    payload: { fromAssigneeId: null, toAssigneeId: chosen.id, actorId: null },
  });
  await transaction.setLastDistributed(entry.sectorId, chosen.id);
  return chosen.id;
}
