import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/messages';
import {
  EMPTY_DRAFT,
  GRANT_KEYS,
  checkGrants,
  formatMoney,
  grantNote,
  grantPaused,
  grantValue,
  vouchersPaused,
} from './grants';
import type { Entitlements, GrantsDraft } from './grants';

const en = createTranslator('en');
const vi = createTranslator('vi');

const GROWTH: Entitlements = {
  maxPlaces: 10,
  autoNarration: true,
  narrationLanguageScope: 'LAUNCH',
  maxPhotosPerPlace: 8,
  maxMenuItemsPerPlace: 200,
  discoveryBoostSlots: 1,
  aiCreditsPerDay: 10,
  analyticsLevel: 'BASIC',
  canSellVouchers: true,
  voucherCommissionBps: 1500,
};

const FILLED: GrantsDraft = {
  maxPlaces: '10',
  maxPhotosPerPlace: '8',
  maxMenuItemsPerPlace: '200',
  discoveryBoostSlots: '1',
  aiCreditsPerDay: '10',
  autoNarration: true,
  narrationLanguageScope: 'LAUNCH',
  analyticsLevel: 'BASIC',
  canSellVouchers: true,
  commissionPercent: '15',
};

describe('the grants in words (B2)', () => {
  it('says every grant, with the ceiling beside a limit below it', () => {
    expect(grantValue('autoNarration', GROWTH, en)).toBe(
      'On — its Venues play when a tourist walks near',
    );
    expect(grantValue('canSellVouchers', GROWTH, en)).toBe('Yes, 15 % commission');
    expect(grantValue('analyticsLevel', GROWTH, en)).toBe('Basic');
    expect(grantNote('maxPlaces', GROWTH, en)).toBe('The platform allows 100');
    expect(grantNote('maxPhotosPerPlace', GROWTH, en)).toBe('The most the platform allows');
    expect(grantNote('narrationLanguageScope', GROWTH, en)).toContain('Japanese');
  });

  it('has every grant in both languages', () => {
    for (const translator of [en, vi])
      for (const key of GRANT_KEYS) {
        expect(translator.tDynamic(`grants.${key}`)).not.toBe(`grants.${key}`);
        expect(grantValue(key, GROWTH, translator)).not.toMatch(/^grants\./);
      }
    expect(grantValue('canSellVouchers', GROWTH, vi)).toBe('Có, hoa hồng 15 %');
  });

  it('keeps the voucher grant’s value, paused while vouchers aren’t sold (ADR 0066)', () => {
    const none = { ...GROWTH, canSellVouchers: false, voucherCommissionBps: null };
    expect(vouchersPaused()).toBe(true);
    expect(grantPaused('canSellVouchers', GROWTH)).toBe(true);
    expect(grantValue('canSellVouchers', GROWTH, en)).toBe('Yes, 15 % commission');
    // "No" carries no chip; nor does any other grant.
    expect(grantPaused('canSellVouchers', none)).toBe(false);
    expect(grantPaused('maxPlaces', GROWTH)).toBe(false);
    // Once they are sold, today's rendering returns.
    expect(vouchersPaused(true)).toBe(false);
    expect(grantPaused('canSellVouchers', GROWTH, true)).toBe(false);
    expect(en.t('grants.vouchersPaused')).toMatch(/^Vouchers aren't sold yet/);
    expect(vi.t('grants.paused')).toBe('Tạm dừng');
  });

  it('writes money as Stripe states it', () => {
    expect(formatMoney({ amountMinor: 900, currency: 'USD' })).toBe('$9.00');
  });
});

describe('the plan form (K12)', () => {
  it('turns a full draft into grants, the commission in basis points', () => {
    expect(checkGrants(FILLED, en).grants).toEqual(GROWTH);
  });

  it('refuses a grant above its ceiling before sending', () => {
    const { errors } = checkGrants({ ...FILLED, maxPhotosPerPlace: '9' }, en);
    expect(errors).toEqual({
      maxPhotosPerPlace: 'The platform allows at most 8 photos per Place.',
    });
  });

  it('requires every grant: none has a default', () => {
    expect(Object.keys(checkGrants(EMPTY_DRAFT, en).errors ?? {})).toEqual([
      'maxPlaces',
      'maxPhotosPerPlace',
      'maxMenuItemsPerPlace',
      'aiCreditsPerDay',
      'discoveryBoostSlots',
      'autoNarration',
      'narrationLanguageScope',
      'analyticsLevel',
    ]);
  });

  it('sends no commission without selling vouchers, whatever was typed', () => {
    const { grants } = checkGrants({ ...FILLED, canSellVouchers: false }, en);
    expect(grants?.voucherCommissionBps).toBeNull();
    expect(checkGrants({ ...FILLED, commissionPercent: '31' }, en).errors).toHaveProperty(
      'commissionPercent',
    );
  });
});
