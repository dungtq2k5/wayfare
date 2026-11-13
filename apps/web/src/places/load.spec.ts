import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../server/api', () => ({ visitorOptions: () => Promise.resolve({}) }));
const api = vi.hoisted(() => ({
  areasList: vi.fn(),
  placesByCode: vi.fn(),
  narrationStatus: vi.fn(),
}));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

const { loadAreas, loadAreasOrThrow, loadPlace } = await import('./load');

const area = { id: 'a1', code: 'hoi-an' };
const place = { id: 'p1', areaId: 'a1', localization: { lang: 'vi' } };

describe('the areas, read on the server (F3)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('strict for the map: a failed read throws, for error.tsx to answer', async () => {
    api.areasList.mockRejectedValue(new Error('catalog down'));
    await expect(loadAreasOrThrow()).rejects.toThrow('catalog down');
  });

  it('lenient for a sticker: a failed read is no areas', async () => {
    api.areasList.mockRejectedValue(new Error('catalog down'));
    await expect(loadAreas()).resolves.toEqual([]);
    api.areasList.mockResolvedValue({ data: [area] });
    await expect(loadAreas()).resolves.toEqual([area]);
  });

  it('keeps a sticker’s Place when the areas fail, only its breadcrumb lost', async () => {
    api.areasList.mockRejectedValue(new Error('catalog down'));
    api.placesByCode.mockResolvedValue({ data: place });
    api.narrationStatus.mockResolvedValue({ data: { audio: null, audioStatus: 'READY' } });
    await expect(loadPlace('ABCD2345', 'vi')).resolves.toMatchObject({
      kind: 'place',
      place,
      area: null,
    });
  });
});
