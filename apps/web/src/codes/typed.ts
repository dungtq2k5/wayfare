import { canonicalPublicCode, PUBLIC_CODE_LENGTH } from '@wayfare/contracts';

/** What *Open* does with a typed code: open it, or say what is wrong with it. */
export type TypedCheck =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly error: 'short'; readonly count: number }
  | { readonly ok: false; readonly error: 'letter-u' | 'symbol' };

/**
 * The typed code's rules: spaces and hyphens dropped, then too short, a U (codes never use it), or
 * anything that is not a letter or a number. O, I and L are read as 0, 1 and 1 without a word, by
 * the same function the gateway uses.
 */
export function checkTypedCode(value: string): TypedCheck {
  const bare = value.replace(/[\s-]/g, '').toUpperCase();
  if (/[^A-Z0-9]/.test(bare)) return { ok: false, error: 'symbol' };
  if (bare.includes('U')) return { ok: false, error: 'letter-u' };
  if (bare.length !== PUBLIC_CODE_LENGTH) return { ok: false, error: 'short', count: bare.length };
  const code = canonicalPublicCode(bare);
  return code === null ? { ok: false, error: 'symbol' } : { ok: true, code };
}

/** The field's value as typed (WQ5): upper case, two groups of four, at most eight. */
export function formatTyping(value: string): string {
  const bare = value.replace(/[\s-]/g, '').toUpperCase().slice(0, 8);
  return bare.length > 4 ? `${bare.slice(0, 4)} ${bare.slice(4)}` : bare;
}
