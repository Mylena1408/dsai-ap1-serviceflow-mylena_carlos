import type { RequestWithHistory } from "@/modules/requests";
import { RequestStageSteps, stageSummary } from "@/app/_components/request-stage";
import { advanceStageAction, returnStageAction } from "../actions";

// Attendant controls of the flow (SPEC 2026-11-01-fluxos-configuraveis, 5.3 and 5.6): advance
// one stage, go back one stage with a reason. Both forms carry the stage shown on the page.
export function StagePanel({ request, canAct }: { request: RequestWithHistory; canAct: boolean }) {
  const summary = stageSummary(request);

  if (!summary || request.stageIndex === null) {
    return null;
  }

  const names = request.stageNamesSnapshot;
  const index = request.stageIndex;
  const next = names[index + 1];
  const previous = names[index - 1];
  const active = request.status === "IN_PROGRESS" && canAct;

  return (
    <section className="surface-card content-section" aria-labelledby="stage-heading">
      <p className="eyebrow">Fluxo de atendimento</p>
      <h2 id="stage-heading">{summary}</h2>
      <RequestStageSteps request={request} />
      {active && next ? (
        <form action={advanceStageAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <input type="hidden" name="fromStageIndex" value={index} />
          <button type="submit">Avançar para {next}</button>
        </form>
      ) : null}
      {active && !next ? <p>Esta é a última etapa: a solicitação já pode ser concluída.</p> : null}
      {active && previous ? (
        <details className="lifecycle-form">
          <summary>Voltar para {previous}</summary>
          <form action={returnStageAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="fromStageIndex" value={index} />
            <label htmlFor="stage-note">Justificativa (obrigatória)</label>
            <textarea id="stage-note" name="note" required maxLength={1_000} rows={3} />
            <button className="button-secondary" type="submit">Confirmar retorno para {previous}</button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
