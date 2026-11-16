import { describe, expect, it } from 'vitest';
import { protoEnumBridge, protoEnumPrefix } from './proto-enum-bridge';

enum Colour {
  RED = 'RED',
  DARK_BLUE = 'DARK_BLUE',
}

// The shape ts-proto emits: numeric members with reverse mappings, plus UNRECOGNIZED.
enum ProtoColour {
  COLOUR_UNSPECIFIED = 0,
  COLOUR_RED = 1,
  COLOUR_DARK_BLUE = 2,
  UNRECOGNIZED = -1,
}

describe('protoEnumBridge construction', () => {
  it('builds a bridge for a matching pair, ignoring reverse-mapping keys', () => {
    expect(() => protoEnumBridge('Colour', Colour, ProtoColour)).not.toThrow();
    expect(ProtoColour[1]).toBe('COLOUR_RED'); // the reverse mapping the check must skip
  });

  it('refuses a domain member whose KEY differs from its value', () => {
    enum Mismatched {
      Red = 'RED',
      DARK_BLUE = 'DARK_BLUE',
    }
    expect(() => protoEnumBridge('Colour', Mismatched, ProtoColour)).toThrow(/Red has value RED/);
  });

  it('refuses a proto enum without <PREFIX>_UNSPECIFIED = 0', () => {
    enum NoUnspecified {
      COLOUR_RED = 1,
      COLOUR_DARK_BLUE = 2,
    }
    enum NonZero {
      COLOUR_UNSPECIFIED = 3,
      COLOUR_RED = 1,
      COLOUR_DARK_BLUE = 2,
    }
    expect(() => protoEnumBridge('Colour', Colour, NoUnspecified)).toThrow(/COLOUR_UNSPECIFIED/);
    expect(() => protoEnumBridge('Colour', Colour, NonZero)).toThrow(/COLOUR_UNSPECIFIED/);
  });

  it('refuses a DOMAIN value the proto enum lacks', () => {
    enum Wider {
      RED = 'RED',
      DARK_BLUE = 'DARK_BLUE',
      GREEN = 'GREEN',
    }
    expect(() => protoEnumBridge('Colour', Wider, ProtoColour)).toThrow(
      /GREEN has no proto member COLOUR_GREEN/,
    );
  });

  it('refuses a PROTO value added without its domain value', () => {
    enum WiderProto {
      COLOUR_UNSPECIFIED = 0,
      COLOUR_RED = 1,
      COLOUR_DARK_BLUE = 2,
      COLOUR_GREEN = 3,
      UNRECOGNIZED = -1,
    }
    expect(() => protoEnumBridge('Colour', Colour, WiderProto)).toThrow(
      /COLOUR_GREEN has no domain value/,
    );
  });
});

describe('protoEnumPrefix', () => {
  it.each([
    ['Platform', 'PLATFORM'],
    ['AudioStatus', 'AUDIO_STATUS'],
    ['OtpPurpose2', 'OTP_PURPOSE2'],
  ])('%s → %s', (name, prefix) => {
    expect(protoEnumPrefix(name)).toBe(prefix);
  });
});

describe('protoEnumBridge conversions', () => {
  const colour = protoEnumBridge('Colour', Colour, ProtoColour);

  it('maps both ways, including a multi-word value', () => {
    expect(colour.toProto(Colour.DARK_BLUE)).toBe(ProtoColour.COLOUR_DARK_BLUE);
    expect(colour.fromProto(ProtoColour.COLOUR_RED)).toBe(Colour.RED);
  });

  it('sends UNSPECIFIED for an absent optional value', () => {
    expect(colour.toProto(null)).toBe(0);
    expect(colour.toProto(undefined)).toBe(0);
  });

  it.each([0, -1, 99, undefined, null])('reads %s as null', (value) => {
    expect(colour.fromProto(value)).toBeNull();
  });

  it('carries its name and members', () => {
    expect(colour.name).toBe('Colour');
    expect(colour.members).toEqual([Colour.RED, Colour.DARK_BLUE]);
  });
});
