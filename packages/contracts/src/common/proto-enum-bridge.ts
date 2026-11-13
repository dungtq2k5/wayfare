/** A two-way map between a domain string enum and the ts-proto numeric enum that carries it. */
export interface ProtoEnumBridge<D extends string, P extends number> {
  /** The proto enum's name, for errors and logs. */
  readonly name: string;
  /** Every domain member the bridge pairs. */
  readonly members: readonly D[];
  /** A domain member → its proto member; `null`/`undefined` → `<PREFIX>_UNSPECIFIED` (optional fields). */
  toProto(value: D | null | undefined): P;
  /** A proto value → its domain member; `null` for UNSPECIFIED, UNRECOGNIZED and any number this build does not know. */
  fromProto(value: number | null | undefined): D | null;
}

/** `AudioStatus` → `AUDIO_STATUS`: an underscore before each capital that follows a lowercase letter or digit. */
export function protoEnumPrefix(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * Pairs each domain VALUE with the proto member `<ENUM_NAME>_<VALUE>` (conventions §15), where
 * `<ENUM_NAME>` is `name` in SCREAMING_SNAKE (`AudioStatus` → `AUDIO_STATUS`).
 * Throws at module load if either side has a member the other lacks.
 */
export function protoEnumBridge<D extends string, E extends Record<string, string | number>>(
  name: string,
  domain: Record<string, D>,
  proto: E,
): ProtoEnumBridge<D, Extract<E[keyof E], number>> {
  type P = Extract<E[keyof E], number>;
  const prefix = protoEnumPrefix(name);
  const unspecifiedKey = `${prefix}_UNSPECIFIED`;
  const fail = (problem: string): never => {
    throw new Error(`protoEnumBridge(${name}): ${problem}`);
  };

  for (const [key, value] of Object.entries(domain)) {
    if (key !== value) fail(`domain member ${key} has value ${value}; key and value must be equal`);
  }
  if (proto[unspecifiedKey] !== 0) fail(`${unspecifiedKey} is missing or is not 0`);

  const protoByDomain = new Map<D, P>();
  const domainByProto = new Map<number, D>();
  for (const value of Object.values(domain)) {
    const protoValue = proto[`${prefix}_${value}`];
    if (typeof protoValue !== 'number')
      fail(`domain value ${value} has no proto member ${prefix}_${value}`);
    protoByDomain.set(value, protoValue as P);
    domainByProto.set(protoValue as number, value);
  }
  for (const [key, value] of Object.entries(proto)) {
    // ts-proto numeric enums carry reverse mappings ('1' → 'PLATFORM_IOS'); only numeric values are members.
    if (typeof value !== 'number' || key === unspecifiedKey || key === 'UNRECOGNIZED') continue;
    const paired = domainByProto.get(value);
    if (paired === undefined || key !== `${prefix}_${paired}`) {
      fail(`proto member ${key} has no domain value`);
    }
  }

  return {
    name,
    members: [...protoByDomain.keys()],
    toProto: (value) => (value == null ? 0 : (protoByDomain.get(value) ?? 0)) as P,
    fromProto: (value) => (value == null ? null : (domainByProto.get(value) ?? null)),
  };
}
