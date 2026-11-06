import type { RequestEscalationRecord } from "@/modules/requests";
import { PRIORITY_LABELS } from "@/shared/requests";

// Escalations of an overdue request (SPEC 2026-11-06-escalonamento, 4.7): shown to the sector's
// team and to a manager who reads the request; the requester never sees this block.

export function RequestEscalations({ escalations }: { escalations: readonly RequestEscalationRecord[] }) {
  if (escalations.length === 0) return null;
  return (
    <section className="surface-card content-section" aria-labelledby="escalations-heading">
      <h2 id="escalations-heading">Escalonamentos</h2>
      <ul className="content-list">
        {escalations.map((escalation) => (
          <li key={escalation.occurredAt.toISOString()}>
            Vencida e escalada automaticamente em{" "}
            {escalation.occurredAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
            {" · "}
            {escalation.fromPriority === escalation.toPriority
              ? `prioridade mantida em ${PRIORITY_LABELS[escalation.toPriority]}`
              : `prioridade ${PRIORITY_LABELS[escalation.fromPriority]} → ${PRIORITY_LABELS[escalation.toPriority]}`}
            . Os gestores do setor foram avisados.
          </li>
        ))}
      </ul>
    </section>
  );
}
