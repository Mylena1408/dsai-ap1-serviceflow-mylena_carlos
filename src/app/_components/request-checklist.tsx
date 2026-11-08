import type { RequestChecklistItemView } from "@/modules/checklists";

// A request's checklist on the team's screens (SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 and 13.1).

/** 4.3 item 4 (decision I8): the refused completion lists what is missing, as read now. */
export function checklistPendingText(pending: ReadonlyArray<Pick<RequestChecklistItemView, "textSnapshot">>): string | null {
  return pending.length === 0 ? null : `Falta marcar: ${pending.map(({ textSnapshot }) => `"${textSnapshot}"`).join(", ")}.`;
}
