/** What a tour's gate may still wait for: its English text and the request (rdm-spec C-8). */
export type TourGateMissing = 'en.text' | 'activation';

/**
 * A tour's activation gate: the Place's machine on the English **text** only — a tour has no
 * narration of its own (rdm-spec C-8). Open when the `en` text is for the current `content_hash`
 * and publication was requested.
 */
export function tourGate(input: {
  readonly contentHash: string;
  readonly activationRequestedAt: Date | null;
  readonly enSourceContentHash: string | null;
}): { readonly open: boolean; readonly missing: TourGateMissing[] } {
  const missing: TourGateMissing[] = [];
  if (input.enSourceContentHash !== input.contentHash) missing.push('en.text');
  if (input.activationRequestedAt === null) missing.push('activation');
  return { open: missing.length === 0, missing };
}
