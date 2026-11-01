import { ConflictError } from "@/server/errors";

// Display order of items configured per service ("Subir"/"Descer"), shared by document
// requirements (SPEC 21.2) and custom fields (SPEC 2026-11-01-campos-personalizados, 5.1).

export type PositionMoveDirection = "up" | "down";

export interface PositionedItem {
  id: string;
  position: number;
}

export function compareByPosition(left: PositionedItem, right: PositionedItem): number {
  return left.position - right.position || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export function nextPosition(existing: readonly PositionedItem[]): number {
  return existing.reduce((highest, item) => Math.max(highest, item.position + 1), 0);
}

// Plans a move among the active items of one service. Returns only the position updates to
// apply; an empty list means the move has no effect (first moved up, last moved down).
// Active positions are renumbered from 0 so ties cannot persist.
export function planPositionMove(
  activeItems: readonly PositionedItem[],
  itemId: string,
  direction: PositionMoveDirection,
): PositionedItem[] {
  const ordered = [...activeItems].sort(compareByPosition);
  const index = ordered.findIndex((item) => item.id === itemId);

  if (index === -1) {
    throw new ConflictError();
  }

  const neighbourIndex = direction === "up" ? index - 1 : index + 1;

  if (neighbourIndex < 0 || neighbourIndex >= ordered.length) {
    return [];
  }

  [ordered[index], ordered[neighbourIndex]] = [ordered[neighbourIndex], ordered[index]];

  return ordered
    .map((item, position) => ({ id: item.id, position }))
    .filter(({ id, position }) => activeItems.find((item) => item.id === id)?.position !== position);
}
