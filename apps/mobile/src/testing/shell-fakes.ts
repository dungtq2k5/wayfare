// Fakes the shell's specs share: a translator that names the key it was asked for, and the
// key-value store zustand's persisted stores write to.
import type { Tourist } from '../i18n/tourist';

/** `t` and `tFamily` that answer the key (and its arguments), so a spec sees which text was chosen. */
export const keyTourist: Tourist = {
  t: (key: string, args?: object) => (args ? `${key} ${JSON.stringify(args)}` : key),
  tFamily: (family, suffix) => `${family}.${suffix}`,
};

/** `expo-sqlite/kv-store`'s default export, in memory. */
export function memoryKv() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => Promise.resolve(values.get(key) ?? null),
    setItem: (key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      values.delete(key);
      return Promise.resolve();
    },
  };
}

/** A tour as `GET /sync/tours` sends it, in `areaId`, its stops these Places in order. */
export function tourRecord(id: string, areaId: string, placeIds: readonly string[]) {
  return {
    id,
    publicCode: 'ABCDEFGH',
    areaId,
    text: {
      lang: 'en',
      title: `Tour ${id}`,
      description: '',
      contentTier: 'REQUESTED',
      stale: false,
    },
    cover: null,
    estimatedMinutes: 60,
    distanceM: 1_200,
    stops: placeIds.map((placeId, position) => ({ position, placeId })),
  };
}
