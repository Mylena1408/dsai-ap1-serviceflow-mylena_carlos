import { slaSituation, type RequestWithHistory, type SlaSituation } from "@/modules/requests";
import { PRIORITY_LABELS } from "./request-priority";

// Priority, due date and SLA situation of a request (SPEC 2026-11-01-sla-prioridades,
// sections 5.4 and 5.6). The situation is computed when displayed, so it is always exact.

export const SLA_SITUATION_LABELS: Record<SlaSituation, string> = {
  none: "Sem prazo",
  on_time: "Dentro do prazo",
  due_soon: "Próximo do vencimento",
  overdue: "Vencido",
  completed_on_time: "Concluída no prazo",
  completed_late: "Concluída com atraso",
};

type SlaRequest = Pick<
  RequestWithHistory,
  "status" | "priority" | "slaHoursSnapshot" | "dueAt" | "completedLate"
>;

export interface SlaSummary {
  priority: string;
  situation: SlaSituation;
  situationLabel: string;
  /** Shown only while the deadline is running. */
  dueAt: Date | null;
}

export function slaSummary(request: SlaRequest, now: Date): SlaSummary {
  const situation = slaSituation(request, now);
  const running = situation === "on_time" || situation === "due_soon" || situation === "overdue";

  return {
    priority: PRIORITY_LABELS[request.priority],
    situation,
    situationLabel: SLA_SITUATION_LABELS[situation],
    dueAt: running ? request.dueAt : null,
  };
}

type RequestSlaProps = {
  request: SlaRequest;
  now: Date;
};

export function RequestSla({ request, now }: RequestSlaProps) {
  const summary = slaSummary(request, now);

  return (
    <p className="sla-line">
      <span className="priority-pill">Prioridade: {summary.priority}</span>
      <span className={`sla-pill sla-${summary.situation.replaceAll("_", "-")}`}>{summary.situationLabel}</span>
      {summary.dueAt ? (
        <span className="metadata">
          Vence em{" "}
          <time dateTime={summary.dueAt.toISOString()}>{summary.dueAt.toLocaleString("pt-BR")}</time>
        </span>
      ) : null}
    </p>
  );
}
