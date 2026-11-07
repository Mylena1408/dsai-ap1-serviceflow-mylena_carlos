import type { Prisma } from "@prisma/client";

/**
 * A decimal limit read from the database as text with the field's places ("10.50"), or null
 * (SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1). The column has 4 places; the
 * constraint guarantees the extra ones are zeros, so `toFixed` does not round anything.
 */
export function decimalLimitText(value: Prisma.Decimal | null, places: number | null): string | null {
  return value === null ? null : value.toFixed(places ?? 4);
}
