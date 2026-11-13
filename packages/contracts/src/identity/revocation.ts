import { SessionRevokedReason } from './enums';

/**
 * Why an account's tokens were cut off — `identity.session.revoked`'s `reason` (api-endpoints-plan
 * §10). Every `SessionRevokedReason`, plus `PERMISSIONS_CHANGED`: a cutoff bump after a role
 * change, which revokes no session, so it is never a `sessions.revoked_reason` value.
 */
export const TokenRevocationReason = {
  ...SessionRevokedReason,
  PERMISSIONS_CHANGED: 'PERMISSIONS_CHANGED',
} as const;

/** A `TokenRevocationReason` value. */
export type TokenRevocationReason =
  (typeof TokenRevocationReason)[keyof typeof TokenRevocationReason];

/** Every `TokenRevocationReason` value. */
export const TOKEN_REVOCATION_REASONS: readonly TokenRevocationReason[] =
  Object.values(TokenRevocationReason);
