import { isUuidV7 } from '@wayfare/contracts';

/** What a cursor carries: the last row's id. Opaque to clients, who never parse it (conventions §5.5). */
export interface CursorPosition {
  readonly id: string;
}

/** Encodes a position as base64url JSON. */
export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify({ id: position.id }), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor; `null` for anything malformed or not naming a UUIDv7 — the caller answers
 * `400 VALIDATION_FAILED` at `/cursor`.
 */
export function decodeCursor(value: string): CursorPosition | null {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { id } = parsed as { id?: unknown };
    return isUuidV7(id) ? { id } : null;
  } catch {
    return null;
  }
}
