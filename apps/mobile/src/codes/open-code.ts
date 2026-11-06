import { ApiError } from '@wayfare/api-client';
import type { CodeResult } from './store';

/** A Place a code resolved to, with what the Map and the player need. */
export interface ResolvedPlace<P> {
  readonly id: string;
  readonly areaId: string | null;
  readonly location: { readonly lat: number; readonly lng: number };
  /** What the player takes (a `PlayerPlace` in the app). */
  readonly player: P;
}

/** The world `openCode` acts on, injected so the specs can drive every branch. */
export interface OpenCodeDeps<P> {
  /** The phone's own record of the code, in the current language, or null. */
  findLocal(code: string): Promise<ResolvedPlace<P> | null>;
  /** `GET /places/by-code/:code`; throws the API's error. */
  fetchByCode(code: string): Promise<ResolvedPlace<P>>;
  online(): boolean;
  /** The id of the Place the player holds, or null. */
  playingId(): string | null;
  play(place: P): void;
  /** The same Place again: the toast with *Start over*. */
  alreadyPlaying(): void;
  /** Moves the Map to the Place and opens its sheet at half. */
  reveal(place: ResolvedPlace<P>): void;
  /** The result sheet, or null to close it. */
  show(result: CodeResult | null): void;
  /** Counts a sticker scan, not awaited. */
  count(code: string): void;
  /** The id of the phone's own tour with this code, or null. */
  findLocalTour(code: string): Promise<string | null>;
  /** `GET /codes/:code`: what the code names; throws the API's error. */
  resolve(code: string): Promise<{ readonly type: 'PLACE' | 'TOUR'; readonly id: string }>;
  /** Opens a tour's screen, which answers for a tour no longer shown itself. */
  openTour(id: string, code: string): void;
}

/** What a failed lookup means for the tourist. */
export function resultOf(error: unknown, code: string): CodeResult {
  if (error instanceof ApiError && error.code === 'PLACE_UNAVAILABLE') {
    return { kind: 'no-longer', code };
  }
  if (error instanceof ApiError && error.status === 404) return { kind: 'no-such-code', code };
  return { kind: 'offline', code };
}

/**
 * Every way into a code ends here: the scanner, the typed code and links. The phone's own data first,
 * so a synced Place opens offline; otherwise the gateway, behind *Looking up*. A Place opens on the
 * Map and plays as a manual start, a tour's code opens its screen; the Place already playing carries on. A late answer after
 * *Cancel* is dropped, and a second call for the code being resolved is ignored.
 */
export function createCodeOpener<P>(deps: OpenCodeDeps<P>) {
  let sequence = 0;
  let resolving: string | null = null;

  const opened = (place: ResolvedPlace<P>) => {
    deps.show(null);
    deps.reveal(place);
    if (deps.playingId() === place.id) deps.alreadyPlaying();
    else deps.play(place.player);
  };

  return {
    async open(code: string, options: { printed: boolean; tour?: boolean }): Promise<void> {
      if (resolving === code) return;
      const mine = ++sequence;
      resolving = code;
      try {
        // ponytail: a scan resolved offline is not counted; a queue would replay it later.
        if (options.printed && deps.online()) deps.count(code);
        const local = await deps.findLocal(code);
        if (mine !== sequence) return;
        if (local !== null) return opened(local);
        const tour = await deps.findLocalTour(code);
        if (mine !== sequence) return;
        if (tour !== null) {
          deps.show(null);
          return deps.openTour(tour, code);
        }
        if (!deps.online()) {
          return deps.show(
            options.tour === true
              ? { kind: 'offline', code, tour: true }
              : { kind: 'offline', code },
          );
        }
        deps.show({ kind: 'looking-up', code });
        let fetched: ResolvedPlace<P>;
        try {
          // One code space: the resolver says whether the code is a Place's or a tour's.
          const target = await deps.resolve(code);
          if (mine !== sequence) return;
          if (target.type === 'TOUR') {
            deps.show(null);
            return deps.openTour(target.id, code);
          }
          fetched = await deps.fetchByCode(code);
        } catch (error) {
          if (mine === sequence) {
            const result = resultOf(error, code);
            // A tour's link whose lookup found no network: the tour's words, not a Place's (TM6c).
            deps.show(
              result.kind === 'offline' && options.tour === true
                ? { ...result, tour: true }
                : result,
            );
          }
          return;
        }
        if (mine === sequence) opened(fetched);
      } finally {
        if (mine === sequence) resolving = null;
      }
    },
    /** *Cancel* on *Looking up*: whatever answers later is dropped. */
    cancel(): void {
      sequence += 1;
      resolving = null;
      deps.show(null);
    },
  };
}
