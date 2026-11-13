import { NarrationLanguageScope } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { homeView, narrationLanguages, venueWords } from './words';

describe("a venue's status in words", () => {
  it('gives each status and reason its words, never a code', () => {
    expect(venueWords({ status: 'ACTIVE', inactiveReason: null }).label).toBe('venue.live');
    expect(venueWords({ status: 'PROCESSING', inactiveReason: null })).toEqual({
      label: 'venue.processing',
      tone: 'processing',
      line: 'venue.processingLine',
    });
    expect(venueWords({ status: 'DRAFT', inactiveReason: null }).label).toBe('venue.draft');
    expect(venueWords({ status: 'INACTIVE', inactiveReason: 'OWNER' }).label).toBe('venue.closed');
    expect(venueWords({ status: 'INACTIVE', inactiveReason: 'ADMIN' })).toMatchObject({
      label: 'venue.takenDown',
      line: 'venue.writeSupport',
    });
    expect(venueWords({ status: 'INACTIVE', inactiveReason: 'ENTITLEMENT_LIMIT' }).label).toBe(
      'venue.offMap',
    );
  });
});

describe('not in your plan (K5)', () => {
  it('gives each scope the languages it covers, then what the next one adds', () => {
    const basic = narrationLanguages(NarrationLanguageScope.BASIC);
    expect(basic.filter((row) => row.inPlan).map((row) => row.lang)).toEqual(['vi', 'en']);
    expect(basic.filter((row) => !row.inPlan).map((row) => row.lang)).toEqual([
      'zh-Hans',
      'ja',
      'ko',
    ]);
    const launch = narrationLanguages(NarrationLanguageScope.LAUNCH);
    expect(launch.filter((row) => row.inPlan)).toHaveLength(5);
    expect(launch.filter((row) => !row.inPlan).map((row) => row.lang)).toContain('fr');
    expect(narrationLanguages(NarrationLanguageScope.EXTENDED).every((row) => row.inPlan)).toBe(
      true,
    );
  });
});

describe("N8's rule (K19)", () => {
  it('welcomes an owner with no venue and no submission, and shows Home once either exists', () => {
    expect(homeView(0, 0)).toBe('welcome');
    expect(homeView(1, 0)).toBe('home');
    expect(homeView(0, 1)).toBe('home');
  });
});
