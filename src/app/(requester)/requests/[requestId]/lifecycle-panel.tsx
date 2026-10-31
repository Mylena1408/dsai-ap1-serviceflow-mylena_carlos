import { REOPEN_WINDOW_MS, type RequestWithHistory } from "@/modules/requests";
import { cancelOwnRequestAction, reopenOwnRequestAction } from "../actions";

// What the requester may still do with the request (SPEC 2026-10-31, sections 5.4 and 5.5).
// The server checks every rule again, with the database clock.
export function LifecyclePanel({ request, now }: { request: RequestWithHistory; now: Date }) {
  if (request.status === "OPEN") {
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

  if (request.status !== "COMPLETED" || request.completedAt === null) {
    return null;
  }

  const deadline = new Date(request.completedAt.getTime() + REOPEN_WINDOW_MS);

  if (now > deadline) {
    return (
      <p className="content-section metadata">
        O prazo para reabrir terminou em {deadline.toLocaleString("pt-BR")}. Se precisar, abra uma nova
        solicitação.
      </p>
    );
  }

  return (
    <details className="surface-card content-section lifecycle-form">
      <summary>Reabrir solicitação</summary>
      <p>Você pode reabrir até {deadline.toLocaleString("pt-BR")}. Ela volta para o mesmo atendente.</p>
      <form action={reopenOwnRequestAction}>
        <input type="hidden" name="requestId" value={request.id} />
        <label htmlFor="reopen-note">O que ainda não foi resolvido? (obrigatório)</label>
        <textarea id="reopen-note" name="note" required maxLength={1_000} rows={3} />
        <button type="submit">Reabrir</button>
      </form>
    </details>
  );
}
