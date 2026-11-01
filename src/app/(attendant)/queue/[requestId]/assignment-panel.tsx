import { effectiveAssigneeId, type RequestWithHistory } from "@/modules/requests";
import { assumeRequestAction, releaseRequestAction, transferRequestAction } from "../actions";

type AssignmentPanelProps = {
  request: RequestWithHistory;
  actorId: string;
  candidates: Array<{ id: string; name: string }>;
  /** "Supervisionar a fila do setor" (SPEC 2026-11-01-permissoes-configuraveis, 5.3.3). */
  supervisor?: boolean;
};

// Responsible attendant and the assignment actions (SPEC 2026-10-31, section 5.2). Buttons
// only mirror the rules; the server checks every action again.
export function AssignmentPanel({ request, actorId, candidates, supervisor = false }: AssignmentPanelProps) {
  const assigneeId = effectiveAssigneeId(request);
  const assignable = request.status === "OPEN" || request.status === "IN_PROGRESS";
  const isMine = assigneeId !== null && assigneeId === actorId;
  // A supervisor releases or transfers a colleague's request; the holder is never a target.
  const supervising = supervisor && assigneeId !== null && !isMine;
  const targets = candidates.filter(({ id }) => id !== assigneeId);

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
      {assignable && supervising ? <p>Você supervisiona a fila do setor: pode liberar ou transferir.</p> : null}
      {assignable && (isMine || supervising) ? (
        <div className="assignment-actions">
          <form action={releaseRequestAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <button className="button-secondary" type="submit">Liberar</button>
          </form>
          {targets.length > 0 ? (
            <form action={transferRequestAction} className="transfer-form">
              <input type="hidden" name="requestId" value={request.id} />
              <label htmlFor="transfer-assignee">Transferir para</label>
              <select id="transfer-assignee" name="assigneeId" required defaultValue="">
                <option value="" disabled>
                  Escolha um atendente do setor
                </option>
                {targets.map((candidate) => (
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
