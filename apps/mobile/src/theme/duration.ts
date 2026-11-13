/** A token's length in milliseconds, or 0 when the system removes animations. */
export function durationFor<T extends string>(
  durations: Readonly<Record<T, number>>,
  token: T,
  reduced: boolean,
): number {
  return reduced ? 0 : durations[token];
}
