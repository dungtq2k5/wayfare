import { REFRESH_RACE_GRACE_MS, SessionClient } from '@wayfare/contracts';

/** The session row a presented refresh token found. */
export interface RefreshRow {
  readonly client: SessionClient;
  readonly expiresAt: Date;
  readonly rotatedAt: Date | null;
  readonly revokedAt: Date | null;
}

/** What to do with a refresh (rdm-spec I-3, api-endpoints-plan §1.2). */
export type RefreshDecision = 'UNKNOWN' | 'REVOKED' | 'EXPIRED' | 'RACE' | 'REPLAY' | 'ROTATE';

/** The clients whose tabs share one cookie jar — the only ones that can lose a refresh race. */
const COOKIE_CLIENTS: ReadonlySet<SessionClient> = new Set([
  SessionClient.CONSOLE,
  SessionClient.WEB,
]);

/**
 * Decides a refresh from the row its token found:
 *
 * - no row → `UNKNOWN`; revoked → `REVOKED`; expired → `EXPIRED`;
 * - already rotated less than `REFRESH_RACE_GRACE_MS` ago, by a cookie client, presented by the
 *   same client → `RACE` (a second tab; nothing is revoked);
 * - already rotated otherwise → `REPLAY` (two parties hold the token; the family dies);
 * - live → `ROTATE`.
 */
export function decideRefresh(
  row: RefreshRow | null,
  client: SessionClient,
  now: Date,
): RefreshDecision {
  if (row === null) return 'UNKNOWN';
  if (row.revokedAt !== null) return 'REVOKED';
  if (row.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (row.rotatedAt === null) return 'ROTATE';
  const sinceRotation = now.getTime() - row.rotatedAt.getTime();
  const lostRace =
    sinceRotation < REFRESH_RACE_GRACE_MS &&
    COOKIE_CLIENTS.has(row.client) &&
    row.client === client;
  return lostRace ? 'RACE' : 'REPLAY';
}
