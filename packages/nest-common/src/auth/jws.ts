import { sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { TOKEN_AUDIENCE, TOKEN_ISSUER } from '@wayfare/contracts';

/**
 * Compact EdDSA JWS (RFC 7515, RFC 8037) over `node:crypto` — the only JWT code in the system
 * (architecture §10, ADR 0043). identity signs; the gateway verifies with public keys only.
 */

/** Clock skew tolerated on `exp` and `iat`. */
export const JWS_LEEWAY_SECONDS = 30;

/** Why a token was refused. Never thrown — a bad token is data, not an error. */
export type JwsFailure = 'malformed' | 'unknown-key' | 'bad-signature' | 'expired' | 'claims';

/** The outcome of `verifyJws`. */
export type JwsResult =
  | { readonly ok: true; readonly claims: Record<string, unknown> }
  | { readonly ok: false; readonly reason: JwsFailure };

/** Claims the signer adds to every token. */
export interface RegisteredClaims {
  readonly iat: number;
  readonly exp: number;
}

const encode = (value: object): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

function decode(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) return undefined;
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Signs `claims` with `iss`, `aud`, `iat` and `exp` added. */
export function signJws(
  claims: Record<string, unknown>,
  options: { privateKey: KeyObject; keyId: string; ttlMs: number; now: Date },
): { token: string; expiresAt: Date } {
  const iat = Math.floor(options.now.getTime() / 1000);
  const exp = Math.floor((options.now.getTime() + options.ttlMs) / 1000);
  const header = encode({ alg: 'EdDSA', typ: 'JWT', kid: options.keyId });
  const payload = encode({ ...claims, iss: TOKEN_ISSUER, aud: TOKEN_AUDIENCE, iat, exp });
  const input = `${header}.${payload}`;
  const signature = sign(null, Buffer.from(input), options.privateKey).toString('base64url');
  return { token: `${input}.${signature}`, expiresAt: new Date(exp * 1000) };
}

/**
 * Verifies, in order: three segments; a parseable header with `alg: EdDSA` and a known `kid`; the
 * signature; then `iss`, `aud`, `exp` and `iat` (with leeway). The claims are only returned —
 * and should only be parsed further — after all of that holds.
 */
export function verifyJws(
  token: string,
  options: { publicKeys: ReadonlyMap<string, KeyObject>; now: Date },
): JwsResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];
  const header = decode(headerSegment);
  if (!isRecord(header) || header.alg !== 'EdDSA' || typeof header.kid !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  const key = options.publicKeys.get(header.kid);
  if (key === undefined) return { ok: false, reason: 'unknown-key' };
  if (!/^[A-Za-z0-9_-]+$/.test(signatureSegment)) return { ok: false, reason: 'malformed' };
  const input = Buffer.from(`${headerSegment}.${payloadSegment}`);
  let valid: boolean;
  try {
    valid = verify(null, input, key, Buffer.from(signatureSegment, 'base64url'));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad-signature' };
  const claims = decode(payloadSegment);
  if (!isRecord(claims)) return { ok: false, reason: 'malformed' };
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  if (claims.iss !== TOKEN_ISSUER || claims.aud !== TOKEN_AUDIENCE)
    return { ok: false, reason: 'claims' };
  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number')
    return { ok: false, reason: 'claims' };
  if (claims.exp + JWS_LEEWAY_SECONDS <= nowSeconds) return { ok: false, reason: 'expired' };
  if (claims.iat - JWS_LEEWAY_SECONDS > nowSeconds) return { ok: false, reason: 'claims' };
  return { ok: true, claims };
}
