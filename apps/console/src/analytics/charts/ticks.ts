/**
 * A chart's four Y ticks from zero, at a nice step (1, 2, 2.5, 4 or 5 × 10ⁿ) whose third tick reaches
 * the tallest bar: 118 → 0, 40, 80, 120.
 */
export function niceTicks(max: number): [number, number, number, number] {
  const rough = Math.max(max, 1) / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 4, 5, 10].map((m) => m * power).find((candidate) => candidate >= rough)!;
  const nice = step < 1 ? 1 : step;
  return [0, nice, nice * 2, nice * 3];
}

/** About five X ticks, evenly spread, the first and the last always among them. */
export function tickIndexes(count: number): number[] {
  if (count <= 5) return Array.from({ length: count }, (_, index) => index);
  return [...new Set([0, 1, 2, 3, 4].map((i) => Math.round((i * (count - 1)) / 4)))];
}
