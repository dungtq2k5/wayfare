import { createSign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/** What Wayfare reads from a verified Google ID token — nothing else is read or kept (ADR 0062). */
export interface GoogleClaims {
  readonly sub: string;
  readonly email: string;
  readonly name: string | null;
  /** The Workspace domain, when the account belongs to one. */
  readonly hd: string | null;
  readonly nonce: string | null;
}

/** Why a token was refused (`INVALID_GOOGLE_TOKEN`'s `details.reason`, the nonce aside). */
export type IdTokenRejection = 'INVALID' | 'EMAIL_NOT_VERIFIED';

export type IdTokenCheck =
  | { readonly ok: true; readonly claims: GoogleClaims }
  | { readonly ok: false; readonly reason: IdTokenRejection };

/** The issuers Google signs as. */
export const GOOGLE_ISSUERS: readonly string[] = [
  'accounts.google.com',
  'https://accounts.google.com',
];

/** The fake issuer's key id: one key, so one id. */
export const FAKE_GOOGLE_KEY_ID = 'wayfare-fake-google';

/** Clock skew allowed on `exp`. */
const SKEW_MS = 60_000;

const decode = (segment: string): unknown => {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The key id an ID token names, to fetch its key; null when the token is no RS256 JWS. */
export function idTokenKeyId(token: string): string | null {
  const header = decode(token.split('.')[0] ?? '');
  return isRecord(header) && header.alg === 'RS256' && typeof header.kid === 'string'
    ? header.kid
    : null;
}

/**
 * Checks an ID token against its key and Google's rules (ADR 0062): the RS256 signature, `iss`,
 * `aud` (the server client id), `exp` with a minute's skew, a subject and an address, and
 * `email_verified`. The nonce is the caller's to check — it is bound to a device, not to the token.
 */
export function checkIdToken(
  token: string,
  key: KeyObject | undefined,
  options: { readonly audience: string; readonly now: Date },
): IdTokenCheck {
  const invalid = { ok: false, reason: 'INVALID' } as const;
  const parts = token.split('.');
  if (parts.length !== 3 || key === undefined) return invalid;
  const [header, payload, signature] = parts as [string, string, string];
  const signed = verify(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    key,
    Buffer.from(signature, 'base64url'),
  );
  const claims = decode(payload);
  if (!signed || !isRecord(claims)) return invalid;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    typeof claims.iss !== 'string' ||
    !GOOGLE_ISSUERS.includes(claims.iss) ||
    !audience.includes(options.audience) ||
    typeof claims.exp !== 'number' ||
    claims.exp * 1000 + SKEW_MS <= options.now.getTime() ||
    typeof claims.sub !== 'string' ||
    claims.sub === '' ||
    typeof claims.email !== 'string' ||
    claims.email === ''
  ) {
    return invalid;
  }
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    return { ok: false, reason: 'EMAIL_NOT_VERIFIED' };
  }
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
  return {
    ok: true,
    claims: {
      sub: claims.sub,
      email: claims.email,
      name: text(claims.name),
      hd: text(claims.hd),
      nonce: text(claims.nonce),
    },
  };
}

/**
 * Whether Google owns the mailbox (ADR 0064): a Gmail address, or a Workspace domain's. Only then
 * does a Google sign-in link to an existing account by itself.
 */
export function isGoogleAuthoritative(email: string, hd: string | null): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  return domain === 'gmail.com' || domain === 'googlemail.com' || hd !== null;
}

/** The claims a fake token carries; the fake issuer fills the rest as Google would. */
export interface FakeTokenInput {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly hd: string | null;
  readonly nonce: string;
}

/** Signs a token as the fake issuer — development and tests only (ADR 0063). */
export function signFakeIdToken(
  privateKey: KeyObject,
  input: FakeTokenInput,
  options: { readonly audience: string; readonly now: Date; readonly ttlMs?: number },
): string {
  const seconds = Math.floor(options.now.getTime() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: FAKE_GOOGLE_KEY_ID });
  const payload = encode({
    iss: 'https://accounts.google.com',
    aud: options.audience,
    sub: input.sub,
    email: input.email,
    email_verified: input.emailVerified,
    nonce: input.nonce,
    iat: seconds,
    exp: seconds + Math.floor((options.ttlMs ?? 3_600_000) / 1000),
    ...(input.name === null ? {} : { name: input.name }),
    ...(input.hd === null ? {} : { hd: input.hd }),
  });
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${signature.toString('base64url')}`;
}
