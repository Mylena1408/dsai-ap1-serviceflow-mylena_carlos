import type { RequestPriority } from "../domain/request";
import { authorizeRequestRead } from "./attachment-queries";
import type { AttachmentQueryRepository } from "./ports";

// Escalations of a request (SPEC 2026-11-06-escalonamento, 4.7): read with the request's read
// rule; the requester never sees them (the page does not ask for them).

export interface RequestEscalationRecord {
  fromPriority: RequestPriority;
  toPriority: RequestPriority;
  occurredAt: Date;
}

export interface EscalationReader {
  listForRequest(requestId: string): Promise<RequestEscalationRecord[]>;
}

export async function listRequestEscalations(
  requestId: unknown,
  scope: Pick<AttachmentQueryRepository, "findRequestScope">,
  reader: EscalationReader,
): Promise<RequestEscalationRecord[]> {
  const id = await authorizeRequestRead(requestId, scope);
  return reader.listForRequest(id);
}
