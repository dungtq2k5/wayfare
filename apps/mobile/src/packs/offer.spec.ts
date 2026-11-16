import { describe, expect, it } from 'vitest';
import { shouldOffer } from './offer';

const base = { packsInArea: 0, offered: false, switching: false, network: 'wifi' };

describe('the offer', () => {
  it('shows for an area with no pack, on Wi-Fi, once', () => {
    expect(shouldOffer(base)).toBe(true);
    expect(shouldOffer({ ...base, offered: true })).toBe(false);
    expect(shouldOffer({ ...base, packsInArea: 1 })).toBe(false);
  });

  it('never on mobile data or offline, and not while a language switch shows its pill', () => {
    expect(shouldOffer({ ...base, network: 'cellular' })).toBe(false);
    expect(shouldOffer({ ...base, network: 'none' })).toBe(false);
    expect(shouldOffer({ ...base, network: undefined })).toBe(false);
    expect(shouldOffer({ ...base, switching: true })).toBe(false);
  });
});
