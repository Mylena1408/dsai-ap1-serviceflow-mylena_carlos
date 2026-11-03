import type { RequestWithHistory } from "@/modules/requests";
import { PRIORITY_LABELS } from "./request-priority";
import { REQUEST_STATUS_LABELS } from "./request-status";

type TimelineEntry = {
  id: string;
  occurredAt: Date;
  title: string;
  actor: string;
  note: string | null;
  /** Label of the note; reasons by default. */
  noteLabel?: string;
};

type RequestTimelineProps = {
  request: RequestWithHistory;
  /** Label before the actor's name, e.g. "Atendente" in the queue. */
  actorLabel: string;
};

function assignmentTitle(event: RequestWithHistory["assignmentEvents"][number]): string {
  if (!event.fromAssignee && event.toAssignee) return `Assumida por ${event.toAssignee.name}`;
  if (event.fromAssignee && !event.toAssignee) {
    // A supervisor of the queue may release a colleague's request (SPEC de permissões, 5.3.3).
    return event.actor.id === event.fromAssignee.id
      ? `Liberada por ${event.fromAssignee.name}`
      : `Liberada por ${event.actor.name} (estava com ${event.fromAssignee.name})`;
  }
  return `Transferida de ${event.fromAssignee?.name} para ${event.toAssignee?.name}`;
}

/**
 * One chronological history with status changes, assignments and reasons (SPEC 2026-10-31,
 * section 5.9). Status events keep the texts used before this change.
 */
export function buildTimeline(request: RequestWithHistory): TimelineEntry[] {
  // A rejection cancels the request with the same note (SPEC 2026-11-01-aprovacoes, 5.3.4); the
  // note is shown once, on the decision.
  const rejection = request.approval?.decision === "REJECTED" ? request.approval : null;
  const statusEntries = request.events.map((event) => ({
    id: `status-${event.id}`,
    occurredAt: event.occurredAt,
    title: event.fromStatus
      ? `${REQUEST_STATUS_LABELS[event.fromStatus]} → ${REQUEST_STATUS_LABELS[event.toStatus]}`
      : `Solicitação aberta: ${REQUEST_STATUS_LABELS[event.toStatus]}`,
    actor: event.actor.name,
    note:
      rejection && event.toStatus === "CANCELLED" && event.occurredAt.getTime() === rejection.decidedAt.getTime()
        ? null
        : event.note,
  }));
  // SPEC 2026-11-03-anexos-comentarios-documentos, 5.3.5: documents sent after the opening.
  const documentEntries = (request.attachments ?? [])
    .filter((document) => document.createdAt.getTime() > request.createdAt.getTime())
    .map((document) => ({
      id: `document-${document.id}`,
      occurredAt: document.createdAt,
      title: `Documento enviado: ${document.requirementNameSnapshot}`,
      actor: document.uploadedBy.name,
      note: null,
    }));
  // SPEC 2026-11-03-transferencia-entre-setores, 5.5: names at the time of the move.
  const sectorEntries = (request.sectorEvents ?? []).map((event) => ({
    id: `sector-${event.id}`,
    occurredAt: event.occurredAt,
    title: `Encaminhada do setor ${event.fromSectorName} para o setor ${event.toSectorName}`,
    actor: event.actor.name,
    note: event.note,
  }));
  // SPEC 2026-11-03-pausa-sla-calendario, 5.5: the pause with its reason, and the resume with its cause.
  const pauseEntries = (request.slaPauses ?? []).flatMap((pause) => [
    {
      id: `pause-${pause.id}`,
      occurredAt: pause.pausedAt,
      title: "Prazo pausado: aguardando o solicitante",
      actor: pause.pausedBy.name,
      note: pause.reason,
      noteLabel: "Motivo",
    },
    ...(pause.resumedAt
      ? [
          {
            id: `resume-${pause.id}`,
            occurredAt: pause.resumedAt,
            title:
              pause.resumeCause === "REQUESTER_REPLY"
                ? "Prazo retomado pela resposta do solicitante"
                : pause.resumeCause === "ATTENDANCE_ENDED"
                  ? "Prazo retomado com o fim do atendimento"
                  : `Prazo retomado por ${pause.resumedBy?.name ?? ""}`.trim(),
            actor: pause.resumedBy?.name ?? "",
            note: null,
          },
        ]
      : []),
  ]);
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
          noteLabel: "Observação",
        },
      ]
    : [];

  // Stable sort: on equal times, status events come first, then sector moves, assignments,
  // priorities, stages and the approval.
  return [...statusEntries, ...sectorEntries, ...assignmentEntries, ...priorityEntries, ...stageEntries, ...approvalEntries, ...documentEntries, ...pauseEntries].sort(
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
              {entry.note ? (
                <p className="history-note">
                  {entry.noteLabel ?? "Justificativa"}: {entry.note}
                </p>
              ) : null}
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
