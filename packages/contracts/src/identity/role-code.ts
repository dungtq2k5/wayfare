import { MAX_ROLE_CODE_LENGTH } from './limits';

const PREFIX = 'CUSTOM_';
/** The highest collision suffix tried (`_99`). */
const MAX_SUFFIX = 99;
/** Room left for the name once the prefix and the longest suffix fit (rdm-spec I-4 `code`). */
const MAX_BASE_LENGTH = MAX_ROLE_CODE_LENGTH - PREFIX.length - `_${MAX_SUFFIX}`.length;
/** The base of a name that folds to nothing. */
const FALLBACK_BASE = 'ROLE';

/**
 * A custom role's code from its display name (rdm-spec I-4): Vietnamese folded to ASCII, upper
 * snake case, `CUSTOM_` in front, short enough that any collision suffix still fits the column.
 * `"Đặng Bảo"` → `CUSTOM_DANG_BAO`.
 */
export function roleCodeFromName(name: string): string {
  // NFD does not decompose đ/Đ, so they are mapped first.
  const folded = name
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'D')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const base = folded.slice(0, MAX_BASE_LENGTH).replace(/_$/, '');
  return `${PREFIX}${base === '' ? FALLBACK_BASE : base}`;
}

/** The codes tried in order for a new role: `code`, then `code_2` … `code_99`. */
export function* roleCodeCandidates(code: string): Generator<string> {
  yield code;
  for (let suffix = 2; suffix <= MAX_SUFFIX; suffix++) yield `${code}_${suffix}`;
}
