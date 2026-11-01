import { PRIORITY_LABELS, PRIORITY_VALUES, type PriorityValue } from "@/app/_components/request-priority";
import { changePriorityAction } from "../actions";

// SPEC 2026-11-01-sla-prioridades, section 5.1 (decision P1): the attendant of the sector
// changes the priority; the server checks the rules and recalculates the due date.
export function PriorityForm({ requestId, priority }: { requestId: string; priority: PriorityValue }) {
  return (
    <form action={changePriorityAction} className="surface-card content-section priority-form">
      <input type="hidden" name="requestId" value={requestId} />
      <label htmlFor="request-priority">Prioridade (atual: {PRIORITY_LABELS[priority]})</label>
      <select id="request-priority" name="priority" defaultValue={priority}>
        {PRIORITY_VALUES.map((value) => (
          <option key={value} value={value}>
            {PRIORITY_LABELS[value]}
          </option>
        ))}
      </select>
      <button className="button-secondary" type="submit">Alterar prioridade</button>
    </form>
  );
}
