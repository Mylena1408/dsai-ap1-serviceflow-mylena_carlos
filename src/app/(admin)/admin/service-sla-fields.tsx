import { PRIORITY_LABELS, PRIORITY_VALUES, type PriorityValue } from "@/app/_components/request-priority";

// Default priority and base SLA of a service (SPEC 2026-11-01-sla-prioridades, 5.1 and 5.2).
// The server validates both; the inputs only mirror the limits.
export function ServiceSlaFields({
  defaultPriority,
  slaHours,
  requiresApproval,
  slaBusinessHours = false,
  estimatedHours = null,
}: {
  defaultPriority: PriorityValue;
  slaHours: number | null;
  requiresApproval: boolean;
  slaBusinessHours?: boolean;
  /** SPEC 2026-11-08-atendimento-dia-a-dia, 13.2 item 1. */
  estimatedHours?: number | null;
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
      {/* SPEC 2026-11-03-pausa-sla-calendario, 5.2: only matters with a base SLA. */}
      <label>
        Contagem do prazo
        <select defaultValue={slaBusinessHours ? "business" : "calendar"} name="slaClock">
          <option value="calendar">Horas corridas</option>
          <option value="business">Horas úteis (calendário)</option>
        </select>
      </label>
      {/* SPEC 2026-11-08-atendimento-dia-a-dia, 13.2 item 1 (decision J4). */}
      <label>
        Estimativa de atendimento (horas)
        <input
          defaultValue={estimatedHours ?? ""}
          inputMode="numeric"
          max={200}
          min={1}
          name="estimatedHours"
          placeholder="Sem estimativa"
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
