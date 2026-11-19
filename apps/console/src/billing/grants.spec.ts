import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/messages';
import {
  EMPTY_DRAFT,
  GRANT_KEYS,
  checkGrants,
  draftOf,
  formatMoney,
  grantLabel,
  grantNote,
  grantPaused,
  grantValue,
  scopeLanguages,
  typedGrants,
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

describe('the grants beside a plan (B2, W2)', () => {
  const OFF: Entitlements = {
    ...GROWTH,
    autoNarration: false,
    canSellVouchers: false,
    voucherCommissionBps: null,
  };

  it('names each grant, and says auto-narration short in the account’s columns', () => {
    expect(grantLabel('maxPlaces', en)).toBe(en.tDynamic('grants.maxPlaces'));
    expect(grantValue('autoNarration', GROWTH, en, true)).toBe(en.t('grants.on'));
    expect(grantValue('autoNarration', OFF, en, true)).toBe(en.t('grants.offShort'));
    expect(grantValue('autoNarration', OFF, en)).toBe(en.t('grants.autoOff'));
    expect(grantValue('canSellVouchers', OFF, en)).toBe(en.t('grants.vouchersNo'));
    expect(grantValue('maxPlaces', GROWTH, en)).toBe('10');
  });

  it('says auto-narration’s rule on every plan, the commission’s most only while selling, nothing else', () => {
    expect(grantNote('autoNarration', OFF, en)).toBe(en.t('grants.autoNote'));
    expect(grantNote('canSellVouchers', GROWTH, en)).toBe(
      en.t('grants.commissionCeiling', { n: 30 }),
    );
    expect(grantNote('canSellVouchers', OFF, en)).toBeNull();
    expect(grantNote('analyticsLevel', GROWTH, en)).toBeNull();
  });

  it('names a scope’s languages: the basic ones, the launch five, or the long tail as more', () => {
    expect(scopeLanguages('BASIC', en)).not.toContain('Japanese');
    expect(scopeLanguages('LAUNCH', en)).toContain('Japanese');
    expect(scopeLanguages('EXTENDED', en)).toMatch(/^Also /);
  });
});

describe('a plan’s grants as a form holds them (B3, W3)', () => {
  it('makes a draft of grants, the commission as a percentage or empty', () => {
    expect(draftOf(GROWTH)).toEqual(FILLED);
    expect(
      draftOf({ ...GROWTH, canSellVouchers: false, voucherCommissionBps: null }).commissionPercent,
    ).toBe('');
  });

  it('refuses a limit that isn’t whole or is under its least', () => {
    for (const typed of ['1.5', '0', '-1', 'ten'])
      expect(checkGrants({ ...FILLED, maxPlaces: typed }, en).errors).toHaveProperty('maxPlaces');
    expect(checkGrants({ ...FILLED, maxPhotosPerPlace: '0' }, en).errors).toBeNull();
  });

  it('requires the commission while selling vouchers, a whole percentage', () => {
    expect(checkGrants({ ...FILLED, commissionPercent: ' ' }, en).errors).toEqual({
      commissionPercent: en.t('issue.required'),
    });
    expect(checkGrants({ ...FILLED, commissionPercent: '12.5' }, en).errors).toHaveProperty(
      'commissionPercent',
    );
  });

  it('lists what was typed, keeping the earlier value where a number isn’t whole', () => {
    const typed = typedGrants(
      {
        ...EMPTY_DRAFT,
        maxPlaces: ' 20 ',
        maxPhotosPerPlace: 'many',
        canSellVouchers: true,
        commissionPercent: '',
      },
      GROWTH,
    );
    expect(typed).toMatchObject({
      maxPlaces: 20,
      maxPhotosPerPlace: 8,
      autoNarration: true,
      narrationLanguageScope: 'LAUNCH',
      analyticsLevel: 'BASIC',
      voucherCommissionBps: 1500,
    });
    const chosen = typedGrants(
      { ...FILLED, autoNarration: false, narrationLanguageScope: 'BASIC', analyticsLevel: 'FULL' },
      { ...GROWTH, voucherCommissionBps: null },
    );
    expect(chosen).toMatchObject({
      autoNarration: false,
      narrationLanguageScope: 'BASIC',
      analyticsLevel: 'FULL',
      voucherCommissionBps: 1500,
    });
    expect(
      typedGrants({ ...FILLED, canSellVouchers: false }, GROWTH).voucherCommissionBps,
    ).toBeNull();
    expect(
      typedGrants({ ...FILLED, commissionPercent: 'x' }, { ...GROWTH, voucherCommissionBps: null })
        .voucherCommissionBps,
    ).toBe(0);
  });
});
