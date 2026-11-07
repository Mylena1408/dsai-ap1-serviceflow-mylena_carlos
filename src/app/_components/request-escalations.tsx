import type { RequestEscalationRecord } from "@/modules/requests";
import { PRIORITY_LABELS } from "@/shared/requests";

// Escalations of an overdue request (SPEC 2026-11-06-escalonamento, 4.7): shown to the sector's
// team and to a manager who reads the request; the requester never sees this block. The rules'
// escalations show the trigger and what was done (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 item 5).

function priorityText(escalation: RequestEscalationRecord): string {
  return escalation.fromPriority === escalation.toPriority
    ? `prioridade mantida em ${PRIORITY_LABELS[escalation.toPriority]}`
    : `prioridade ${PRIORITY_LABELS[escalation.fromPriority]} → ${PRIORITY_LABELS[escalation.toPriority]}`;
}

/** "Regra "Atraso" (vencida há 3 dias): prioridade Normal → Alta · atribuída a Bia · 2 pessoas avisadas." */
export function ruleEscalationText(escalation: RequestEscalationRecord): string {
  const trigger =
    escalation.trigger === "DUE_SOON"
      ? "próxima do vencimento"
      : escalation.overdueDays === 1
        ? "vencida há 1 dia"
        : `vencida há ${escalation.overdueDays} dias`;
  const parts = [escalation.fromPriority === escalation.toPriority ? null : priorityText(escalation)];
  if (escalation.assignedTo) parts.push(`atribuída a ${escalation.assignedTo.name}`);
  if (escalation.assignmentSkipped) parts.push("atribuição ignorada (atendente indisponível)");
  const warned = escalation.notifiedCount ?? 0;
  if (warned > 0) parts.push(warned === 1 ? "1 pessoa avisada" : `${warned} pessoas avisadas`);
  const done = parts.filter((part): part is string => part !== null);
  return `Regra "${escalation.ruleName}" (${trigger}): ${done.length > 0 ? done.join(" · ") : "nada a fazer"}.`;
}

function when(escalation: RequestEscalationRecord): string {
  return escalation.occurredAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export function RequestEscalations({ escalations }: { escalations: readonly RequestEscalationRecord[] }) {
  if (escalations.length === 0) return null;
  return (
    <section className="surface-card content-section" aria-labelledby="escalations-heading">
      <h2 id="escalations-heading">Escalonamentos</h2>
      <ul className="content-list">
        {escalations.map((escalation) =>
          escalation.trigger && escalation.trigger !== "OVERDUE" ? (
            <li key={escalation.id ?? escalation.occurredAt.toISOString()}>
              Em {when(escalation)} · {ruleEscalationText(escalation)}
            </li>
          ) : (
            <li key={escalation.id ?? escalation.occurredAt.toISOString()}>
              Vencida e escalada automaticamente em {when(escalation)}
              {" · "}
              {priorityText(escalation)}. Os gestores do setor foram avisados.
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
