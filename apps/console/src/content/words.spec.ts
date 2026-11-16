import { describe, expect, it } from 'vitest';
import { hasUndo, printedCode, radiusComparison, touristsGet, waitKey } from './words';

const loc = (lang: string, textReady: boolean) => ({
  lang,
  textReady,
  stale: false,
  audioStatus: 'NONE',
  audioStale: false,
});

describe('why a row waits (K1)', () => {
  it('gives the handoff’s words for each status and reason', () => {
    expect(waitKey('PROCESSING', null)).toBe('wait.PROCESSING');
    expect(waitKey('DRAFT', null)).toBe('wait.DRAFT');
    expect(waitKey('INACTIVE', 'ADMIN')).toBe('wait.ADMIN');
    expect(waitKey('INACTIVE', 'OWNER')).toBe('wait.OWNER');
    expect(waitKey('INACTIVE', 'ENTITLEMENT')).toBe('wait.ENTITLEMENT');
    expect(waitKey('ACTIVE', null)).toBeNull();
  });
});

describe('"tourists get" (K3)', () => {
  it('is the language when its text is ready, else English, else the source', () => {
    expect(touristsGet('ja', [loc('en', true), loc('ja', true)])).toBe('self');
    expect(touristsGet('ja', [loc('en', true), loc('ja', false)])).toBe('english');
    expect(touristsGet('ko', [loc('en', false)])).toBe('source');
    expect(touristsGet('en', [loc('en', false)])).toBe('source');
    expect(touristsGet('vi', [])).toBe('self');
  });
});

describe('Undo’s rule (K7, K9)', () => {
  it('only an Editorial Place’s deactivation has Undo', () => {
    expect(hasUndo('deactivate', 'EDITORIAL')).toBe(true);
    expect(hasUndo('deactivate', 'VENUE')).toBe(false);
    for (const action of ['delete', 'approve', 'reject'] as const) {
      expect(hasUndo(action, 'EDITORIAL')).toBe(false);
      expect(hasUndo(action, 'VENUE')).toBe(false);
    }
  });
});

describe('small words', () => {
  it('prints a code 4 + 4 and compares a radius to the street', () => {
    expect(printedCode('SCT7J6K3')).toBe('SCT7 J6K3');
    expect(radiusComparison(20)).toBe('editorial.fiveShopfronts');
    expect(radiusComparison(40)).toBe('editorial.halfBlock');
    expect(radiusComparison(90)).toBe('editorial.aBlock');
  });
});
