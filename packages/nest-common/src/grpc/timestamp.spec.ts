import { describe, expect, it } from 'vitest';
import {
  fromOptionalProtoTimestamp,
  fromProtoTimestamp,
  InvalidTimestampError,
  toProtoTimestamp,
  zProtoTimestamp,
} from './timestamp';

const at = new Date('2026-09-17T12:34:56.789Z');

describe('proto timestamps', () => {
  it('round-trip to the millisecond', () => {
    expect(fromProtoTimestamp(toProtoTimestamp(at), '/at')).toEqual(at);
    expect(zProtoTimestamp.parse(toProtoTimestamp(at))).toEqual(at);
  });

  it('an absent optional field is null, a malformed one throws', () => {
    expect(fromOptionalProtoTimestamp(undefined, '/at')).toBeNull();
    expect(fromOptionalProtoTimestamp(null, '/at')).toBeNull();
    expect(fromOptionalProtoTimestamp(toProtoTimestamp(at), '/at')).toEqual(at);
    expect(() => fromOptionalProtoTimestamp({ seconds: 'x', nanos: 0 }, '/at')).toThrow(
      InvalidTimestampError,
    );
  });

  it('a request timestamp refuses malformed seconds and nanos', () => {
    expect(zProtoTimestamp.safeParse({ seconds: '1.5', nanos: 0 }).success).toBe(false);
    expect(zProtoTimestamp.safeParse({ seconds: '1', nanos: 1e9 }).success).toBe(false);
    expect(zProtoTimestamp.safeParse(null).success).toBe(false);
  });
});
