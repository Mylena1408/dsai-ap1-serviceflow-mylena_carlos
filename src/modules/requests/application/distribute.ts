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

interface Handover extends QueueEntry {
  /** Who holds it now (null when it is in the queue). */
  fromAssigneeId: string | null;
  reason: "DISTRIBUTION" | "ABSENCE";
}

/** Chooses by the sector's mode and assigns as the system; returns who received, or null. */
async function assignBySector(transaction: RequestTransaction, handover: Handover): Promise<string | null> {
  const settings = await transaction.lockSectorDistribution(handover.sectorId);
  if (!settings || settings.mode === "NONE") return null;

  const chosen = chooseAttendant(
    settings,
    handover.sectorId,
    await transaction.distributionCandidates(handover.sectorId),
    new Set([...(handover.exclude ?? []), ...(handover.fromAssigneeId ? [handover.fromAssigneeId] : [])]),
  );
  if (!chosen) return null;

  const changed = await transaction.updateAssigneeIfCurrent({
    requestId: handover.requestId,
    expectedStatus: handover.status,
    expectedAssigneeId: handover.fromAssigneeId,
    assigneeId: chosen.id,
    updatedAt: handover.occurredAt,
  });
  if (changed !== 1) return null;

  // The system is the author (decision G17), with the reason (decision H19); notified as a transfer.
  await transaction.insertAssignmentEvent({
    requestId: handover.requestId,
    actorId: null,
    reason: handover.reason,
    fromAssigneeId: handover.fromAssigneeId,
    toAssigneeId: chosen.id,
    occurredAt: handover.occurredAt,
  });
  await transaction.recordEvent({
    type: "request.assignment_changed",
    requestId: handover.requestId,
    occurredAt: handover.occurredAt,
    payload: { fromAssigneeId: handover.fromAssigneeId, toAssigneeId: chosen.id, actorId: null },
  });
  await transaction.setLastDistributed(handover.sectorId, chosen.id);
  return chosen.id;
}

/** Returns who received the request, or null when nobody did. */
export function distributeOnEntry(transaction: RequestTransaction, entry: QueueEntry): Promise<string | null> {
  return assignBySector(transaction, { ...entry, fromAssigneeId: null, reason: "DISTRIBUTION" });
}

/**
 * 4.3 item 7: the request of an absent attendant goes to a colleague chosen by the sector's mode; without
 * anyone available, it stays with the absent attendant.
 */
export function handOverOnAbsence(
  transaction: RequestTransaction,
  entry: Omit<QueueEntry, "exclude"> & { fromAssigneeId: string },
): Promise<string | null> {
  return assignBySector(transaction, { ...entry, reason: "ABSENCE" });
}
