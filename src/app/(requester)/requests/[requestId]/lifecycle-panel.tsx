import type { RequestWithHistory } from "@/modules/requests";
import { cancelOwnRequestAction } from "../actions";

// What the requester may still do with the request (SPEC 2026-10-31, sections 5.4 and 5.5).
// The server checks every rule again.
export function LifecyclePanel({ request }: { request: RequestWithHistory }) {
  if (request.status !== "OPEN") {
    return null;
  }

  return (
    <details className="surface-card content-section lifecycle-form">
      <summary>Cancelar solicitação</summary>
      <p>Só é possível cancelar enquanto o atendimento não começou.</p>
      <form action={cancelOwnRequestAction}>
        <input type="hidden" name="requestId" value={request.id} />
        <label htmlFor="cancel-note">Motivo (opcional)</label>
        <textarea id="cancel-note" name="note" maxLength={1_000} rows={3} />
        <button className="button-danger" type="submit">Confirmar cancelamento</button>
      </form>
    </details>
  );
}
