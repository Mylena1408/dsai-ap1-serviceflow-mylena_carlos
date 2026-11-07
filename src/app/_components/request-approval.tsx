import { approvalOverdue, type RequestWithHistory } from "@/modules/requests";
import { APPROVAL_LABELS } from "@/shared/requests";

// Approval situation on screens (SPEC 2026-11-01-aprovacoes, 5.7).

export { APPROVAL_LABELS };

/**
 * Next to the status; nothing for requests that never required approval. A late pending level is
 * marked at reading time (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.6).
 */
export function RequestApprovalLabel({
  request,
  now = new Date(),
}: {
  request: Pick<RequestWithHistory, "approvalState" | "approvalDueAt">;
  now?: Date;
}) {
  if (!request.approvalState) {
    return null;
  }

  return (
    <>
      <span className={`approval-pill approval-${request.approvalState.toLowerCase()}`}>
        {APPROVAL_LABELS[request.approvalState]}
      </span>
      {approvalOverdue({ approvalState: request.approvalState, approvalDueAt: request.approvalDueAt }, now) ? (
        <span className="approval-pill approval-overdue">Aprovação atrasada</span>
      ) : null}
    </>
  );
}
