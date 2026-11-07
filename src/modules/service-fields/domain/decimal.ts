// Decimal numbers of custom fields (SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1).
// Values are handled as text and scaled integers (BigInt), never as floating point, so "0.1"
// stays exact and limits compare without rounding.

/** The most decimal places a field may have; limits are stored with this scale. */
export const MAX_DECIMAL_PLACES = 4;
export const MIN_DECIMAL_PLACES = 1;

/** Integer digits allowed: the bound is ±1,000,000,000 (10 digits). */
const DECIMAL_PATTERN = /^(-?)(\d{1,10})(?:[.,](\d+))?$/;

// BigInt() calls instead of literals: the TypeScript target is below ES2020.
const ZERO = BigInt(0);
const SCALE = BigInt(10 ** MAX_DECIMAL_PLACES);
const BOUND = BigInt(1_000_000_000) * SCALE;

export interface ParsedDecimal {
  /** The value multiplied by 10^4. */
  scaled: bigint;
  /** Decimal places written (0 when there is no separator). */
  places: number;
}

/**
 * Reads "1234,5", "-0.25" or "10". Refuses thousands separators, exponents, spaces, a separator
 * without digits after it and more than 4 places. Does not check the field's limits.
 */
export function parseDecimal(text: string): ParsedDecimal | null {
  const match = DECIMAL_PATTERN.exec(text);

  if (!match) {
    return null;
  }

  const [, sign, integer, fraction = ""] = match;

  if (fraction.length > MAX_DECIMAL_PLACES) {
    return { scaled: ZERO, places: fraction.length };
  }

  const magnitude = BigInt(integer) * SCALE + BigInt(fraction.padEnd(MAX_DECIMAL_PLACES, "0"));

  return { scaled: sign === "-" ? -magnitude : magnitude, places: fraction.length };
}

/** Within ±1,000,000,000 (3.3.1). */
export function decimalWithinBound(scaled: bigint): boolean {
  return scaled >= -BOUND && scaled <= BOUND;
}

/** The value with exactly `places` decimals and a dot: 1234.5 with 2 places is "1234.50". */
export function formatScaledDecimal(scaled: bigint, places: number): string {
  const negative = scaled < ZERO;
  const magnitude = negative ? -scaled : scaled;
  const integer = magnitude / SCALE;
  const fraction = (magnitude % SCALE).toString().padStart(MAX_DECIMAL_PLACES, "0").slice(0, places);
  // "-0.00" is not a value anyone typed meaningfully; it is stored as zero.
  const sign = negative && magnitude !== ZERO ? "-" : "";

  return places > 0 ? `${sign}${integer}.${fraction}` : `${sign}${integer}`;
}

/** Brazilian display: "1234.50" becomes "1.234,50". Any other text is returned unchanged. */
export function formatDecimalForDisplay(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);

  if (!match) {
    return value;
  }

  const [, sign, integer, fraction] = match;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return fraction === undefined ? `${sign}${grouped}` : `${sign}${grouped},${fraction}`;
}
