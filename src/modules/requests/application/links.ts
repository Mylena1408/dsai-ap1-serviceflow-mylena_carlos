import { assertRequestReadable, assertStatusChangeAllowed, requireCurrentActor, type AuthorizationActor } from "@/server/authorization";
import { NotFoundError, ValidationError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import {
  assertCanLink,
  codeRange,
  linkInputSchema,
  linkRole,
  linkVisibleToRequester,
  otherRequestId,
  requestCodeSchema,
  unlinkInputSchema,
  type LinkKind,
  type LinkRecord,
  type LinkRole,
} from "../domain/links";
import type { RequestStatus } from "../domain/request";
import { possibleDuplicates, type DuplicateCandidate } from "../domain/possible-duplicates";
import { authorizeRequestRead } from "./attachment-queries";
import type { AttachmentQueryRepository } from "./ports";

// Links between requests (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1). An attendant of the
// request's sector links it to another request they can read, by its short code; each link and
// removal goes to the history of both requests. The transaction reloads both requests and their
// links, so the limits hold with two people linking at once.

export interface LinkRequestState {
  id: string;
  requesterId: string;
  sectorId: string;
  requiresApproval: boolean;
  approvalSectorIds: string[];
  status: RequestStatus;
  serviceName: string;
  sectorName: string;
}

export interface LinkTransaction {
  currentTime(): Promise<Date>;
  findRequest(requestId: string): Promise<LinkRequestState | null>;
  /** Ids whose short code is `code`, at most two (two mean the code is ambiguous). */
  findByCode(range: { from: string; to: string }): Promise<string[]>;
  /** Links of a request, on either side. */
  linksOf(requestId: string): Promise<LinkRecord[]>;
  insertLink(link: Omit<LinkRecord, "id"> & { createdById: string; createdAt: Date }): Promise<{ id: string }>;
  deleteLink(linkId: string): Promise<void>;
  insertEvent(event: {
    fromRequestId: string;
    toRequestId: string;
    kind: LinkKind;
    action: LinkAction;
    actorId: string;
    occurredAt: Date;
  }): Promise<void>;
}

/** SPEC 2026-11-08-atendimento-dia-a-dia, 8.3 item 2: "CLOSED_AS_DUPLICATE" when the duplicate was closed. */
export type LinkAction = "LINKED" | "UNLINKED" | "CLOSED_AS_DUPLICATE";

export interface LinkStore {
  run<T>(work: (transaction: LinkTransaction) => Promise<T>): Promise<T>;
}

export interface RequestLinkView {
  id: string;
  role: LinkRole;
  other: {
    id: string;
    serviceName: string;
    sectorName: string;
    status: RequestStatus;
    /** Whether the reader may open it (3.3 item 1: the link only then). */
    readable: boolean;
  };
}

export interface RequestLinkEventView {
  id: string;
  role: LinkRole;
  action: LinkAction;
  otherRequestId: string;
  actor: { id: string; name: string };
  occurredAt: Date;
}

/** SPEC 2026-11-08-atendimento-dia-a-dia, 13.5 item 1: a suggestion, as the team sees it. */
export interface PossibleDuplicateView {
  id: string;
  serviceName: string;
  sectorName: string;
  status: RequestStatus;
  createdAt: Date;
  readable: boolean;
}

export type DuplicateCandidateState = LinkRequestState & DuplicateCandidate;

export interface LinkReader {
  listLinks(requestId: string): Promise<Array<LinkRecord & { other: LinkRequestState }>>;
  listEvents(requestId: string): Promise<Array<Omit<LinkRecord, "id"> & { id: string; action: LinkAction; actor: { id: string; name: string }; occurredAt: Date; otherRequesterId: string }>>;
  /**
   * SPEC 2026-11-08-atendimento-dia-a-dia, 13.5 item 1: the request, the requests of its requester and service in the
   * window, and the ids already linked to it. Optional for older doubles.
   */
  duplicateCandidates?(requestId: string): Promise<{
    base: DuplicateCandidate;
    candidates: DuplicateCandidateState[];
    linkedIds: string[];
  } | null>;
}

function readable(actor: AuthorizationActor, request: LinkRequestState): boolean {
  try {
    assertRequestReadable(actor, request);
    return true;
  } catch {
    return false;
  }
}

/** Loads the request the actor changes (attendant of its sector) or fails as "not found". */
async function loadSource(transaction: LinkTransaction, actor: AuthorizationActor, requestId: string): Promise<LinkRequestState> {
  const source = await transaction.findRequest(requestId);
  if (!source) throw new NotFoundError();
  assertStatusChangeAllowed(actor, source);
  return source;
}

export async function linkRequests(input: unknown, store: LinkStore): Promise<{ linkId: string }> {
  const actor = await requireCurrentActor();
  const { requestId, code, kind } = validateInput(linkInputSchema, input);

  return store.run(async (transaction) => {
    const source = await loadSource(transaction, actor, requestId);
    const matches = await transaction.findByCode(codeRange(code));

    // A code that matches two requests cannot say which one was meant.
    if (matches.length > 1) {
      throw new ValidationError([{ path: ["code"], code: "invalid_value" }]);
    }
    const target = matches.length === 1 ? await transaction.findRequest(matches[0]) : null;
    if (!target || !readable(actor, target)) {
      throw new NotFoundError();
    }

    assertCanLink(source.id, target.id, kind, await transaction.linksOf(source.id), await transaction.linksOf(target.id));
    const now = await transaction.currentTime();
    const link = await transaction.insertLink({ fromRequestId: source.id, toRequestId: target.id, kind, createdById: actor.id, createdAt: now });
    await transaction.insertEvent({ fromRequestId: source.id, toRequestId: target.id, kind, action: "LINKED", actorId: actor.id, occurredAt: now });
    return { linkId: link.id };
  });
}

/** Removes a link of the request; from either side, by an attendant who can read the other one. */
export async function unlinkRequests(input: unknown, store: LinkStore): Promise<void> {
  const actor = await requireCurrentActor();
  const { requestId, linkId } = validateInput(unlinkInputSchema, input);

  await store.run(async (transaction) => {
    const source = await loadSource(transaction, actor, requestId);
    const link = (await transaction.linksOf(source.id)).find((item) => item.id === linkId);
    const other = link ? await transaction.findRequest(otherRequestId(link, source.id)) : null;

    if (!link || !other || !readable(actor, other)) {
      throw new NotFoundError();
    }

    const now = await transaction.currentTime();
    await transaction.deleteLink(link.id);
    await transaction.insertEvent({
      fromRequestId: link.fromRequestId,
      toRequestId: link.toRequestId,
      kind: link.kind,
      action: "UNLINKED",
      actorId: actor.id,
      occurredAt: now,
    });
  });
}

/**
 * The links of a request for whoever reads it (3.3 item 1): the requester only those to other
 * requests of their own; the others every link, opening only the requests they can read.
 */
export async function listRequestLinks(
  requestId: unknown,
  scope: Pick<AttachmentQueryRepository, "findRequestScope" | "approvalCoverage">,
  reader: LinkReader,
): Promise<{ links: RequestLinkView[]; events: RequestLinkEventView[] }> {
  const id = await authorizeRequestRead(requestId, scope);
  const actor = await requireCurrentActor();
  const isRequester = actor.role === "REQUESTER";
  const [links, events] = await Promise.all([reader.listLinks(id), reader.listEvents(id)]);

  return {
    links: links
      .filter((link) => !isRequester || linkVisibleToRequester(actor.id, link.other.requesterId))
      .map((link) => ({
        id: link.id,
        role: linkRole(link, id),
        other: {
          id: link.other.id,
          serviceName: link.other.serviceName,
          sectorName: link.other.sectorName,
          status: link.other.status,
          readable: readable(actor, link.other),
        },
      })),
    events: events
      .filter((event) => !isRequester || linkVisibleToRequester(actor.id, event.otherRequesterId))
      .map((event) => ({
        id: event.id,
        role: linkRole(event, id),
        action: event.action,
        otherRequestId: otherRequestId(event, id),
        actor: event.actor,
        occurredAt: event.occurredAt,
      })),
  };
}

/**
 * SPEC 2026-11-08-atendimento-dia-a-dia, 13.5 item 1 (decision J9): the possible duplicates of a request, for the team
 * only (the attendants who read it); anyone else gets none. Each suggestion opens only for whoever may read it.
 */
export async function listPossibleDuplicates(
  requestId: unknown,
  scope: Pick<AttachmentQueryRepository, "findRequestScope" | "approvalCoverage">,
  reader: LinkReader,
): Promise<PossibleDuplicateView[]> {
  const id = await authorizeRequestRead(requestId, scope);
  const actor = await requireCurrentActor();
  if (actor.role !== "ATTENDANT" || !reader.duplicateCandidates) return [];
  const found = await reader.duplicateCandidates(id);
  if (!found) return [];

  return possibleDuplicates(found.base, found.candidates, new Set(found.linkedIds)).map((candidate) => ({
    id: candidate.id,
    serviceName: candidate.serviceName,
    sectorName: candidate.sectorName,
    status: candidate.status,
    createdAt: candidate.createdAt,
    readable: readable(actor, candidate),
  }));
}

/**
 * SPEC 2026-11-08-atendimento-dia-a-dia, 13.5 item 2 (decision J10): the original a batch closes into, by its short
 * code, checked once before any item: one request the attendant reads, not cancelled. Anything else refuses the
 * whole batch, as a wrong code (the items are not touched).
 */
export async function findDuplicateTarget(code: unknown, store: LinkStore): Promise<string> {
  const actor = await requireCurrentActor();
  const refused = () => new ValidationError([{ path: ["code"], code: "invalid_value" }]);
  const parsed = requestCodeSchema.safeParse(code);
  if (!parsed.success) throw refused();

  return store.run(async (transaction) => {
    const matches = await transaction.findByCode(codeRange(parsed.data));
    const target = matches.length === 1 ? await transaction.findRequest(matches[0]) : null;
    if (!target || !readable(actor, target) || target.status === "CANCELLED") throw refused();
    return target.id;
  });
}

/**
 * 13.5 item 2: the request becomes "duplicada de" the original, by the links' rules, unless it already is (then
 * nothing is written). Same transaction and checks as linking by the form.
 */
export async function ensureDuplicateLink(input: { requestId: string; originalId: string }, store: LinkStore): Promise<void> {
  const actor = await requireCurrentActor();
  await store.run(async (transaction) => {
    const source = await loadSource(transaction, actor, input.requestId);
    const target = await transaction.findRequest(input.originalId);
    if (!target || !readable(actor, target)) throw new NotFoundError();

    const sourceLinks = await transaction.linksOf(source.id);
    const linked = sourceLinks.some((link) => link.kind === "DUPLICATE_OF" && link.fromRequestId === source.id && link.toRequestId === target.id);
    if (linked) return;

    assertCanLink(source.id, target.id, "DUPLICATE_OF", sourceLinks, await transaction.linksOf(target.id));
    const now = await transaction.currentTime();
    await transaction.insertLink({ fromRequestId: source.id, toRequestId: target.id, kind: "DUPLICATE_OF", createdById: actor.id, createdAt: now });
    await transaction.insertEvent({ fromRequestId: source.id, toRequestId: target.id, kind: "DUPLICATE_OF", action: "LINKED", actorId: actor.id, occurredAt: now });
  });
}
