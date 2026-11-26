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
const { ApiError } = await import('@wayfare/api-client');

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

describe('a sticker’s Place, read on the server (K3, K4)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.areasList.mockResolvedValue({ data: [area] });
  });

  it('reads it in the page’s language with its Vietnamese names, area and narration', async () => {
    const english = { ...place, localization: { lang: 'en' } };
    api.placesByCode.mockImplementation((_code: string, { lang }: { lang: string }) =>
      Promise.resolve({ data: lang === 'vi' ? place : english }),
    );
    api.narrationStatus.mockResolvedValue({ data: { audio: null, audioStatus: 'PENDING' } });
    await expect(loadPlace('ABCD2345', 'en')).resolves.toEqual({
      kind: 'place',
      place: english,
      vi: place,
      area,
      audioPending: true,
    });
    expect(api.narrationStatus).toHaveBeenCalledWith('p1', { lang: 'en' }, {});
  });

  it('keeps the Place when its Vietnamese names or its narration can’t be read', async () => {
    api.placesByCode
      .mockResolvedValueOnce({ data: { ...place, localization: { lang: 'en' } } })
      .mockRejectedValueOnce(new Error('down'));
    api.narrationStatus.mockRejectedValue(new Error('down'));
    await expect(loadPlace('ABCD2345', 'en')).resolves.toMatchObject({
      kind: 'place',
      vi: null,
      audioPending: false,
    });
  });

  it('says where a Place no longer listed was', async () => {
    api.placesByCode.mockRejectedValue(
      new ApiError(410, 'PLACE_UNAVAILABLE', 'x', { areaCode: 'hoi-an', near: { lat: 1, lng: 2 } }),
    );
    await expect(loadPlace('ABCD2345', 'vi')).resolves.toEqual({
      kind: 'gone',
      area,
      near: { lat: 1, lng: 2 },
    });
    api.placesByCode.mockRejectedValue(new ApiError(410, 'PLACE_UNAVAILABLE', 'x'));
    await expect(loadPlace('ABCD2345', 'vi')).resolves.toEqual({
      kind: 'gone',
      area: null,
      near: null,
    });
  });

  it('is missing for an unknown or malformed code, and throws on anything else', async () => {
    api.placesByCode.mockRejectedValueOnce(new ApiError(404, 'RESOURCE_NOT_FOUND', 'x'));
    await expect(loadPlace('ZZZZ', 'vi')).resolves.toEqual({ kind: 'missing' });
    api.placesByCode.mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'x'));
    await expect(loadPlace('!', 'vi')).resolves.toEqual({ kind: 'missing' });
    api.placesByCode.mockRejectedValueOnce(new ApiError(503, 'UPSTREAM_UNAVAILABLE', 'x'));
    await expect(loadPlace('ABCD2345', 'vi')).rejects.toThrow();
  });
});
