import { ValidationError } from "@/server/errors";

// Mentions in internal notes (SPEC 2026-11-08-atendimento-dia-a-dia, part E and 13.4; decisions I15 and I16, and the
// correction of 2026-11-09): an attendant writing an internal note chooses up to 5 colleagues among the active
// attendants of the request's sector; they are kept by id, never parsed from the text. Only the people who read
// internal notes (the sector's attendants) are mentioned; managers neither mention nor are mentioned.

export const MAX_MENTIONS = 5;

/**
 * 7.3 item 1: the people to mention, without repeats and without the author (who is never notified of their own
 * note). A mention outside an internal note, of someone who is not an active attendant of the sector, or more than 5
 * is refused.
 */
export function planMentions(
  mentionIds: readonly string[],
  context: { authorId: string; isInternal: boolean; mentionableIds: ReadonlySet<string> },
): string[] {
  const unique = [...new Set(mentionIds)].filter((id) => id !== context.authorId);
  if (unique.length === 0) return [];
  if (!context.isInternal) throw new ValidationError([{ path: ["mentionIds"], code: "invalid_value" }]);
  if (unique.length > MAX_MENTIONS) throw new ValidationError([{ path: ["mentionIds"], code: "too_big" }]);
  if (unique.some((id) => !context.mentionableIds.has(id))) throw new ValidationError([{ path: ["mentionIds"], code: "invalid_value" }]);
  return unique;
}

/** 7.3 item 3: "Menciona: Fulano, Beltrana". */
export function mentionLine(names: readonly string[]): string | null {
  return names.length === 0 ? null : `Menciona: ${names.join(", ")}`;
}
