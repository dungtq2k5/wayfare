/**
 * Maps a stored string to its domain enum member, throwing on an unknown value
 * rather than letting it through as a plain string (conventions §8.4).
 */
export function parseEnum<E extends Record<string, string>>(
  enumObject: E,
  value: string,
): E[keyof E] {
  const members = Object.values(enumObject);
  if (!members.includes(value)) {
    throw new Error(`Unknown enum value "${value}"; expected one of ${members.join(', ')}`);
  }
  return value as E[keyof E];
}
