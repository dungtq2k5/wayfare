import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({
  QR_BASE_URL: 'http://localhost:13000',
  LINK_BASE_URL: 'http://localhost:5174',
}));

const { routeForLink, MAP_PATH } = await import('./link-entry');
const { takePending, useCodeStore } = await import('./store');

describe('routeForLink', () => {
  beforeEach(() => useCodeStore.setState({ pending: null, result: null, opened: null }));

  it('keeps a Place link for the Map, which opens it once', () => {
    expect(routeForLink('https://wayfare.app/p/QK4V1TCX')).toBe(MAP_PATH);
    expect(takePending()).toEqual({ code: 'QK4V1TCX', source: 'link', printed: false });
    expect(takePending()).toBeNull();
  });

  it('marks a sticker link as a scan to count', () => {
    routeForLink('http://localhost:13000/q/QK4V1TCX');
    expect(takePending()?.printed).toBe(true);
  });

  it('keeps one code when two links come quickly', () => {
    routeForLink('https://wayfare.app/p/QK4V1TCX');
    routeForLink('https://wayfare.app/p/NQ22ZQXK');
    expect(takePending()?.code).toBe('NQ22ZQXK');
    expect(takePending()).toBeNull();
  });

  it('opens the Map with nothing pending for a Wayfare link that is not a Place', () => {
    expect(routeForLink('https://wayfare.app/')).toBe(MAP_PATH);
    expect(takePending()).toBeNull();
  });

  it('leaves the broken link sheet for the Map', () => {
    expect(routeForLink('https://wayfare.app/p/ABC')).toBe(MAP_PATH);
    expect(useCodeStore.getState().result).toEqual({ kind: 'bad-link' });
  });

  it('passes the app’s own paths through', () => {
    expect(routeForLink('/settings/diagnostics')).toBe('/settings/diagnostics');
    expect(routeForLink('https://example.com/p/QK4V1TCX')).toBe('https://example.com/p/QK4V1TCX');
  });
});
