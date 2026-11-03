import type { RequestWithHistory } from "@/modules/requests";
import { pauseSlaAction, resumeSlaAction } from "../actions";

type SlaPausePanelProps = {
  request: Pick<RequestWithHistory, "id" | "dueAt" | "slaPausedAt" | "slaPauses">;
  now: Date;
};

// "Pausar prazo (aguardando o solicitante)" and "Retomar prazo" (SPEC 2026-11-03-pausa-sla-calendario,
// 5.3, 5.4 and 5.7). An overdue request is not paused (decision H7), so the form is not shown.
export function SlaPausePanel({ request, now }: SlaPausePanelProps) {
  const pause = request.slaPauses?.find((item) => item.resumedAt === null);

  if (request.slaPausedAt) {
    return (
      <section className="surface-card content-section" aria-labelledby="sla-pause-heading">
        <p className="eyebrow">Prazo</p>
        <h2 id="sla-pause-heading">Prazo pausado</h2>
        <p>
          Aguardando o solicitante desde{" "}
          <time dateTime={request.slaPausedAt.toISOString()}>{request.slaPausedAt.toLocaleString("pt-BR")}</time>.
          {pause ? ` Motivo: ${pause.reason}` : null}
        </p>
        <p className="metadata">O prazo volta a contar quando o solicitante comentar, enviar um documento ou quando você retomar.</p>
        <form action={resumeSlaAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <button type="submit">Retomar prazo</button>
        </form>
      </section>
    );
  }

  if (!request.dueAt || now.getTime() > request.dueAt.getTime()) {
    return null;
  }

  return (
    <section className="surface-card content-section" aria-labelledby="sla-pause-heading">
      <p className="eyebrow">Prazo</p>
      <h2 id="sla-pause-heading">Pausar prazo (aguardando o solicitante)</h2>
      <p>
        Use quando o atendimento depende de uma resposta do solicitante. O solicitante vê o motivo e é avisado; o prazo
        volta a contar quando ele responder.
      </p>
      <form action={pauseSlaAction} className="create-form">
        <input type="hidden" name="requestId" value={request.id} />
        <label htmlFor="sla-pause-reason">Motivo da pausa</label>
        <textarea id="sla-pause-reason" name="reason" maxLength={500} required rows={3} />
        <button type="submit">Pausar prazo</button>
      </form>
    </section>
  );
}
