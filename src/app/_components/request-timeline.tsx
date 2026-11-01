import type { RequestWithHistory } from "@/modules/requests";
import { PRIORITY_LABELS } from "./request-priority";
import { REQUEST_STATUS_LABELS } from "./request-status";

type TimelineEntry = {
  id: string;
  occurredAt: Date;
  title: string;
  actor: string;
  note: string | null;
};

type RequestTimelineProps = {
  request: RequestWithHistory;
  /** Label before the actor's name, e.g. "Atendente" in the queue. */
  actorLabel: string;
};

function assignmentTitle(event: RequestWithHistory["assignmentEvents"][number]): string {
  if (!event.fromAssignee && event.toAssignee) return `Assumida por ${event.toAssignee.name}`;
  if (event.fromAssignee && !event.toAssignee) return `Liberada por ${event.fromAssignee.name}`;
  return `Transferida de ${event.fromAssignee?.name} para ${event.toAssignee?.name}`;
}

/**
 * One chronological history with status changes, assignments and reasons (SPEC 2026-10-31,
 * section 5.9). Status events keep the texts used before this change.
 */
export function buildTimeline(request: RequestWithHistory): TimelineEntry[] {
  const statusEntries = request.events.map((event) => ({
    id: `status-${event.id}`,
    occurredAt: event.occurredAt,
    title: event.fromStatus
      ? `${REQUEST_STATUS_LABELS[event.fromStatus]} → ${REQUEST_STATUS_LABELS[event.toStatus]}`
      : `Solicitação aberta: ${REQUEST_STATUS_LABELS[event.toStatus]}`,
    actor: event.actor.name,
    note: event.note,
  }));
  const assignmentEntries = request.assignmentEvents.map((event) => ({
    id: `assignment-${event.id}`,
    occurredAt: event.occurredAt,
    title: assignmentTitle(event),
    actor: event.actor.name,
    note: null,
  }));

  const priorityEntries = request.priorityEvents.map((event) => ({
    id: `priority-${event.id}`,
    occurredAt: event.occurredAt,
    title: `Prioridade: ${PRIORITY_LABELS[event.fromPriority]} → ${PRIORITY_LABELS[event.toPriority]}`,
    actor: event.actor.name,
    note: null,
  }));

  // SPEC 2026-11-01-fluxos-configuraveis, 5.5: entering the first stage and every move.
  const stageEntries = request.stageEvents.map((event) => ({
    id: `stage-${event.id}`,
    occurredAt: event.occurredAt,
    title: event.fromStage ? `Etapa: ${event.fromStage} → ${event.toStage}` : `Etapa: ${event.toStage}`,
    actor: event.actor.name,
    note: event.note,
  }));

  // SPEC 2026-11-01-aprovacoes, 5.6: the manager decision with its note.
  const approvalEntries = request.approval
    ? [
        {
          id: `approval-${request.approval.id}`,
          occurredAt: request.approval.decidedAt,
          title: `${request.approval.decision === "APPROVED" ? "Aprovada" : "Rejeitada"} por ${request.approval.decider.name}`,
          actor: request.approval.decider.name,
          note: request.approval.note,
        },
      ]
    : [];

  // Stable sort: on equal times, status events come first, then assignments, priorities, stages
  // and the approval.
  return [...statusEntries, ...assignmentEntries, ...priorityEntries, ...stageEntries, ...approvalEntries].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
}

export function RequestTimeline({ request, actorLabel }: RequestTimelineProps) {
  const entries = buildTimeline(request);

  return (
    <section className="surface-card content-section" aria-labelledby="history-heading">
      <p className="eyebrow">Rastreabilidade</p>
      <h2 id="history-heading">Histórico</h2>
      {entries.length === 0 ? (
        <p className="empty-state">Nenhum evento registrado.</p>
      ) : (
        <ol className="history-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <p>{entry.title}</p>
              {entry.note ? <p className="history-note">Justificativa: {entry.note}</p> : null}
              <p>
                {actorLabel}: {entry.actor}
              </p>
              <time dateTime={entry.occurredAt.toISOString()}>
                {entry.occurredAt.toLocaleString("pt-BR")}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
