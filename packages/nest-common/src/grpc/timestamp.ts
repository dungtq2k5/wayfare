import type { timestampGrpc } from '@wayfare/contracts/grpc';

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
