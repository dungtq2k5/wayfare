import type { Language } from '@wayfare/contracts';
import type { PlaceAudio, PlayerPlace } from './types';

/** The steps of the source ladder, best first (product §F3). */
export type Rung = 'file' | 'on-demand' | 'stream' | 'device';

/** What a route answered: `status` is the HTTP status, `code` the envelope's. */
export interface RouteFailure {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
}

export type OnDemandAnswer =
  | { readonly status: 'READY'; readonly audio: PlaceAudio }
  | { readonly status: 'PENDING'; readonly retryAfterMs: number }
  | { readonly status: 'UNAVAILABLE' };

export interface LadderDeps {
  /** The language being heard now: a result for any other is dropped (conventions §12.3). */
  currentLang(): Language;
  isOffline(): boolean;
  /** Rejects with a `RouteFailure` (the API client's `ApiError` has the same fields). */
  onDemand(placeId: string, lang: Language): Promise<OnDemandAnswer>;
  status(placeId: string, lang: Language): Promise<PlaceAudio | null>;
  /** The file's uri when it is in the cache already. */
  cachedFile(place: PlayerPlace, audio: PlaceAudio, lang: Language): Promise<string | null>;
  /** Downloads into the cache and verifies its hash; rejects on a failure or a mismatch. */
  download(place: PlayerPlace, audio: PlaceAudio, lang: Language): Promise<string>;
  hasDeviceVoice(lang: Language): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** `NARRATION_CONFIG.onDemandWaitMs`. */
  onDemandWaitMs: number;
}

/** Where the ladder landed. `fellBack` is true when a source that was tried failed. */
export type Resolution =
  | { readonly kind: 'file'; readonly uri: string; readonly fellBack: boolean }
  | { readonly kind: 'stream'; readonly fellBack: boolean }
  | { readonly kind: 'device'; readonly fellBack: boolean }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'discarded' };

/** The rung below `rung`, for a source that failed while playing. */
export function rungBelow(rung: 'file' | 'stream'): Rung {
  return rung === 'file' ? 'stream' : 'device';
}

function failureOf(error: unknown): RouteFailure {
  const e = error as Partial<RouteFailure> | null;
  return { status: e?.status ?? 0, code: e?.code ?? 'NETWORK_ERROR', details: e?.details };
}

/**
 * Finds the best source from `start` down (product §F3): the file (cached, else downloaded), the
 * server's on-demand audio (waiting at most `onDemandWaitMs` for it), the live stream, the device
 * voice. Which answer moves it is spelled out where each rung handles it. Every await is followed
 * by a language check, so a slow answer for a language no longer heard is dropped, never played.
 */
export async function resolveSource(
  place: PlayerPlace,
  lang: Language,
  start: Rung,
  deps: LadderDeps,
  startedFellBack = false,
): Promise<Resolution> {
  let rung: Rung = start;
  let fellBack = startedFellBack;
  const stale = () => deps.currentLang() !== lang;
  const fileFrom = async (audio: PlaceAudio): Promise<Resolution | null> => {
    try {
      const uri =
        (await deps.cachedFile(place, audio, lang)) ?? (await deps.download(place, audio, lang));
      return stale() ? { kind: 'discarded' } : { kind: 'file', uri, fellBack };
    } catch {
      return null;
    }
  };

  for (;;) {
    if (stale()) return { kind: 'discarded' };
    switch (rung) {
      case 'file': {
        if (place.audio === null) {
          rung = 'on-demand';
          break;
        }
        const resolved = await fileFrom(place.audio);
        if (resolved !== null) return resolved;
        fellBack = true;
        rung = deps.isOffline() ? 'device' : 'stream';
        break;
      }
      case 'on-demand': {
        if (deps.isOffline()) {
          rung = 'device';
          break;
        }
        let answer: OnDemandAnswer;
        try {
          answer = await deps.onDemand(place.id, lang);
        } catch (error) {
          const failure = failureOf(error);
          if (failure.status === 404) return { kind: 'unavailable' };
          if (failure.code === 'LANGUAGE_NOT_ENTITLED') {
            rung = 'device';
            break;
          }
          fellBack = true;
          rung = 'stream';
          break;
        }
        if (stale()) return { kind: 'discarded' };
        if (answer.status === 'UNAVAILABLE') {
          rung = 'device';
          break;
        }
        let audio: PlaceAudio | null = answer.status === 'READY' ? answer.audio : null;
        if (answer.status === 'PENDING') {
          const deadline = deps.now() + deps.onDemandWaitMs;
          let wait = answer.retryAfterMs;
          while (audio === null && deps.now() < deadline) {
            await deps.sleep(Math.min(wait, Math.max(0, deadline - deps.now())));
            if (stale()) return { kind: 'discarded' };
            try {
              audio = await deps.status(place.id, lang);
            } catch {
              break;
            }
            wait = answer.retryAfterMs;
          }
        }
        if (audio === null) {
          // The wait ran out (planned) or the status route failed: stream instead.
          rung = 'stream';
          break;
        }
        const resolved = await fileFrom(audio);
        if (resolved !== null) return resolved;
        fellBack = true;
        rung = 'stream';
        break;
      }
      case 'stream':
        if (deps.isOffline()) {
          rung = 'device';
          break;
        }
        return { kind: 'stream', fellBack };
      case 'device': {
        const voice = await deps.hasDeviceVoice(lang);
        if (stale()) return { kind: 'discarded' };
        return voice ? { kind: 'device', fellBack } : { kind: 'unavailable' };
      }
    }
  }
}
