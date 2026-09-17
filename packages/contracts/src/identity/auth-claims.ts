import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { TOKEN_TYPES } from './limits';

/** The token issuer (ADR 0043). */
export const TOKEN_ISSUER = 'wayfare-identity';

/** The token audience. */
export const TOKEN_AUDIENCE = 'wayfare-gateway';

/**
 * A permission code's shape (conventions §15). Tokens carry codes by pattern, not by membership of
 * `PERMISSION_CODES`: a newer identity's new code must not invalidate a token at an older gateway.
 */
const zPermissionCodeShape = z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/);

const registered = {
  iss: z.literal(TOKEN_ISSUER),
  aud: z.literal(TOKEN_AUDIENCE),
  sub: zUuidV7,
  iat: z.number().int().min(0),
  exp: z.number().int().min(0),
};

/** A device access token's claims (api-endpoints-plan §0.1). */
export const zDeviceClaims = z
  .object({ ...registered, typ: z.literal(TOKEN_TYPES.device) })
  .strict();
/** A verified device token's claims. */
export type DeviceClaims = z.output<typeof zDeviceClaims>;

/** An account access token's claims (api-endpoints-plan §0.1). */
export const zAccountClaims = z
  .object({
    ...registered,
    typ: z.literal(TOKEN_TYPES.user),
    /** Issue time in milliseconds — compared with `tokens_valid_after`. */
    iatMs: z.number().int().min(0),
    /** The session family. */
    sid: zUuidV7,
    /** The device claimed at sign-in, if any. */
    did: zUuidV7.optional(),
    perms: z.array(zPermissionCodeShape).max(500),
    /** ownerVerified */
    ov: z.boolean(),
    /** emailVerified */
    ev: z.boolean(),
  })
  .strict();
/** A verified account token's claims. */
export type AccountClaims = z.output<typeof zAccountClaims>;
