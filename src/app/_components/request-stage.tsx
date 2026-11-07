import type { RequestWithHistory } from "@/modules/requests";

// Stage of the attendance flow on screens (SPEC 2026-11-01-fluxos-configuraveis, 5.6).

type StageFields = Pick<RequestWithHistory, "stageNamesSnapshot" | "stageIndex"> & Partial<Pick<RequestWithHistory, "stageDueAt" | "status">>;

/**
 * SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.2: the current stage passed its target, at
 * reading time, while the request is in the attendance.
 */
export function stageOverdue(request: StageFields, now: Date = new Date()): boolean {
  return (
    request.status === "IN_PROGRESS" &&
    request.stageIndex !== null &&
    !!request.stageDueAt &&
    request.stageDueAt.getTime() <= now.getTime()
  );
}

/** "Etapa 2 de 4: Execução", or null for a request without a flow. */
export function stageSummary(request: StageFields): string | null {
  const { stageNamesSnapshot: names, stageIndex } = request;

  if (stageIndex === null || names.length === 0) {
    return null;
  }

  return `Etapa ${stageIndex + 1} de ${names.length}: ${names[stageIndex]}`;
}

/** Current stage next to the status, in lists and details; the team also sees the delay (5.3.2). */
export function RequestStageLabel({ request, showDelay = false }: { request: StageFields; showDelay?: boolean }) {
  const summary = stageSummary(request);
  if (!summary) return null;
  return (
    <>
      <span className="stage-pill">{summary}</span>
      {showDelay && stageOverdue(request) ? <span className="approval-pill approval-overdue">Etapa atrasada</span> : null}
    </>
  );
}

/** The flow copy with the stages already passed, the current one and the next ones. */
export function RequestStageSteps({ request }: { request: StageFields }) {
  const { stageNamesSnapshot: names, stageIndex } = request;

  if (stageIndex === null || names.length === 0) {
    return null;
  }

  return (
    <ol className="stage-steps" aria-label="Etapas do atendimento">
      {names.map((name, index) => {
        const state = index < stageIndex ? "done" : index === stageIndex ? "current" : "next";
        const suffix = state === "done" ? " (concluída)" : state === "current" ? " (atual)" : "";
        return (
          <li className={`stage-step stage-step-${state}`} aria-current={state === "current" ? "step" : undefined} key={name}>
            {name}
            {suffix}
          </li>
        );
      })}
    </ol>
  );
}
