import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';

/**
 * Password hashing with argon2id at the OWASP Password Storage Cheat Sheet (2023) baseline:
 * 19 MiB, 2 iterations, 1 degree of parallelism.
 */
export const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hashes a password for `users.password_hash`. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** True when `password` matches `passwordHash`; a malformed hash is a mismatch, never a throw. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * A hash no password matches, computed once. A login for an unknown email verifies against it, so
 * its response time does not reveal whether the account exists (api-endpoints-plan §1.2).
 */
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummyHash;
}
