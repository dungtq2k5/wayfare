import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * A 256-bit random secret, base64url — the only way to make a device secret, refresh token,
 * action token or server-side voucher secret (conventions §9.2).
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex of a high-entropy token, for lookup by value through a unique index (conventions §9.1). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** SHA-256 hex of arbitrary content — identity, not secrecy. */
export function sha256Hex(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * HMAC-SHA-256 of a low-entropy value looked up by value (a short code, an email address).
 * `purpose` domain-separates uses of the same key.
 */
export function keyedHash(key: string | Buffer, purpose: string, value: string): string {
  return createHmac('sha256', key).update(purpose).update(':').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests. Different lengths compare unequal. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/** A random code drawn from `alphabet` with a CSPRNG, one `randomInt` per character. */
export function generateCode(alphabet: string, length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) code += alphabet.charAt(randomInt(alphabet.length));
  return code;
}
