import { compareStrings } from './sorting';

/**
 * Normalizes user text before validation, hashing and storage (conventions §11.1): line endings
 * become `\n`, then NFC; runs of other whitespace collapse to one space; each line loses its
 * trailing whitespace; three or more newlines become two; the whole is trimmed. Paragraphs survive.
 */
export function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Thrown for a value JSON cannot express the same way twice. */
export class CanonicalJsonError extends Error {
  constructor(path: string, reason: string) {
    super(`canonicalJson: ${reason} at ${path || '(root)'}`);
    this.name = 'CanonicalJsonError';
  }
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function canonical(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(normalizeText(value));
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError(path, 'a non-finite number');
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value
          .map((item, index) => {
            if (item === undefined)
              throw new CanonicalJsonError(`${path}[${index}]`, 'undefined in an array');
            return canonical(item, `${path}[${index}]`);
          })
          .join(',')}]`;
      }
      if (!isPlainObject(value)) {
        throw new CanonicalJsonError(
          path,
          `a ${value.constructor.name} (pass plain data; a Date as its ISO string)`,
        );
      }
      const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined) // an unset optional field is not a content change
        .toSorted(([a], [b]) => compareStrings(a, b));
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, `${path}.${key}`)}`).join(',')}}`;
    }
    default:
      throw new CanonicalJsonError(path, `a ${typeof value}`);
  }
}

/**
 * JSON with object keys sorted at every depth and every string passed through `normalizeText`,
 * so equal content serializes identically — the input to `contentHash` (conventions §11.1).
 */
export function canonicalJson(value: unknown): string {
  return canonical(value, '');
}
