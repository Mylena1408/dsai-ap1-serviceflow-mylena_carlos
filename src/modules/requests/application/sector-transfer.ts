import { assertRole, requireCurrentActor, requireStatusChangeActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { assertCanSendToSector, assertSectorDestination, sectorTransferNote } from "../domain/lifecycle";
import { supervises } from "./assignment";
import { distributeOnEntry } from "./distribute";
import { getAttendantRequest } from "./request-queries";
import { requestSectorTransferInputSchema } from "./request-schemas";
import type { RequestQueryRepository, RequestTransactionRunner } from "./ports";

// Sending a request to another sector (SPEC 2026-11-03-transferencia-entre-setores, 5.1 to 5.6).
// The session check hides the request from anyone outside its sector; the transaction reloads the
// actor, the request and the destination, so every rule runs on the current database state.

/** Section 5.3: one transaction moves the request, removes the assignee and writes the history. */
export async function sendRequestToSector(input: unknown, transactions: RequestTransactionRunner): Promise<void> {
  const { requestId, sectorId, note: rawNote } = validateInput(requestSectorTransferInputSchema, input);
  const authorized = await requireStatusChangeActor(requestId);

  await transactions.run(async (transaction) => {
    const actor = await transaction.findActor(authorized.actorId);
    const request = await transaction.findLifecycleState(requestId);

    if (!actor || !request) {
      throw new NotFoundError();
    }

    assertCanSendToSector(actor, request, await supervises(actor, request, transaction));
    const note = sectorTransferNote(rawNote);
    const destination = await transaction.findSectorDestination(sectorId);
    assertSectorDestination(request, destination);
    const origin = await transaction.findSectorDestination(request.sectorId);

    if (!origin) {
      throw new NotFoundError();
    }

    const fromAssigneeId = request.assignee?.id ?? null;
    const occurredAt = await transaction.currentTime();
    const changed = await transaction.updateSectorIfCurrent({
      requestId,
      expectedSectorId: request.sectorId,
      expectedAssigneeId: fromAssigneeId,
      sectorId: destination.id,
      sectorName: destination.name,
      updatedAt: occurredAt,
    });

    // Someone else changed status, sector, assignee or approval after the read (5.3.6).
    if (changed !== 1) {
      throw new ConflictError();
    }

    // Section 5.3.2: the new sector assumes from its queue.
    if (fromAssigneeId !== null) {
      await transaction.insertAssignmentEvent({ requestId, actorId: actor.id, fromAssigneeId, toAssigneeId: null, occurredAt });
      await transaction.recordEvent({
        type: "request.assignment_changed",
        requestId,
        occurredAt,
        payload: { fromAssigneeId, toAssigneeId: null, actorId: actor.id },
      });
    }

    await transaction.insertSectorEvent({
      requestId,
      actorId: actor.id,
      fromSectorId: origin.id,
      toSectorId: destination.id,
      fromSectorName: origin.name,
      toSectorName: destination.name,
      note,
      occurredAt,
    });
    await transaction.recordEvent({
      type: "request.sector_changed",
      requestId,
      occurredAt,
      payload: { fromSectorId: origin.id, toSectorId: destination.id, actorId: actor.id },
    });

    // SPEC 2026-11-07-operacao-e-automacao, 4.3 item 2: it arrives in the new sector's queue.
    await distributeOnEntry(transaction, { requestId, sectorId: destination.id, status: request.status, occurredAt });
  });
}

/**
 * Section 5.2: sectors that may receive the request, for an attendant of its sector. Same scope
 * as reading the request in the queue.
 */
export async function listSectorDestinations(
  requestId: unknown,
  repository: RequestQueryRepository,
): Promise<Array<{ id: string; name: string }>> {
  const request = await getAttendantRequest(requestId, repository);
  assertRole(await requireCurrentActor(), "ATTENDANT");
  return repository.listSectorDestinations(request.sectorId);
}
