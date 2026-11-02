// Labels of the priorities (SPEC 2026-11-01-sla-prioridades, section 5.1). No server imports,
// so client components can use it too.

import type { PriorityValue } from "@/shared/requests";

export { PRIORITY_LABELS } from "@/shared/requests";
export type { PriorityValue } from "@/shared/requests";

export const PRIORITY_VALUES: readonly PriorityValue[] = ["URGENT", "HIGH", "NORMAL", "LOW"];
