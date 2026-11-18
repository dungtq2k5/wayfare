// SABOTAGE — never merged. New code in packages/core with no test, so SonarCloud's gate goes red on
// the new code's coverage (the Sonar CI batch's Q6). The pull request is closed unmerged.

/** A ranking bonus for a Place close by on foot: none past 600 m, more the closer it is. */
export function walkingBonus(distanceM: number, isOpenNow: boolean): number {
  if (distanceM < 0) throw new RangeError('distance must be positive');
  if (distanceM > 600) return 0;
  const closeness = 1 - distanceM / 600;
  if (!isOpenNow) return Math.round(closeness * 5);
  if (distanceM < 100) return 20;
  return Math.round(closeness * 15);
}
