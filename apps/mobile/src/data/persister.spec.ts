import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/kv-store', () =>
  import('../testing/player-fakes').then((m) => m.kvStoreModule),
);
// The tests' alias reads only the client's transport: the generated key is spelled here.
const getAreasListQueryKey = vi.hoisted(() => () => ['/api/v1/areas'] as const);
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAreasListQueryKey,
}));

const { PERSIST_MAX_AGE_MS, persistOptions } = await import('./persister');
const { queryClient } = await import('../state/query-client');

describe('the query cache kept across launches', () => {
  it('keeps only the areas list and the map packs’ styles, for a week', () => {
    const keep = persistOptions.dehydrateOptions.shouldDehydrateQuery;
    expect(keep({ queryKey: getAreasListQueryKey() })).toBe(true);
    expect(keep({ queryKey: ['map-pack', 'a1'] })).toBe(true);
    expect(keep({ queryKey: ['local', 'areas'] })).toBe(false);
    expect(persistOptions.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('holds a restored areas list and pack style as long as they may be restored', () => {
    expect(queryClient.getQueryDefaults(getAreasListQueryKey()).gcTime).toBe(PERSIST_MAX_AGE_MS);
    expect(queryClient.getQueryDefaults(['map-pack', 'a1']).gcTime).toBe(PERSIST_MAX_AGE_MS);
  });
});
