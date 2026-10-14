import { describe, expect, it } from 'vitest';
import { parseLink } from './parse';
import { checkTypedCode } from './typed';

const bases = { qr: 'http://localhost:13000', link: 'http://localhost:5174' };

describe('parseLink', () => {
  it.each([
    ['https://go.wayfare.app/q/QK4V1TCX', true],
    ['https://wayfare.app/p/qk4v-1tcx', false],
    ['https://wayfare.app/p/QK4V1TCX/?utm=sticker#top', false],
    ['http://localhost:13000/q/QK4V1TCX', true],
    ['http://localhost:5174/p/QK4V%201TCX', false],
    ['wayfare://p/QK4V1TCX', false],
  ])('reads %s as a code', (text, printed) => {
    expect(parseLink(text, bases)).toEqual({ kind: 'code', code: 'QK4V1TCX', printed });
  });

  it.each([
    'https://evil.example/p/QK4V1TCX',
    'http://wayfare.app/p/QK4V1TCX',
    'https://wayfare.app.evil.example/p/QK4V1TCX',
    'http://localhost:9999/q/QK4V1TCX',
    'ftp://wayfare.app/p/QK4V1TCX',
    'just some text',
    'WIFI:S:cafe;T:WPA;P:secret;;',
  ])('never opens %s', (text) => {
    expect(parseLink(text, bases)).toEqual({ kind: 'not-wayfare' });
  });

  it('opens the app for a Wayfare link that is not a Place', () => {
    expect(parseLink('https://wayfare.app/', bases)).toEqual({ kind: 'not-place' });
    expect(parseLink('https://wayfare.app/about', bases)).toEqual({ kind: 'not-place' });
  });

  it('calls a Place link with a broken code a bad link', () => {
    expect(parseLink('https://wayfare.app/p/ABC', bases)).toEqual({ kind: 'bad-link' });
    expect(parseLink('https://wayfare.app/p/', bases)).toEqual({ kind: 'bad-link' });
    expect(parseLink('https://go.wayfare.app/q/QK4V1TCU', bases)).toEqual({ kind: 'bad-link' });
    expect(parseLink('https://wayfare.app/p/QK4V1TCX/extra', bases)).toEqual({ kind: 'bad-link' });
    expect(parseLink('https://wayfare.app/p/%E0%A4%A', bases)).toEqual({ kind: 'bad-link' });
  });
});

describe('checkTypedCode', () => {
  it('reads look-alikes, case, spaces and hyphens silently', () => {
    expect(checkTypedCode('qk4v-1tcx')).toEqual({ ok: true, code: 'QK4V1TCX' });
    expect(checkTypedCode('QK4VITCX')).toEqual({ ok: true, code: 'QK4V1TCX' });
    expect(checkTypedCode('qk4v ltcx')).toEqual({ ok: true, code: 'QK4V1TCX' });
  });

  it('says what is wrong', () => {
    expect(checkTypedCode('QK4V 1T')).toEqual({ ok: false, error: 'short', count: 6 });
    expect(checkTypedCode('QK4V1TCXX')).toEqual({ ok: false, error: 'short', count: 9 });
    expect(checkTypedCode('QK4V1TCU')).toEqual({ ok: false, error: 'letter-u' });
    expect(checkTypedCode('QK4V#TCX')).toEqual({ ok: false, error: 'symbol' });
    expect(checkTypedCode('QK4VÊTCX')).toEqual({ ok: false, error: 'symbol' });
  });
});
