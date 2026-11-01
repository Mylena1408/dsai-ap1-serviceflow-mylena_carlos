import { PRIORITY_LABELS, PRIORITY_VALUES, type PriorityValue } from "@/app/_components/request-priority";

// Default priority and base SLA of a service (SPEC 2026-11-01-sla-prioridades, 5.1 and 5.2).
// The server validates both; the inputs only mirror the limits.
export function ServiceSlaFields({
  defaultPriority,
  slaHours,
  requiresApproval,
}: {
  defaultPriority: PriorityValue;
  slaHours: number | null;
  requiresApproval: boolean;
}) {
  return (
    <>
      <label>
        Prioridade padrão
        <select defaultValue={defaultPriority} name="defaultPriority" required>
          {PRIORITY_VALUES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prazo-base (horas)
        <input
          defaultValue={slaHours ?? ""}
          inputMode="numeric"
          max={2000}
          min={1}
          name="slaHours"
          placeholder="Sem prazo"
          step={1}
          type="number"
        />
      </label>
      {/* SPEC 2026-11-01-aprovacoes, 5.2: the marker tells the server the form has the checkbox. */}
      <input name="requiresApprovalField" type="hidden" value="1" />
      <label className="checkbox-field">
        <input defaultChecked={requiresApproval} name="requiresApproval" type="checkbox" />
        Exige aprovação do gestor
      </label>
    </>
  );
}
