import { describe, expect, it } from 'vitest';
import { checkTypedCode, formatTyping } from './typed';

describe('a code typed by hand (WQ5)', () => {
  it('forgives lower case, spaces and hyphens, and reads O, I and L as 0, 1 and 1', () => {
    expect(checkTypedCode('k7m2-9qxb')).toEqual({ ok: true, code: 'K7M29QXB' });
    expect(checkTypedCode('z63t cmmt')).toEqual({ ok: true, code: 'Z63TCMMT' });
    expect(checkTypedCode('oilo0000')).toEqual({ ok: true, code: '01100000' });
  });

  it('says how many characters there are, and that codes never use a U', () => {
    expect(checkTypedCode('K7M2 9QX')).toEqual({ ok: false, error: 'short', count: 7 });
    expect(checkTypedCode('K7M2 9QXU')).toEqual({ ok: false, error: 'letter-u' });
    expect(checkTypedCode('K7M2 9Q!B')).toEqual({ ok: false, error: 'symbol' });
  });

  it('formats as 4 + 4 while typing, upper case', () => {
    expect(formatTyping('k7m29q')).toBe('K7M2 9Q');
    expect(formatTyping('k7m2')).toBe('K7M2');
    expect(formatTyping('k7-m2 9qxb')).toBe('K7M2 9QXB');
  });
});
