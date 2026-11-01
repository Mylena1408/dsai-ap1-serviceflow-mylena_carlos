import { assertRole, requireCurrentActor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import type { RequestWithHistory } from "../domain/request";
import { parseSearchCriteria, type RawSearchParams, type SearchCriteria } from "../domain/search-criteria";
import type { RequestQueryRepository, RequestSearchPage } from "./ports";

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
 * SPEC 2026-11-01-aprovacoes, 5.7 (decision A4): a manager reads only the requests of the sector
 * that require approval, pending first; "all" also lists the decided ones.
 */
export async function listManagerApprovals(
  filter: unknown,
  repository: RequestQueryRepository,
): Promise<RequestWithHistory[]> {
  const actor = assertRole(await requireCurrentActor(), "MANAGER");

  if (!actor.sectorId) {
    throw new NotFoundError();
  }

  return repository.listForApproval(actor.sectorId, filter !== "all");
}

export async function getManagerRequest(
  requestId: unknown,
  repository: RequestQueryRepository,
): Promise<RequestWithHistory> {
  const actor = assertRole(await requireCurrentActor(), "MANAGER");
  const id = validateInput(entityIdSchema, requestId);

  if (!actor.sectorId) {
    throw new NotFoundError();
  }

  const request = await repository.findForApproval(id, actor.sectorId);

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

export interface RequestSearchResult extends RequestSearchPage {
  criteria: SearchCriteria;
}

function asRawParams(raw: unknown): RawSearchParams {
  return raw !== null && typeof raw === "object" ? (raw as RawSearchParams) : {};
}

/** "Minhas solicitações" with search, filters and pages; only the requester's own requests. */
export async function searchRequesterRequests(
  rawParams: unknown,
  repository: RequestQueryRepository,
): Promise<RequestSearchResult> {
  const actor = assertRole(await requireCurrentActor(), "REQUESTER");
  const criteria = parseSearchCriteria(asRawParams(rawParams), "requester");
  const page = await repository.search({ requesterId: actor.id }, criteria, actor.id);

  return { ...page, criteria };
}

/** "Fila do meu setor" with search, filters and pages; only the attendant's current sector. */
export async function searchAttendantQueue(
  rawParams: unknown,
  repository: RequestQueryRepository,
): Promise<RequestSearchResult> {
  const actor = assertRole(await requireCurrentActor(), "ATTENDANT");

  if (!actor.sectorId) {
    throw new NotFoundError();
  }

  const criteria = parseSearchCriteria(asRawParams(rawParams), "attendant");
  const page = await repository.search({ sectorId: actor.sectorId }, criteria, actor.id);

  return { ...page, criteria };
}
