import { randomBytes } from 'node:crypto';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@wayfare/contracts';
import { argon2id, hash, verify } from 'argon2';
import { z } from 'zod';

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

/** A new password's length rule (conventions §9.1). */
export const zNewPassword = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

/** True when a new password is the account's own address — refused wherever a password is set. */
export function isPasswordTheEmail(password: string, normalizedEmail: string): boolean {
  return password.toLowerCase() === normalizedEmail;
}
