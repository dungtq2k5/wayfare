import type { timestampGrpc } from '@wayfare/contracts/grpc';
import { z } from 'zod';

/** `Date` → `google.protobuf.Timestamp` (conventions §6.3). int64 seconds travel as strings. */
export function toProtoTimestamp(date: Date): timestampGrpc.Timestamp {
  const ms = date.getTime();
  const seconds = Math.floor(ms / 1000);
  return { seconds: String(seconds), nanos: (ms - seconds * 1000) * 1_000_000 };
}

/** Thrown when a required timestamp is missing or malformed — a peer bug, never user input. */
export class InvalidTimestampError extends Error {
  constructor(field: string) {
    super(`Missing or malformed timestamp: ${field}`);
    this.name = 'InvalidTimestampError';
  }
}

/** `google.protobuf.Timestamp` → `Date`; a required field that is absent throws (conventions §6.3). */
export function fromProtoTimestamp(
  value: timestampGrpc.Timestamp | undefined,
  field: string,
): Date {
  const seconds = Number(value?.seconds);
  if (value === undefined || !Number.isSafeInteger(seconds)) throw new InvalidTimestampError(field);
  return new Date(seconds * 1000 + Math.floor((value.nanos ?? 0) / 1_000_000));
}

/**
 * An optional timestamp field → `Date | null`. Absent arrives as `undefined` in ts-proto's types
 * and as `null` from the proto loader; both are `null`. A present but malformed one throws.
 */
export function fromOptionalProtoTimestamp(
  value: timestampGrpc.Timestamp | null | undefined,
  field: string,
): Date | null {
  return value === undefined || value === null ? null : fromProtoTimestamp(value, field);
}

/**
 * A timestamp in a request, validated at the service edge (conventions §6.3): whole seconds as an
 * int64 string, nanos in range. Parses to a `Date`.
 */
export const zProtoTimestamp = z
  .object({
    seconds: z.string().regex(/^-?\d{1,12}$/),
    nanos: z.number().int().min(0).max(999_999_999),
  })
  .transform(
    (value) => new Date(Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000)),
  );
