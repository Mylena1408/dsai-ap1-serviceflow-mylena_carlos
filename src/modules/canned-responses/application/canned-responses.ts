import { requireCurrentActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { requestShortCode } from "@/shared/requests";
import { cannedResponseInputSchema, compareTitles, renderCannedResponse } from "../domain/canned-response";

// Use cases of the canned responses (SPEC 2026-11-06-respostas-prontas, 4): only active
// attendants, only the responses of their current sector. Anything else is "not found".

export interface CannedResponseRecord {
  id: string;
  sectorId: string;
  title: string;
  body: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  updatedAt: Date;
}

export interface CannedResponseRepository {
  /** The attendant as stored now: role, situation and sector are read again on every call. */
  findAttendant(userId: string): Promise<{ id: string; name: string; role: string; isActive: boolean; sectorId: string | null } | null>;
  /** What the fields need from a request, with its current sector. */
  findRequest(requestId: string): Promise<{ id: string; sectorId: string; requesterName: string; serviceName: string } | null>;
  listForSector(sectorId: string): Promise<CannedResponseRecord[]>;
  find(id: string): Promise<CannedResponseRecord | null>;
  /** Fails with a conflict when another active response of the sector has the same title. */
  create(input: { sectorId: string; title: string; body: string; actorId: string }): Promise<CannedResponseRecord>;
  update(id: string, input: { title: string; body: string; actorId: string }): Promise<void>;
  setActive(id: string, isActive: boolean, actorId: string): Promise<void>;
}

async function attendantSector(repository: CannedResponseRepository): Promise<{ actorId: string; sectorId: string }> {
  const session = await requireCurrentActor();
  const attendant = await repository.findAttendant(session.id);
  if (!attendant || !attendant.isActive || attendant.role !== "ATTENDANT" || attendant.sectorId === null) {
    throw new NotFoundError();
  }
  return { actorId: attendant.id, sectorId: attendant.sectorId };
}

async function ownResponse(repository: CannedResponseRepository, id: unknown) {
  const { actorId, sectorId } = await attendantSector(repository);
  const responseId = validateInput(entityIdSchema, id);
  const response = await repository.find(responseId);
  if (!response || response.sectorId !== sectorId) throw new NotFoundError();
  return { actorId, response };
}

/** Every response of the attendant's sector, active first, then by title. */
export async function listSectorResponses(repository: CannedResponseRepository): Promise<CannedResponseRecord[]> {
  const { sectorId } = await attendantSector(repository);
  const responses = await repository.listForSector(sectorId);
  return [...responses].sort((left, right) => Number(right.isActive) - Number(left.isActive) || compareTitles(left, right));
}

/** The active ones, by title: what the comment form offers (4.4). */
export async function listActiveResponses(repository: CannedResponseRepository): Promise<CannedResponseRecord[]> {
  return (await listSectorResponses(repository)).filter((response) => response.isActive);
}

/**
 * The active responses rendered for one request of the attendant's sector (4.4): the fields use
 * what the attendant already sees. A request of another sector is "not found".
 */
export async function listResponsesForRequest(
  requestId: unknown,
  repository: CannedResponseRepository,
): Promise<Array<{ id: string; title: string; text: string }>> {
  const session = await requireCurrentActor();
  const attendant = await repository.findAttendant(session.id);
  if (!attendant || !attendant.isActive || attendant.role !== "ATTENDANT" || attendant.sectorId === null) {
    throw new NotFoundError();
  }
  const request = await repository.findRequest(validateInput(entityIdSchema, requestId));
  if (!request || request.sectorId !== attendant.sectorId) throw new NotFoundError();

  const responses = (await repository.listForSector(attendant.sectorId)).filter((response) => response.isActive).sort(compareTitles);
  const values = {
    requesterName: request.requesterName,
    serviceName: request.serviceName,
    shortCode: requestShortCode(request.id),
    attendantName: attendant.name,
  };
  return responses.map((response) => ({ id: response.id, title: response.title, text: renderCannedResponse(response.body, values) }));
}

export async function createCannedResponse(input: unknown, repository: CannedResponseRepository): Promise<CannedResponseRecord> {
  const { actorId, sectorId } = await attendantSector(repository);
  const parsed = validateInput(cannedResponseInputSchema, input);
  return repository.create({ sectorId, title: parsed.title, body: parsed.body, actorId });
}

export async function updateCannedResponse(id: unknown, input: unknown, repository: CannedResponseRepository): Promise<void> {
  const { actorId, response } = await ownResponse(repository, id);
  const parsed = validateInput(cannedResponseInputSchema, input);
  await repository.update(response.id, { title: parsed.title, body: parsed.body, actorId });
}

export async function setCannedResponseActive(id: unknown, isActive: boolean, repository: CannedResponseRepository): Promise<void> {
  const { actorId, response } = await ownResponse(repository, id);
  if (response.isActive === isActive) throw new ConflictError();
  await repository.setActive(response.id, isActive, actorId);
}
