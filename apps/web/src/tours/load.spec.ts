import { ApiError } from '@wayfare/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../server/api', () => ({ visitorOptions: () => Promise.resolve({}) }));
const areas = vi.hoisted(() => ({ loadAreas: vi.fn() }));
vi.mock('../places/load', () => areas);
const api = vi.hoisted(() => ({ toursByCode: vi.fn(), codesResolve: vi.fn() }));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

const { isTourCode, loadTour } = await import('./load');

const area = { id: 'a1', code: 'd1' };
const tour = { id: 't1', areaId: 'a1' };

describe('a tour from its link or sticker (TW2, TW3)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    areas.loadAreas.mockResolvedValue([area]);
  });

  it('reads it in the page’s language, with its area', async () => {
    api.toursByCode.mockResolvedValue({ data: tour });
    await expect(loadTour('TOUR1', 'en')).resolves.toEqual({ kind: 'tour', tour, area });
    expect(api.toursByCode).toHaveBeenCalledWith('TOUR1', { lang: 'en' }, {});
  });

  it('names no area when its area isn’t listed', async () => {
    api.toursByCode.mockResolvedValue({ data: { ...tour, areaId: 'elsewhere' } });
    await expect(loadTour('TOUR2', 'en')).resolves.toMatchObject({ kind: 'tour', area: null });
  });

  it('says which area a tour no longer shown was in', async () => {
    api.toursByCode.mockRejectedValue(
      new ApiError(410, 'TOUR_UNAVAILABLE', 'x', { areaCode: 'd1' }),
    );
    await expect(loadTour('TOUR3', 'en')).resolves.toEqual({ kind: 'gone', area });
    api.toursByCode.mockRejectedValue(new ApiError(410, 'TOUR_UNAVAILABLE', 'x'));
    await expect(loadTour('TOUR4', 'en')).resolves.toEqual({ kind: 'gone', area: null });
  });

  it('is missing for an unknown or malformed code, and throws on anything else', async () => {
    api.toursByCode.mockRejectedValueOnce(new ApiError(404, 'RESOURCE_NOT_FOUND', 'x'));
    await expect(loadTour('TOUR5', 'en')).resolves.toEqual({ kind: 'missing' });
    api.toursByCode.mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'x'));
    await expect(loadTour('!', 'en')).resolves.toEqual({ kind: 'missing' });
    api.toursByCode.mockRejectedValueOnce(new Error('down'));
    await expect(loadTour('TOUR6', 'en')).rejects.toThrow('down');
  });

  it('tells a tour’s code from a Place’s, and a code it can’t resolve as not a tour', async () => {
    api.codesResolve.mockResolvedValueOnce({ data: { type: 'TOUR' } });
    expect(await isTourCode('TOUR1')).toBe(true);
    api.codesResolve.mockResolvedValueOnce({ data: { type: 'PLACE' } });
    expect(await isTourCode('PLACE1')).toBe(false);
    api.codesResolve.mockRejectedValueOnce(new Error('down'));
    expect(await isTourCode('X')).toBe(false);
  });
});
