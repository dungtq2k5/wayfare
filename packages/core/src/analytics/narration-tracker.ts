import { AnalyticsEventType } from '@wayfare/contracts';
import type { AnalyticsTrigger, AudioTier } from '@wayfare/contracts';
import type { AnalyticsClient } from './client';
import { ListenClock } from './listen-clock';

interface Tracked {
  readonly placeId: string;
  readonly lang: string;
  readonly trigger: AnalyticsTrigger;
  readonly clock: ListenClock;
}

/**
 * What a player tells analytics about its one narration (rdm-spec A-2, A-4): the start at the
 * first sound — never at the request — with how it entered the player and where the sound came
 * from; the end, played through or not, with the time that actually sounded. A story that never
 * sounded records nothing. Its end also tells the consent question a story was heard.
 */
export class NarrationTracker {
  private current: Tracked | null = null;

  constructor(
    private readonly client: () => Promise<AnalyticsClient>,
    private readonly now: () => number,
  ) {}

  /** A narration was asked for; one that was playing ends as abandoned. */
  begin(placeId: string, lang: string, trigger: AnalyticsTrigger): void {
    this.end(false);
    this.current = { placeId, lang, trigger, clock: new ListenClock() };
  }

  /** Sound is playing — from `tier`, the first time. Repeated calls are harmless. */
  sounding(tier: AudioTier): void {
    const current = this.current;
    if (current === null || !current.clock.sounding(this.now())) return;
    this.send((client) =>
      client.record({
        type: AnalyticsEventType.NARRATION_STARTED,
        narration: { placeId: current.placeId, lang: current.lang },
        trigger: current.trigger,
        audioTier: tier,
      }),
    );
  }

  /** Sound stopped for a while: paused, buffering, between voices. */
  silent(): void {
    this.current?.clock.silent(this.now());
  }

  /** The narration ended: `completed` when it played to its end. */
  end(completed: boolean): void {
    const ended = this.current;
    this.current = null;
    if (ended === null) return;
    const at = this.now();
    ended.clock.silent(at);
    const listenMs = ended.clock.listened(at);
    this.send(async (client) => {
      if (ended.clock.hasSounded) {
        await client.record({
          type: completed
            ? AnalyticsEventType.NARRATION_COMPLETED
            : AnalyticsEventType.NARRATION_ABANDONED,
          narration: { placeId: ended.placeId, lang: ended.lang },
          listenMs,
        });
      }
      await client.storyEnded(listenMs);
    });
  }

  private send(step: (client: AnalyticsClient) => Promise<void>): void {
    void this.client()
      .then(step)
      .catch(() => undefined);
  }
}
