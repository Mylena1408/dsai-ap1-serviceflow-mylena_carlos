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
  unlinkInputSchema,
  type LinkKind,
  type LinkRecord,
  type LinkRole,
} from "../domain/links";
import type { RequestStatus } from "../domain/request";
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

export interface LinkReader {
  listLinks(requestId: string): Promise<Array<LinkRecord & { other: LinkRequestState }>>;
  listEvents(requestId: string): Promise<Array<Omit<LinkRecord, "id"> & { id: string; action: LinkAction; actor: { id: string; name: string }; occurredAt: Date; otherRequesterId: string }>>;
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
