import { LINK_ROLE_LABELS, type RequestLinkEventView, type RequestWithHistory } from "@/modules/requests";
import { requestShortCode } from "@/shared/requests";
import type { RequestTagEventView } from "@/modules/tags";
import { tagEventTitle } from "./request-tags";
import type { RequestChecklistEventView } from "@/modules/checklists";
import type { TimeEventView } from "@/modules/time-entries";
import { timeEventTitle } from "./request-time";
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
  /** SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1: the history of the links the reader sees. */
  linkEvents?: readonly RequestLinkEventView[];
  /** SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 3: tags put on and taken off, for the team. */
  tagEvents?: readonly RequestTagEventView[];
  /** SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 3 and 13.1 item 4: checklist items marked and unmarked, for the team. */
  checklistEvents?: readonly RequestChecklistEventView[];
  /** SPEC 2026-11-08-atendimento-dia-a-dia, 5.3 item 3: time logged, changed and removed, for the team. */
  timeEvents?: readonly TimeEventView[];
};

/** Who made an assignment change: a person or, for a rule's handover, the system (decision G17). */
export const SYSTEM_ACTOR_NAME = "Sistema (regra de escalonamento)";

type AssignmentEvent = RequestWithHistory["assignmentEvents"][number];

/** Who made a system change, by its reason (SPEC 2026-11-07-operacao-e-automacao, 4.4, decision H19). */
export function systemActorName(reason: AssignmentEvent["reason"]): string {
  if (reason === "DISTRIBUTION") return "Sistema (distribuição automática)";
  if (reason === "ABSENCE") return "Sistema (ausência do responsável)";
  return SYSTEM_ACTOR_NAME;
}

function systemAssignmentTitle(event: AssignmentEvent): string {
  const to = event.toAssignee?.name;
  if (event.reason === "DISTRIBUTION") return `Distribuída automaticamente a ${to}`;
  if (event.reason === "ABSENCE") return `Passada de ${event.fromAssignee?.name} para ${to} pela ausência do responsável`;
  // SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 item 3: a rule's handover (the reason was
  // added later; older rows read the same).
  return event.fromAssignee
    ? `Transferida de ${event.fromAssignee.name} para ${to} pela regra de escalonamento`
    : `Atribuída a ${to} pela regra de escalonamento`;
}

function assignmentTitle(event: AssignmentEvent): string {
  if (!event.actor) return systemAssignmentTitle(event);
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
/** "Vinculada como duplicada de #AB12CD34" or "Vínculo removido: relacionada a #…". */
export function linkEventTitle(event: Pick<RequestLinkEventView, "role" | "action" | "otherRequestId">): string {
  const target = `${LINK_ROLE_LABELS[event.role].toLowerCase()} #${requestShortCode(event.otherRequestId)}`;
  return event.action === "LINKED" ? `Vinculada como ${target}` : `Vínculo removido: ${target}`;
}

export function buildTimeline(
  request: RequestWithHistory,
  linkEvents: readonly RequestLinkEventView[] = [],
  tagEvents: readonly RequestTagEventView[] = [],
  checklistEvents: readonly RequestChecklistEventView[] = [],
  timeEvents: readonly TimeEventView[] = [],
): TimelineEntry[] {
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
  // SPEC 2026-11-03-campos-condicionais-atendimento, 5.5.3: labels of the changed fields, never values.
  const fieldEntries = (request.fieldUpdates ?? []).map((update) => ({
    id: `fields-${update.id}`,
    occurredAt: update.occurredAt,
    title: `Informações do atendimento atualizadas: ${update.labels.join(", ")}`,
    actor: update.actor.name,
    note: null,
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
    actor: event.actor?.name ?? systemActorName(event.reason),
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
    title: `${event.fromStage ? `Etapa: ${event.fromStage} → ${event.toStage}` : `Etapa: ${event.toStage}`}${
      // SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.1.
      event.assigneeUnavailable ? " (responsável da etapa indisponível)" : ""
    }`,
    actor: event.actor.name,
    note: event.note,
  }));

  // SPEC 2026-11-01-aprovacoes, 5.6: the manager decisions with their notes. With more than one
  // level, each decision names its level (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3);
  // with one level the text is the same as before.
  const decisions = request.approvals ?? (request.approval ? [request.approval] : []);
  const levelCount = request.approvalSectorIdsSnapshot?.length ?? 0;
  const approvalEntries = decisions.map((decision) => ({
    id: `approval-${decision.id}`,
    occurredAt: decision.decidedAt,
    title: `${decision.decision === "APPROVED" ? "Aprovada" : "Rejeitada"}${
      levelCount > 1 ? ` no nível ${decision.level ?? 1} de ${levelCount}` : ""
    } por ${decision.decider.name}${decision.onBehalfOf ? `, substituindo ${decision.onBehalfOf.name}` : ""}`,
    actor: decision.decider.name,
    note: decision.note,
    noteLabel: "Observação",
  }));

  // Stable sort: on equal times, status events come first, then sector moves, assignments,
  // priorities, stages and the approval.
  // SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1: links and removals, on both requests.
  const linkEntries = linkEvents.map((event) => ({
    id: `link-${event.id}`,
    occurredAt: event.occurredAt,
    title: linkEventTitle(event),
    actor: event.actor.name,
    note: null,
  }));

  const tagEntries = tagEvents.map((event) => ({
    id: `tag-${event.id}`,
    occurredAt: event.occurredAt,
    title: tagEventTitle(event),
    actor: event.actorName,
    note: null,
  }));

  const checklistEntries = checklistEvents.map((event) => ({
    id: `checklist-${event.id}`,
    occurredAt: event.occurredAt,
    title: checklistEventTitle(event),
    actor: event.actorName,
    note: event.note,
    noteLabel: "Observação",
  }));

  const timeEntries = timeEvents.map((event) => ({
    id: `time-${event.id}`,
    occurredAt: event.occurredAt,
    title: timeEventTitle(event),
    actor: event.actorName,
    note: null,
  }));

  return [
    ...statusEntries,
    ...sectorEntries,
    ...assignmentEntries,
    ...priorityEntries,
    ...stageEntries,
    ...approvalEntries,
    ...documentEntries,
    ...pauseEntries,
    ...fieldEntries,
    ...linkEntries,
    ...tagEntries,
    ...checklistEntries,
    ...timeEntries,
  ].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
}

/** 4.3 item 3: "Item X concluído"; the one who did it is the entry's actor. */
export function checklistEventTitle(event: Pick<RequestChecklistEventView, "action" | "itemText">): string {
  return event.action === "DONE" ? `Item do checklist "${event.itemText}" concluído` : `Item do checklist "${event.itemText}" desmarcado`;
}

export function RequestTimeline({
  request,
  actorLabel,
  linkEvents = [],
  tagEvents = [],
  checklistEvents = [],
  timeEvents = [],
}: RequestTimelineProps) {
  const entries = buildTimeline(request, linkEvents, tagEvents, checklistEvents, timeEvents);

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
