import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

/** Matches a lowercase or uppercase RFC 9562 UUID whose version nibble is 7 (ADR 0055). */
export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The only id generator in the system — a UUIDv7 (ADR 0055, rdm-spec §2.1). */
export function newId(): string {
  return uuidv7();
}

/** True when `value` is a UUIDv7. A valid v4 is not. */
export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && UUID_V7_PATTERN.test(value);
}

/** Zod schema for every id accepted from outside: path, query, body, header or event payload. */
export const zUuidV7 = z.string().regex(UUID_V7_PATTERN, { message: 'Expected a UUIDv7' });
