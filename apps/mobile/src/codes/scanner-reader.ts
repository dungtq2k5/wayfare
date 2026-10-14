import { LINK_BASE_URL, QR_BASE_URL } from '../env';
import { parseLink } from './parse';
import type { ParsedLink } from './parse';

/** What the scanner does with a text it read. */
export type ScanOutcome =
  /** Open it (a code, or a broken Place link whose sheet explains). */
  | {
      readonly kind: 'open';
      readonly parsed: Exclude<ParsedLink, { kind: 'not-wayfare' | 'not-place' }>;
    }
  /** Say "not a Wayfare code" — unless this same text was just said. */
  | { readonly kind: 'not-wayfare'; readonly repeat: boolean };

/**
 * One read text, judged. Anything but a Wayfare code or a broken Wayfare Place link is "not a
 * Wayfare code", and its link is never opened; the same text held in view is not said twice.
 */
export function judgeScan(text: string, lastRejected: string | null): ScanOutcome {
  const parsed = parseLink(text, { qr: QR_BASE_URL, link: LINK_BASE_URL });
  if (parsed.kind === 'code' || parsed.kind === 'bad-link') return { kind: 'open', parsed };
  return { kind: 'not-wayfare', repeat: text === lastRejected };
}
