import { SessionClient } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { decideRefresh } from './refresh-decision';
import type { RefreshRow } from './refresh-decision';

const now = new Date('2026-09-17T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const live: RefreshRow = {
  client: SessionClient.CONSOLE,
  expiresAt: new Date(now.getTime() + 60_000),
  rotatedAt: null,
  revokedAt: null,
};

describe('decideRefresh', () => {
  it.each<[string, RefreshRow | null, SessionClient, string]>([
    ['no row', null, SessionClient.CONSOLE, 'UNKNOWN'],
    [
      'a revoked row, even if rotated',
      { ...live, revokedAt: ago(1), rotatedAt: ago(1) },
      SessionClient.CONSOLE,
      'REVOKED',
    ],
    ['an expired row', { ...live, expiresAt: now }, SessionClient.CONSOLE, 'EXPIRED'],
    ['a live row', live, SessionClient.CONSOLE, 'ROTATE'],
    [
      'a console token rotated 9 999 ms ago',
      { ...live, rotatedAt: ago(9_999) },
      SessionClient.CONSOLE,
      'RACE',
    ],
    [
      'a web token rotated just now',
      { ...live, client: SessionClient.WEB, rotatedAt: ago(0) },
      SessionClient.WEB,
      'RACE',
    ],
    [
      'the grace boundary — exactly 10 000 ms',
      { ...live, rotatedAt: ago(10_000) },
      SessionClient.CONSOLE,
      'REPLAY',
    ],
    [
      'a race candidate presented by another client',
      { ...live, rotatedAt: ago(1_000) },
      SessionClient.WEB,
      'REPLAY',
    ],
    [
      'a mobile token inside the window — strict rotation',
      { ...live, client: SessionClient.MOBILE, rotatedAt: ago(1_000) },
      SessionClient.MOBILE,
      'REPLAY',
    ],
    [
      'a token rotated long ago',
      { ...live, rotatedAt: ago(3_600_000) },
      SessionClient.CONSOLE,
      'REPLAY',
    ],
  ])('%s → %s', (_label, row, client, expected) => {
    expect(decideRefresh(row, client, now)).toBe(expected);
  });
});
