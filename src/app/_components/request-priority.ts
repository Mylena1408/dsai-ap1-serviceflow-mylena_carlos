// Labels of the priorities (SPEC 2026-11-01-sla-prioridades, section 5.1). No server imports,
// so client components can use it too.

export type PriorityValue = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export const PRIORITY_VALUES: readonly PriorityValue[] = ["URGENT", "HIGH", "NORMAL", "LOW"];

export const PRIORITY_LABELS: Record<PriorityValue, string> = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
};
