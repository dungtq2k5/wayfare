/** A story's stored audio, as the API serves it. */
export interface StoredAudio {
  readonly url: string;
  readonly durationMs: number;
}

/** The steps of the source ladder, best first (K6, product §F3). */
export type Rung = 'file' | 'on-demand' | 'stream' | 'voice';

export type OnDemandAnswer =
  | { readonly status: 'READY'; readonly audio: StoredAudio }
  | { readonly status: 'PENDING'; readonly retryAfterMs: number }
  | { readonly status: 'UNAVAILABLE' };

export interface LadderDeps {
  /** True once the tourist moved on (another story, another language): the answer is dropped. */
  stale(): boolean;
  isOffline(): boolean;
  /** Whether the service worker holds the file (it plays offline then). */
  isCached(url: string): Promise<boolean>;
  /** Rejects with the API client's error (`status`, `code`). */
  onDemand(): Promise<OnDemandAnswer>;
  status(): Promise<StoredAudio | null>;
  hasVoice(): boolean;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** `NARRATION_CONFIG.onDemandWaitMs` — 5 s (product §9). */
  onDemandWaitMs: number;
  /** Called once a story is being made, so WN3 shows while the ladder waits. */
  onPreparing(): void;
}

/** Where the ladder landed. A file names its rung: the Place's own (`T1`) or made on demand (`T1_5`). */
export type Resolution =
  | { readonly kind: 'file'; readonly audio: StoredAudio; readonly tier: 'T1' | 'T1_5' }
  | { readonly kind: 'stream' }
  | { readonly kind: 'voice'; readonly offline: boolean }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'discarded' };

function failureOf(error: unknown): { status: number; code: string } {
  const e = error as { status?: number; code?: string } | null;
  return { status: e?.status ?? 0, code: e?.code ?? 'NETWORK_ERROR' };
}

/**
 * Finds the best source (K6): the stored file (offline only when the browser kept it), the
 * server's on-demand audio — waiting at most `onDemandWaitMs` for it — the live stream, then the
 * browser's own voice. Every await is followed by a staleness check, so a slow answer for a story
 * no longer wanted is dropped, never played.
 */
export async function resolveSource(
  audio: StoredAudio | null,
  deps: LadderDeps,
): Promise<Resolution> {
  let rung: Rung = audio === null ? 'on-demand' : 'file';
  for (;;) {
    if (deps.stale()) return { kind: 'discarded' };
    switch (rung) {
      case 'file': {
        if (!deps.isOffline() || (await deps.isCached(audio!.url))) {
          return deps.stale() ? { kind: 'discarded' } : { kind: 'file', audio: audio!, tier: 'T1' };
        }
        rung = 'voice';
        break;
      }
      case 'on-demand': {
        if (deps.isOffline()) {
          rung = 'voice';
          break;
        }
        deps.onPreparing();
        let answer: OnDemandAnswer;
        try {
          answer = await deps.onDemand();
        } catch (error) {
          const failure = failureOf(error);
          if (failure.status === 404) return { kind: 'unavailable' };
          rung =
            failure.code === 'LANGUAGE_NOT_ENTITLED' || failure.status === 0 ? 'voice' : 'stream';
          break;
        }
        if (deps.stale()) return { kind: 'discarded' };
        if (answer.status === 'UNAVAILABLE') {
          rung = 'voice';
          break;
        }
        let made: StoredAudio | null = answer.status === 'READY' ? answer.audio : null;
        if (answer.status === 'PENDING') {
          const deadline = deps.now() + deps.onDemandWaitMs;
          while (made === null && deps.now() < deadline) {
            await deps.sleep(Math.min(answer.retryAfterMs, Math.max(0, deadline - deps.now())));
            if (deps.stale()) return { kind: 'discarded' };
            try {
              made = await deps.status();
            } catch {
              break;
            }
          }
        }
        // The wait ran out (planned) or the status read failed: read it live instead.
        if (made === null) {
          rung = 'stream';
          break;
        }
        return deps.stale() ? { kind: 'discarded' } : { kind: 'file', audio: made, tier: 'T1_5' };
      }
      case 'stream':
        if (deps.isOffline()) {
          rung = 'voice';
          break;
        }
        return { kind: 'stream' };
      case 'voice':
        return deps.hasVoice()
          ? { kind: 'voice', offline: deps.isOffline() }
          : { kind: 'unavailable' };
    }
  }
}
