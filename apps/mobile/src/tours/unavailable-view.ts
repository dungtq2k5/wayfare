import { ApiError } from '@wayfare/api-client';

export interface TourAnswer {
  gone: boolean;
  areaCode: string | null;
}

/** Only `404 TOUR_UNAVAILABLE` says a tour is gone (TM5b); any other failure isn't an answer. */
export function goneAnswer(error: unknown): TourAnswer | null {
  if (!(error instanceof ApiError) || error.code !== 'TOUR_UNAVAILABLE') return null;
  const details = error.details as { areaCode?: string } | undefined;
  return { gone: true, areaCode: details?.areaCode ?? null };
}

/**
 * What a tour the phone can't show draws: offline, the offline note; gone, the gone page; a failed
 * ask, the inline alert; while asking, or known but not yet synced, the skeleton (K1).
 */
export function unavailableView(
  offline: boolean,
  answer: { isError: boolean; data?: TourAnswer | undefined },
): 'offline' | 'gone' | 'failed' | 'waiting' {
  if (offline) return 'offline';
  if (answer.data?.gone === true) return 'gone';
  return answer.isError ? 'failed' : 'waiting';
}
