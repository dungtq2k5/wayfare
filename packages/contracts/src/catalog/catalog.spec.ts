import { describe, expect, it } from 'vitest';
import { NARRATION_LOCALIZATION_READY } from '../events/narration.events';
import { localizationReadyFixture } from '../testing/catalog-fixtures';
import { MenuCurrency } from '../money/display-price';
import { PUBLIC_CODE_PATTERN, UPLOAD_CONTENT_TYPES } from './limits';
import {
  canonicalPublicCode,
  zMenuInput,
  zOpeningHoursRow,
  zPhotoSetItem,
  zPlaceContentInput,
  zPublicCode,
} from './schemas';
import { datasetVersionFromWire } from './sync';

const content = {
  nameVi: '  Chợ   Bến Thành ',
  descriptionVi: 'Chợ có từ năm 1914.',
  categoryCode: 'MARKET',
  location: { lat: 10.77, lng: 106.69 },
};

describe('catalog schemas', () => {
  it('normalizes content text and refuses the editorial values (rdm-spec §1.4)', () => {
    expect(zPlaceContentInput.parse(content).nameVi).toBe('Chợ Bến Thành');
    for (const key of ['narrationPriority', 'triggerRadiusM', 'discoveryBoost']) {
      expect(zPlaceContentInput.safeParse({ ...content, [key]: 50 }).success).toBe(false);
    }
  });

  it('bounds the location and accepts https websites only', () => {
    expect(
      zPlaceContentInput.safeParse({ ...content, location: { lat: 91, lng: 0 } }).success,
    ).toBe(false);
    expect(
      zPlaceContentInput.safeParse({ ...content, websiteUrl: 'http://example.com' }).success,
    ).toBe(false);
    expect(
      zPlaceContentInput.safeParse({ ...content, websiteUrl: 'https://example.com' }).success,
    ).toBe(true);
    expect(zPlaceContentInput.safeParse({ ...content, phone: '0901234567' }).success).toBe(false);
    expect(zPlaceContentInput.safeParse({ ...content, phone: '+84901234567' }).success).toBe(true);
  });

  it('holds the opening-hours rules of C-16', () => {
    const ok = (row: object) => zOpeningHoursRow.safeParse(row).success;
    expect(ok({ weekday: 1, opensAt: '17:00', closesAt: '02:00' })).toBe(true);
    expect(ok({ specificDate: '2027-02-06', isClosed: true })).toBe(true);
    expect(ok({ weekday: 1, specificDate: '2027-02-06', isClosed: true })).toBe(false);
    expect(ok({ isClosed: true })).toBe(false);
    expect(ok({ weekday: 8, isClosed: true })).toBe(false);
    expect(ok({ weekday: 1, opensAt: '09:00' })).toBe(false);
    expect(ok({ weekday: 1, opensAt: '24:00', closesAt: '25:00' })).toBe(false);
  });

  it('applies the menu currency ceiling per item', () => {
    const menu = (menuCurrency: MenuCurrency, priceMinor: number) =>
      zMenuInput.safeParse({ menuCurrency, items: [{ nameVi: 'Phở', priceMinor }] });
    expect(menu(MenuCurrency.VND, 50_000_000).success).toBe(true);
    expect(menu(MenuCurrency.VND, 50_000_001).success).toBe(false);
    expect(menu(MenuCurrency.USD, 200_000).success).toBe(true);
    const refused = menu(MenuCurrency.USD, 200_001);
    expect(refused.success ? [] : refused.error.issues.map((issue) => issue.path)).toEqual([
      ['items', 0, 'priceMinor'],
    ]);
  });

  it('takes exactly one of photoId and uploadId', () => {
    const id = '01990000-0000-7000-8000-000000000001';
    expect(zPhotoSetItem.safeParse({ photoId: id }).success).toBe(true);
    expect(zPhotoSetItem.safeParse({ photoId: id, uploadId: id }).success).toBe(false);
    expect(zPhotoSetItem.safeParse({}).success).toBe(false);
  });

  it('matches public codes in Crockford base32 only', () => {
    expect(PUBLIC_CODE_PATTERN.test('K7M2Q9XA')).toBe(true);
    expect(PUBLIC_CODE_PATTERN.test('k7m2q9xa')).toBe(false);
    for (const code of ['K7M2Q9XU', 'K7M2Q9X', 'K7M2Q9XAB', '']) {
      expect(zPublicCode.safeParse(code).success).toBe(false);
    }
  });

  it('canonicalizes a typed code', () => {
    expect(zPublicCode.parse(' k7m2-q9xa ')).toBe('K7M2Q9XA');
    expect(canonicalPublicCode('oILo0000')).toBe('01100000');
  });

  it('accepts no HEIC upload', () => {
    expect(UPLOAD_CONTENT_TYPES).not.toContain('image/heic');
  });
});

describe('datasetVersionFromWire', () => {
  it('reads safe integers and refuses anything else', () => {
    expect(datasetVersionFromWire('0')).toBe(0);
    expect(datasetVersionFromWire('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of ['9007199254740992', '-1', '1.5', '']) {
      expect(() => datasetVersionFromWire(value)).toThrow(RangeError);
    }
  });
});

describe('localizationReadyFixture', () => {
  it('is a valid event, with and without audio', () => {
    const hash = 'a'.repeat(64);
    const placeId = '01990000-0000-7000-8000-000000000004';
    for (const audioContentHash of [undefined, null, 'b'.repeat(64)]) {
      const payload = localizationReadyFixture({
        placeId,
        lang: 'en',
        sourceContentHash: hash,
        audioContentHash,
      });
      expect(NARRATION_LOCALIZATION_READY.schema.safeParse(payload).success).toBe(true);
    }
    const vi = localizationReadyFixture({ placeId, lang: 'vi', sourceContentHash: hash });
    expect(vi.translationSource).toBe('SOURCE');
  });
});
