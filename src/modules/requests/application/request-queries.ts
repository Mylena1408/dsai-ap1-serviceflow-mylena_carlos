import { actorHasPermission, assertRole, requireCurrentActor } from "@/server/authorization";
import { approvalLevelsView, type ApprovalLevelsView } from "../domain/approval-levels-view";
import { requestApprovalSectors } from "../domain/approval";
import { AuthorizationError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import type { RequestWithHistory } from "../domain/request";
import { parseSearchCriteria, type RawSearchParams, type SearchCriteria } from "../domain/search-criteria";
import type { DuplicateOriginalView, RequestQueryRepository, RequestSearchPage } from "./ports";

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

  return withoutAttendanceHistory(request);
}

/**
 * SPEC 2026-11-08-atendimento-dia-a-dia, 6.3 item 2 (decision I13): a colleague the requester added reads the request
 * as the requester does, through this separate path; the requester's own paths do not change. Anyone else is told
 * it does not exist.
 */
export async function getFollowedRequest(requestId: unknown, repository: RequestQueryRepository): Promise<RequestWithHistory> {
  const actor = assertRole(await requireCurrentActor(), "REQUESTER");
  const id = validateInput(entityIdSchema, requestId);
  const request = repository.findForColleagueFollower ? await repository.findForColleagueFollower(id, actor.id) : null;
  if (!request) {
    throw new NotFoundError();
  }
  return withoutAttendanceHistory(request);
}

/** 6.3 item 2 (decision I14): the requests the requester follows, for "Que eu acompanho". */
export async function listFollowedRequests(repository: RequestQueryRepository): Promise<RequestWithHistory[]> {
  const actor = assertRole(await requireCurrentActor(), "REQUESTER");
  const requests = repository.listForColleagueFollower ? await repository.listForColleagueFollower(actor.id) : [];
  return requests.map(withoutAttendanceHistory);
}

/**
 * SPEC 2026-11-08-atendimento-dia-a-dia, 8.3 item 2: on the requester's own duplicate closed by the team, the original it
 * went into, read through the colleague's page; only while they follow it, so nothing new is shown by this path.
 */
export async function getFollowedDuplicateOriginal(requestId: unknown, repository: RequestQueryRepository): Promise<DuplicateOriginalView | null> {
  const actor = assertRole(await requireCurrentActor(), "REQUESTER");
  const id = validateInput(entityIdSchema, requestId);
  return repository.findFollowedDuplicateOriginal ? repository.findFollowedDuplicateOriginal(id, actor.id) : null;
}

/**
 * The saves of the attendance fields are seen only by the team (SPEC 2026-11-03-campos-condicionais-
 * atendimento, 5.6), so the requester's and the manager's details leave them out.
 */
function withoutAttendanceHistory(request: RequestWithHistory): RequestWithHistory {
  const rest = { ...request };
  delete rest.fieldUpdates;
  return rest;
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

  // SPEC 2026-11-01-permissoes-configuraveis, 5.3.2: "sector" lists every request of the sector.
  if (filter === "sector") {
    if (!(await actorHasPermission(actor, "SECTOR_REQUESTS_READ"))) {
      throw new AuthorizationError();
    }
    return repository.listBySector(actor.sectorId);
  }

  return repository.listForApproval(actor.sectorId, filter !== "all", await coveredSectors(repository, actor.id));
}

/** Sectors a manager replaces today (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5). */
async function coveredSectors(repository: Pick<RequestQueryRepository, "approvalCoverage">, managerId: string): Promise<string[]> {
  return repository.approvalCoverage ? (await repository.approvalCoverage(managerId)).map(({ sectorId }) => sectorId) : [];
}

/**
 * The sectors whose pending levels the current manager decides: their own and, in an absence, the
 * absent managers' (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5). Used by the screens
 * to show the decision forms only to who may decide.
 */
export async function getApprovalActingSectors(repository: RequestQueryRepository): Promise<string[]> {
  const actor = assertRole(await requireCurrentActor(), "MANAGER");
  return actor.sectorId ? [actor.sectorId, ...(await coveredSectors(repository, actor.id))] : [];
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

  const request =
    (await repository.findForApproval(id, actor.sectorId, await coveredSectors(repository, actor.id))) ??
    ((await actorHasPermission(actor, "SECTOR_REQUESTS_READ")) ? await repository.findInSector(id, actor.sectorId) : null);

  if (!request) {
    throw new NotFoundError();
  }

  return withoutAttendanceHistory(request);
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

/**
 * The approval levels of a request the caller already read (SPEC
 * 2026-11-06-aprofundamento-configurabilidade, 4.3.3 to 4.3.6): only sector names are added, so
 * nothing beyond the request itself is revealed. Null without approval.
 */
export async function getApprovalLevels(
  request: Parameters<typeof approvalLevelsView>[0],
  repository: Pick<RequestQueryRepository, "sectorNames">,
  now: Date = new Date(),
): Promise<ApprovalLevelsView | null> {
  if (request.approvalState === null) return null;
  const sectorIds = requestApprovalSectors(request);
  const names = repository.sectorNames ? await repository.sectorNames(sectorIds) : new Map<string, string>();
  return approvalLevelsView(request, names, now);
}

/**
 * The choices of the queue's "Etapa" filter (SPEC 2026-11-06-aprofundamento-configurabilidade,
 * 5.3.4): the current stages of the sector's requests in progress. Same scope as the queue.
 */
export async function listQueueStageChoices(repository: Pick<RequestQueryRepository, "currentStageNames">): Promise<string[]> {
  const actor = assertRole(await requireCurrentActor(), "ATTENDANT");

  if (!actor.sectorId) {
    throw new NotFoundError();
  }

  return repository.currentStageNames ? repository.currentStageNames(actor.sectorId) : [];
}
