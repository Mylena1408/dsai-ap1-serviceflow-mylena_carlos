"use client";

import { useActionState } from "react";
import { useAdminSection } from "./section-context";
import type { AdminUpdateState } from "./actions";
import { keepValuesOnSubmit } from "@/app/_components/keep-values-on-submit";

// Approval of a service (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.1, 4.3.6 and 4.3.7):
// up to three levels, each decided by the managers of a sector; the condition on a requester answer
// that requires the approval; and the days to decide each level.

type FormAction = (previousState: AdminUpdateState, formData: FormData) => Promise<AdminUpdateState>;

export type ApprovalConditionChoice = {
  fieldId: string;
  label: string;
  type: "SELECT" | "YES_NO" | "MULTI_SELECT";
  options: string[];
};

type ServiceApprovalEditorProps = {
  serviceId: string;
  serviceSectorId: string;
  /** Active sectors, by name. */
  sectors: Array<{ id: string; name: string }>;
  /** Active requester fields with choices and without their own condition. */
  conditionFields: ApprovalConditionChoice[];
  current: {
    sectorIds: string[];
    conditionFieldId: string | null;
    conditionValue: string | null;
    deadlineDays: number | null;
  };
  action: FormAction;
};

const LEVELS = [1, 2, 3] as const;
const initialState: AdminUpdateState = { status: "error", message: "" };

/** "Sim"/"Não" for yes or no; the option otherwise. */
function valueLabel(field: ApprovalConditionChoice, value: string): string {
  return field.type === "YES_NO" ? (value === "true" ? "Sim" : "Não") : value;
}

/** The sector names of the levels, for the summary. */
export function approvalSummary(
  sectorIds: readonly string[],
  serviceSectorId: string,
  sectors: ReadonlyArray<{ id: string; name: string }>,
  deadlineDays: number | null,
): string {
  const levels = sectorIds.length > 0 ? sectorIds : [serviceSectorId];
  const names = levels.map((id, index) => `${index + 1}. ${sectors.find((sector) => sector.id === id)?.name ?? "setor inativo"}`);
  const deadline = deadlineDays ? `; ${deadlineDays} ${deadlineDays === 1 ? "dia" : "dias"} para cada nível` : "; sem prazo";
  return `${names.join(" → ")}${deadline}`;
}

export function ServiceApprovalEditor({ serviceId, serviceSectorId, sectors, conditionFields, current, action }: ServiceApprovalEditorProps) {
  const section = useAdminSection();
  const [state, formAction, isPending] = useActionState(action, initialState);
  const levels = current.sectorIds.length > 0 ? current.sectorIds : [serviceSectorId];
  const currentCondition = current.conditionFieldId ? `${current.conditionFieldId}::${current.conditionValue ?? ""}` : "";

  return (
    <section className="requirements-panel" aria-label="Aprovação">
      <h3>Aprovação</h3>
      <p className="section-description">{approvalSummary(current.sectorIds, serviceSectorId, sectors, current.deadlineDays)}</p>
      <form action={formAction} onSubmit={keepValuesOnSubmit(formAction)} className="approval-editor-form">
        <input name="serviceId" type="hidden" value={serviceId} />
        <input name="serviceSectorId" type="hidden" value={serviceSectorId} />
        <input name="section" type="hidden" value={section} />
        <div className="editor-fields">
          {LEVELS.map((level) => (
            <label key={level}>
              {level === 1 ? "Nível 1 (obrigatório)" : `Nível ${level} (opcional)`}
              <select defaultValue={levels[level - 1] ?? ""} name={`level${level}`} required={level === 1}>
                {level === 1 ? null : <option value="">Sem este nível</option>}
                {sectors.map((sector) => (
                  <option key={sector.id} value={sector.id}>
                    {sector.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="wide-field">
            Exigir aprovação só quando
            <select defaultValue={currentCondition} name="condition">
              <option value="">Sempre exigir</option>
              {conditionFields.flatMap((field) =>
                (field.type === "YES_NO" ? ["true", "false"] : field.options).map((value) => (
                  <option key={`${field.fieldId}::${value}`} value={`${field.fieldId}::${value}`}>
                    {field.label} {field.type === "MULTI_SELECT" ? "contém" : "="} {valueLabel(field, value)}
                  </option>
                )),
              )}
            </select>
          </label>
          <label>
            Prazo para decidir cada nível (dias)
            <input defaultValue={current.deadlineDays ?? ""} max={30} min={1} name="deadlineDays" step={1} type="number" />
          </label>
        </div>
        {state.status === "error" && state.message ? (
          <p className="feedback feedback-error editor-feedback" role="alert">
            {state.message}
          </p>
        ) : null}
        {state.status === "success" && state.message ? (
          <p className="feedback editor-feedback" role="status">
            {state.message}
          </p>
        ) : null}
        <div className="editor-actions">
          <button className="editor-save-button" disabled={isPending} type="submit">
            {isPending ? "Salvando..." : "Salvar aprovação"}
          </button>
        </div>
      </form>
    </section>
  );
}
