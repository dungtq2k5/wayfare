import { canonicalJson } from '@wayfare/contracts';
import { sha256Hex } from './tokens';

/**
 * SHA-256 hex of `canonicalJson(value)` — the only content hash (conventions §11.1, rdm-spec C-1).
 * Key order, Unicode normalization and whitespace-only edits do not change it.
 */
export function contentHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
