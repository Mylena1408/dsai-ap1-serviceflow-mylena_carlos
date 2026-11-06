// Geometry of the server-rendered SVG charts (SPEC 2026-11-06-analises-operacionais, 5.7): pure
// functions, so scales, bars, lines with gaps and axis labels are unit-tested without a browser.
// Mark specs follow the data-viz method: bars at most 24 px with a 4 px rounded data end and a
// 2 px gap between neighbours, 2 px lines, markers of radius 4 with a 2 px surface ring.

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 220;
export const CHART_MARGIN = { top: 14, right: 12, bottom: 30, left: 40 } as const;
export const MAX_BAR_WIDTH = 24;
export const BAR_GAP = 2;
export const BAR_RADIUS = 4;

export const PLOT = {
  left: CHART_MARGIN.left,
  top: CHART_MARGIN.top,
  width: CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right,
  height: CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom,
  bottom: CHART_HEIGHT - CHART_MARGIN.bottom,
} as const;

/**
 * Upper bound of a count axis with four whole steps: the step is 1, 2 or 5 times a power of
 * ten, so the ticks are clean whole numbers (0, 2, 4, 6, 8 — never 2.5 for a count).
 */
export function niceMax(largest: number): number {
  if (largest <= 4) return 4;
  const raw = largest / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const multiple of [1, 2, 5, 10]) {
    const step = multiple * power;
    if (step >= raw && Number.isInteger(step)) return step * 4;
  }
  return 10 * power * 4;
}

/** Four equal steps from 0 to the axis maximum, as whole numbers when they divide evenly. */
export function axisTicks(max: number): number[] {
  return [0, 1, 2, 3, 4].map((index) => Math.round(((max * index) / 4) * 100) / 100);
}

export function yOf(value: number, max: number): number {
  return PLOT.bottom - (max <= 0 ? 0 : (value / max) * PLOT.height);
}

/** Center of band `index` among `count` equal bands across the plot. */
export function bandCenter(index: number, count: number): number {
  const band = PLOT.width / Math.max(count, 1);
  return PLOT.left + band * index + band / 2;
}

export function bandWidth(count: number): number {
  return PLOT.width / Math.max(count, 1);
}

/** Width of each of `perBand` bars in a band: capped at 24 px, leaving air in the band. */
export function barWidth(count: number, perBand: number): number {
  const available = bandWidth(count) * 0.8 - BAR_GAP * (perBand - 1);
  return Math.max(1, Math.min(MAX_BAR_WIDTH, available / perBand));
}

/**
 * Path of a column from the baseline, square at the bottom and with a rounded data end. A zero
 * value draws nothing (empty path), so nothing pretends to be a value.
 */
export function columnPath(x: number, width: number, value: number, max: number): string {
  if (value <= 0 || max <= 0) return "";
  const top = yOf(value, max);
  const height = PLOT.bottom - top;
  const radius = Math.min(BAR_RADIUS, width / 2, height);
  const right = x + width;
  return [
    `M${round(x)},${round(PLOT.bottom)}`,
    `V${round(top + radius)}`,
    `Q${round(x)},${round(top)} ${round(x + radius)},${round(top)}`,
    `H${round(right - radius)}`,
    `Q${round(right)},${round(top)} ${round(right)},${round(top + radius)}`,
    `V${round(PLOT.bottom)}`,
    "Z",
  ].join(" ");
}

export interface LinePoint {
  x: number;
  y: number;
  value: number;
  index: number;
}

/**
 * Points of a line, split into runs at empty values: a missing value is a gap in the line,
 * never a zero (an interval with nothing completed has no on-time share).
 */
export function lineRuns(values: ReadonlyArray<number | null>, max: number): LinePoint[][] {
  const runs: LinePoint[][] = [];
  let current: LinePoint[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }
    current.push({ x: bandCenter(index, values.length), y: yOf(value, max), value, index });
  });
  if (current.length > 0) runs.push(current);
  return runs;
}

export function linePath(run: readonly LinePoint[]): string {
  return run.map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)},${round(point.y)}`).join(" ");
}

/**
 * Indexes of the x-axis labels to print: evenly spaced so they never collide (about 56 px per
 * label), always including the first and the last.
 */
export function labelIndexes(count: number, minSpacing = 56): number[] {
  if (count <= 0) return [];
  const fit = Math.max(1, Math.floor(PLOT.width / minSpacing));
  if (count <= fit) return Array.from({ length: count }, (_, index) => index);
  const step = Math.ceil((count - 1) / (fit - 1));
  const indexes: number[] = [];
  for (let index = 0; index < count - 1; index += step) indexes.push(index);
  // Keep the last label, dropping the previous one when they would touch.
  if (indexes.length > 0 && count - 1 - indexes[indexes.length - 1]! < step / 2) indexes.pop();
  indexes.push(count - 1);
  return indexes;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
