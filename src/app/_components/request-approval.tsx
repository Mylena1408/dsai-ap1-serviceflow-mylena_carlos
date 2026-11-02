import type { RequestWithHistory } from "@/modules/requests";
import { APPROVAL_LABELS } from "@/shared/requests";

// Approval situation on screens (SPEC 2026-11-01-aprovacoes, 5.7).

export { APPROVAL_LABELS };

/** Next to the status; nothing for requests that never required approval. */
export function RequestApprovalLabel({ request }: { request: Pick<RequestWithHistory, "approvalState"> }) {
  if (!request.approvalState) {
    return null;
  }

  return (
    <span className={`approval-pill approval-${request.approvalState.toLowerCase()}`}>
      {APPROVAL_LABELS[request.approvalState]}
    </span>
  );
}
