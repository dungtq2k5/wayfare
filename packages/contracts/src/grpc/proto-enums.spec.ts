import { describe, expect, it } from 'vitest';
import type { ProtoEnumBridge } from '../common/proto-enum-bridge';
import { PROTO_ENUM_BRIDGES } from './proto-enums';

const bridges: readonly ProtoEnumBridge<string, number>[] = PROTO_ENUM_BRIDGES;

describe('PROTO_ENUM_BRIDGES', () => {
  it('is not empty', () => {
    expect(bridges.length).toBeGreaterThan(0);
  });

  it.each(bridges.map((bridge) => [bridge.name, bridge] as const))(
    '%s round-trips every domain member through a non-zero proto value',
    (_name, bridge) => {
      expect(bridge.members.length).toBeGreaterThan(0);
      for (const member of bridge.members) {
        expect(bridge.toProto(member)).not.toBe(0);
        expect(bridge.fromProto(bridge.toProto(member))).toBe(member);
      }
    },
  );
});
