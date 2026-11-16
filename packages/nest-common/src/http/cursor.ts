import { isUuidV7 } from '@wayfare/contracts';

/** Upper bound of a cursor's sort key. */
const MAX_SORT_KEY_LENGTH = 64;

/**
 * What a cursor carries: the last row's id, and — for a list not ordered by id alone — its sort
 * key (conventions §5.5). Opaque to clients, who never parse it.
 */
export interface CursorPosition {
  readonly id: string;
  /** The last row's sort value, as the list serializes it (e.g. an ISO instant). */
  readonly key?: string;
}

/** Encodes a position as base64url JSON. */
export function encodeCursor(position: CursorPosition): string {
  const body =
    position.key === undefined ? { id: position.id } : { id: position.id, k: position.key };
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor; `null` for anything malformed or not naming a UUIDv7 — the caller answers
 * `400 VALIDATION_FAILED` at `/cursor`. A list that needs a sort key checks it is present and
 * well-formed itself.
 */
export function decodeCursor(value: string): CursorPosition | null {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { id, k } = parsed as { id?: unknown; k?: unknown };
    if (!isUuidV7(id)) return null;
    if (k === undefined) return { id };
    return typeof k === 'string' && k.length <= MAX_SORT_KEY_LENGTH ? { id, key: k } : null;
  } catch {
    return null;
  }
}
