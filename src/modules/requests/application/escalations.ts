import type { RequestPriority } from "../domain/request";
import { authorizeRequestRead } from "./attachment-queries";
import type { AttachmentQueryRepository } from "./ports";

// Escalations of a request (SPEC 2026-11-06-escalonamento, 4.7): read with the request's read
// rule; the requester never sees them (the page does not ask for them).

export interface RequestEscalationRecord {
  fromPriority: RequestPriority;
  toPriority: RequestPriority;
  occurredAt: Date;
  // SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 item 5; optional for older doubles.
  id?: string;
  /** OVERDUE is the sector's option; the others come from a rule. */
  trigger?: "OVERDUE" | "DUE_SOON" | "OVERDUE_DAYS";
  overdueDays?: number | null;
  ruleName?: string | null;
  assignedTo?: { id: string; name: string } | null;
  assignmentSkipped?: boolean;
  /** How many people the rule warned. */
  notifiedCount?: number;
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
