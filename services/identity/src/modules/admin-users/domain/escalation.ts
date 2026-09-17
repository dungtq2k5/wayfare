import { compareStrings } from '@wayfare/contracts';

/**
 * The codes a change adds that the actor does not hold — `after − before − actor`, sorted
 * (api-endpoints-plan §1.6, no escalation). Every set is read from the database, never a token.
 */
export function addedCodesActorLacks(input: {
  readonly actorCodes: readonly string[];
  readonly before: readonly string[];
  readonly after: readonly string[];
}): string[] {
  const held = new Set([...input.before, ...input.actorCodes]);
  return [...new Set(input.after)].filter((code) => !held.has(code)).toSorted(compareStrings);
}

/**
 * The target's codes the actor does not hold — `target − actor`, sorted. Non-empty means the
 * actor may not act on the target (api-endpoints-plan §1.6, no acting above your own level).
 */
export function targetCodesActorLacks(input: {
  readonly actorCodes: readonly string[];
  readonly targetCodes: readonly string[];
}): string[] {
  const held = new Set(input.actorCodes);
  return [...new Set(input.targetCodes)].filter((code) => !held.has(code)).toSorted(compareStrings);
}
