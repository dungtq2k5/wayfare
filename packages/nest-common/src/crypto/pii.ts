import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const PREFIX = `${VERSION}:`;
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Thrown for a ciphertext that cannot be opened. It never carries the value. */
export class PiiDecryptionError extends Error {
  constructor(reason: string) {
    super(`decryptPii: ${reason}`);
    this.name = 'PiiDecryptionError';
  }
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error(`PII key must be ${KEY_BYTES} bytes`);
}

/**
 * Encrypts a personal identifier (a national ID) for storage (rdm-spec §1.10 rule 3): AES-256-GCM
 * with a fresh 12-byte IV, stored as `v1:` + base64url(iv ‖ ciphertext ‖ tag). The prefix names the
 * key, so a rotation adds a version rather than rewriting rows.
 */
export function encryptPii(key: Buffer, plaintext: string): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${PREFIX}${Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url')}`;
}

/** Opens `encryptPii`'s output. A wrong key, a tampered value or an unknown version throws. */
export function decryptPii(key: Buffer, stored: string): string {
  assertKey(key);
  if (!stored.startsWith(PREFIX)) throw new PiiDecryptionError('unknown key version');
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64url');
  if (raw.length < IV_BYTES + TAG_BYTES) throw new PiiDecryptionError('truncated value');
  const decipher = createDecipheriv(ALGORITHM, key, raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new PiiDecryptionError('authentication failed');
  }
}

/** The last four characters, which the console shows masked without a decrypt (rdm-spec I-8). */
export function piiLast4(value: string): string {
  return value.slice(-4);
}
