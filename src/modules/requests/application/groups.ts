import { assertRequestReadable, requireCurrentActor, type AuthorizationActor } from "@/server/authorization";
import { ApplicationError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import {
  groupCancellationSchema,
  groupProgress,
  type GroupCancellation,
  type GroupProgress,
} from "../domain/request-group";
import type { RequestStatus } from "../domain/request";
import { authorizeRequestRead } from "./attachment-queries";
import type { AttachmentQueryRepository } from "./ports";

// Following a bundle (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 4): the requester sees the group
// and may cancel it; whoever attends one of its requests sees the others, with code, service, sector
// and status only (decision H4).

export interface GroupMemberRecord {
  id: string;
  requesterId: string;
  sectorId: string;
  serviceName: string;
  sectorName: string;
  status: RequestStatus;
  approvalState: "PENDING" | "APPROVED" | "REJECTED" | null;
  approvalSectorIds: string[];
}

export interface GroupRecord {
  id: string;
  bundleName: string;
  requesterId: string;
  createdAt: Date;
  /** In the bundle's order (the opening order). */
  requests: GroupMemberRecord[];
}

export interface GroupReader {
  findGroup(groupId: string): Promise<GroupRecord | null>;
  /** The group of a request, or null outside bundles. */
  findGroupOfRequest(requestId: string): Promise<GroupRecord | null>;
  /** Groups of these requests: request id → group id and bundle name. */
  groupsOfRequests(requestIds: readonly string[]): Promise<Array<{ requestId: string; groupId: string; bundleName: string }>>;
}

export interface RequesterGroupView {
  id: string;
  bundleName: string;
  createdAt: Date;
  progress: GroupProgress;
  requests: Array<{ id: string; serviceName: string; sectorName: string; status: RequestStatus; approvalState: GroupMemberRecord["approvalState"] }>;
  /** Some request may still be cancelled by the requester (open). */
  cancellable: boolean;
}

/** The requester's own group, or "not found" as someone else's request. */
export async function getRequesterGroup(groupId: unknown, reader: GroupReader): Promise<RequesterGroupView> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, groupId);
  const group = await reader.findGroup(id);

  if (!group || actor.role !== "REQUESTER" || group.requesterId !== actor.id) {
    throw new NotFoundError();
  }

  return {
    id: group.id,
    bundleName: group.bundleName,
    createdAt: group.createdAt,
    progress: groupProgress(group.requests),
    requests: group.requests.map(({ id: requestId, serviceName, sectorName, status, approvalState }) => ({
      id: requestId,
      serviceName,
      sectorName,
      status,
      approvalState,
    })),
    cancellable: group.requests.some(({ status }) => status === "OPEN"),
  };
}

/**
 * Cancelling the bundle (3.3 item 4): each request the requester could cancel alone (open) is
 * cancelled by the same rule, with the same reason, in its own transaction; the others stay as they
 * are, and the result says which.
 */
export async function cancelGroup(
  input: unknown,
  reader: GroupReader,
  cancel: (requestId: string, note: string | null) => Promise<void>,
): Promise<GroupCancellation> {
  const actor = await requireCurrentActor();
  const { groupId, note } = validateInput(groupCancellationSchema, input);
  const group = await reader.findGroup(groupId);

  if (!group || actor.role !== "REQUESTER" || group.requesterId !== actor.id) {
    throw new NotFoundError();
  }

  const result: GroupCancellation = { cancelled: [], kept: [] };
  for (const request of group.requests) {
    if (request.status !== "OPEN") {
      result.kept.push({ requestId: request.id, reason: "not_open" });
      continue;
    }
    try {
      await cancel(request.id, note);
      result.cancelled.push(request.id);
    } catch (error) {
      // Changed meanwhile (an attendant started it, for example): it stays as it is.
      if (!(error instanceof ApplicationError)) throw error;
      result.kept.push({ requestId: request.id, reason: "changed" });
    }
  }
  return result;
}

/** "Pacote: nome" on the requester's list: only the requester's own requests. */
export async function listRequesterGroupLabels(
  requestIds: readonly string[],
  reader: GroupReader,
): Promise<Map<string, { groupId: string; bundleName: string }>> {
  const actor = await requireCurrentActor();
  if (actor.role !== "REQUESTER" || requestIds.length === 0) return new Map();
  const rows = await reader.groupsOfRequests(requestIds);
  return new Map(rows.map(({ requestId, groupId, bundleName }) => [requestId, { groupId, bundleName }]));
}

export interface GroupBlock {
  groupId: string;
  bundleName: string;
  progress: GroupProgress;
  /** The other requests of the group (decision H4: no content). */
  others: Array<{ id: string; serviceName: string; sectorName: string; status: RequestStatus; readable: boolean }>;
}

function readable(actor: AuthorizationActor, request: GroupMemberRecord): boolean {
  try {
    assertRequestReadable(actor, { ...request, requiresApproval: request.approvalState !== null });
    return true;
  } catch {
    return false;
  }
}

/** The "Pacote" block of a request, for whoever reads it; null outside bundles. */
export async function getRequestGroupBlock(
  requestId: unknown,
  scope: Pick<AttachmentQueryRepository, "findRequestScope" | "approvalCoverage">,
  reader: GroupReader,
): Promise<GroupBlock | null> {
  const id = await authorizeRequestRead(requestId, scope);
  const actor = await requireCurrentActor();
  const group = await reader.findGroupOfRequest(id);
  if (!group) return null;

  return {
    groupId: group.id,
    bundleName: group.bundleName,
    progress: groupProgress(group.requests),
    others: group.requests
      .filter((request) => request.id !== id)
      .map((request) => ({
        id: request.id,
        serviceName: request.serviceName,
        sectorName: request.sectorName,
        status: request.status,
        readable: readable(actor, request),
      })),
  };
}
