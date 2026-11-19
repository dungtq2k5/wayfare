import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/kv-store', () =>
  import('../testing/player-fakes').then((m) => m.kvStoreModule),
);
const getAreasListQueryKey = vi.hoisted(() => () => ['/api/v1/areas'] as const);
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAreasListQueryKey,
}));
vi.mock('../i18n', () => ({
  tourist: () => ({
    t: (key: string) => (key === 'player.appName' ? 'Wayfare' : key),
    tFamily: (family: string, code: string, fallback: string) =>
      code === 'd1' ? `${family}.${code}` : fallback,
  }),
}));

const { areaNameOf } = await import('./area-name');
const { queryClient } = await import('../state/query-client');

describe('the area’s name on the lock screen', () => {
  it('is the area’s name through the app’s strings, from the kept areas list', () => {
    queryClient.setQueryData(getAreasListQueryKey(), { data: [{ id: 'a1', code: 'd1' }] });
    expect(areaNameOf('a1')).toBe('area.d1');
  });

  it('is “Wayfare” for an area it doesn’t know, or with no list kept', () => {
    expect(areaNameOf('elsewhere')).toBe('Wayfare');
    expect(areaNameOf(null)).toBe('Wayfare');
    queryClient.removeQueries({ queryKey: getAreasListQueryKey() });
    expect(areaNameOf('a1')).toBe('Wayfare');
  });
});
