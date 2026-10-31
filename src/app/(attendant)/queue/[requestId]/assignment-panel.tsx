import { effectiveAssigneeId, type RequestWithHistory } from "@/modules/requests";
import { assumeRequestAction, releaseRequestAction, transferRequestAction } from "../actions";

type AssignmentPanelProps = {
  request: RequestWithHistory;
  actorId: string;
  candidates: Array<{ id: string; name: string }>;
};

// Responsible attendant and the assignment actions (SPEC 2026-10-31, section 5.2). Buttons
// only mirror the rules; the server checks every action again.
export function AssignmentPanel({ request, actorId, candidates }: AssignmentPanelProps) {
  const assigneeId = effectiveAssigneeId(request);
  const assignable = request.status === "OPEN" || request.status === "IN_PROGRESS";
  const isMine = assigneeId !== null && assigneeId === actorId;

  let holder = "Ninguém assumiu esta solicitação.";
  if (request.assignee && assigneeId === null) {
    holder = `${request.assignee.name} (não atende mais este setor; qualquer atendente pode assumir)`;
  } else if (request.assignee) {
    holder = isMine ? `${request.assignee.name} (você)` : request.assignee.name;
  }

  return (
    <section className="surface-card content-section" aria-labelledby="assignment-heading">
      <p className="eyebrow">Atribuição</p>
      <h2 id="assignment-heading">Responsável</h2>
      <p>{holder}</p>
      {assignable && assigneeId === null ? (
        <form action={assumeRequestAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <button type="submit">Assumir</button>
        </form>
      ) : null}
      {assignable && isMine ? (
        <div className="assignment-actions">
          <form action={releaseRequestAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <button className="button-secondary" type="submit">Liberar</button>
          </form>
          {candidates.length > 0 ? (
            <form action={transferRequestAction} className="transfer-form">
              <input type="hidden" name="requestId" value={request.id} />
              <label htmlFor="transfer-assignee">Transferir para</label>
              <select id="transfer-assignee" name="assigneeId" required defaultValue="">
                <option value="" disabled>
                  Escolha um atendente do setor
                </option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              <button type="submit">Transferir</button>
            </form>
          ) : (
            <p>Não há outro atendente ativo neste setor para transferir.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
