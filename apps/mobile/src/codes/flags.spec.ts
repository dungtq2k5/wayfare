import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/kv-store', async () => ({
  default: (await import('../testing/account-fakes')).memoryKv,
}));
vi.mock('../env', () => ({
  QR_BASE_URL: 'https://go.wayfare.app',
  LINK_BASE_URL: 'https://wayfare.app',
}));

const { resetCameraFlags, useCameraFlags } = await import('./flags');
const { judgeScan } = await import('./scanner-reader');

describe('the camera’s explainer', () => {
  it('comes once, and again after the install is forgotten', () => {
    expect(useCameraFlags.getState().explained).toBe(false);
    useCameraFlags.setState({ explained: true });
    resetCameraFlags();
    expect(useCameraFlags.getState().explained).toBe(false);
  });
});

describe('a text the scanner read', () => {
  it('opens a sticker’s code', () => {
    expect(judgeScan('https://go.wayfare.app/q/ABCD2345', null)).toMatchObject({ kind: 'open' });
  });

  it('says anything else is not a Wayfare code, once for the same text held in view', () => {
    expect(judgeScan('https://example.com', null)).toEqual({ kind: 'not-wayfare', repeat: false });
    expect(judgeScan('https://example.com', 'https://example.com')).toEqual({
      kind: 'not-wayfare',
      repeat: true,
    });
  });
});
