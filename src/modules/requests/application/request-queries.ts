import { assertRole, requireCurrentActor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import type { RequestWithHistory } from "../domain/request";
import type { RequestQueryRepository } from "./ports";

export async function listRequesterRequests(
  repository: RequestQueryRepository,
): Promise<RequestWithHistory[]> {
  const actor = assertRole(await requireCurrentActor(), "REQUESTER");

  return repository.listByRequester(actor.id);
}

export async function getRequesterRequest(
  requestId: unknown,
  repository: RequestQueryRepository,
): Promise<RequestWithHistory> {
  const actor = assertRole(await requireCurrentActor(), "REQUESTER");
  const id = validateInput(entityIdSchema, requestId);
  const request = await repository.findForRequester(id, actor.id);

  if (!request) {
    throw new NotFoundError();
  }

  return request;
}

export async function listAttendantQueue(
  repository: RequestQueryRepository,
): Promise<RequestWithHistory[]> {
  const actor = assertRole(await requireCurrentActor(), "ATTENDANT");

  if (!actor.sectorId) {
    throw new NotFoundError();
  }

  return repository.listBySector(actor.sectorId);
}

export async function getAttendantRequest(
  requestId: unknown,
  repository: RequestQueryRepository,
): Promise<RequestWithHistory> {
  const actor = assertRole(await requireCurrentActor(), "ATTENDANT");
  const id = validateInput(entityIdSchema, requestId);

  if (!actor.sectorId) {
    throw new NotFoundError();
  }

  const request = await repository.findInSector(id, actor.sectorId);

  if (!request) {
    throw new NotFoundError();
  }

  return request;
}

/**
 * Colleagues the effective assignee can transfer to (section 5.2): active attendants of the
 * request's sector, except the actor. Same scope as reading the request in the queue.
 */
export async function listTransferCandidates(
  requestId: unknown,
  repository: RequestQueryRepository,
): Promise<Array<{ id: string; name: string }>> {
  const request = await getAttendantRequest(requestId, repository);
  const actor = assertRole(await requireCurrentActor(), "ATTENDANT");
  const attendants = await repository.listSectorAttendants(request.sectorId);

  return attendants.filter(({ id }) => id !== actor.id);
}
