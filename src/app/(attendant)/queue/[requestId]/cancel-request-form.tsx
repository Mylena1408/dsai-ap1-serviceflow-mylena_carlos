import { cancelRequestAction } from "../actions";

// Section 5.4: the attendant cancels with a mandatory reason, kept in the history.
export function CancelRequestForm({ requestId }: { requestId: string }) {
  return (
    <details className="surface-card content-section lifecycle-form">
      <summary>Cancelar solicitação</summary>
      <form action={cancelRequestAction}>
        <input type="hidden" name="requestId" value={requestId} />
        <label htmlFor="cancel-note">Justificativa (obrigatória)</label>
        <textarea id="cancel-note" name="note" required maxLength={1_000} rows={3} />
        <button className="button-danger" type="submit">Confirmar cancelamento</button>
      </form>
    </details>
  );
}
