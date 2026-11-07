import {
  ANALYTICS_BATCH_MAX,
  AnalyticsEventType,
  EVENT_CLOCK_PAST_MS,
  geohashOf,
  zAnalyticsEvent,
} from '@wayfare/contracts';
import { civilDate } from '../hours/opening-state';
import type { AnalyticsEventProps, AnalyticsTrigger, AudioTier } from '@wayfare/contracts';
import {
  ASK_LIMIT,
  isCounting,
  newerVersion,
  questionOwed,
  restoreAnalyticsState,
  rotationDue,
  SESSION_IDLE_MS,
  stillRemembered,
  STORY_HEARD_MS,
} from './state';
import type { AnalyticsId, AnalyticsState, Question } from './state';

/** The most events the queue keeps; the oldest go first. */
export const QUEUE_MAX_ROWS = 5_000;

/** The most batches an hour, across the install's ids — under the gateway's 60 per id. */
export const BATCHES_PER_HOUR = 40;

/** The most events one `pagehide` send carries: inside browsers' 64 KiB keepalive cap. */
export const PAGEHIDE_MAX_EVENTS = 50;

/** A position is used for a cell only while it's this fresh. */
export const CELL_FIX_MAX_AGE_MS = 5 * 60 * 1000;

/** The backoff after a failed send: 30 s, doubling, at most 30 minutes. */
export const BACKOFF_FIRST_MS = 30_000;
export const BACKOFF_MAX_MS = 30 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

/** One queued event: validated, under the id it was recorded with. */
export interface QueuedEvent {
  readonly id: string;
  readonly analyticsDeviceId: string;
  readonly body: string;
  readonly recordedAt: number;
}

/** The queue's storage: SQLite on Android, IndexedDB on the web. */
export interface AnalyticsQueue {
  add(row: QueuedEvent): Promise<void>;
  /** The oldest rows, oldest first. */
  oldest(limit: number): Promise<QueuedEvent[]>;
  remove(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  /** Drops rows recorded before `before`, then the oldest beyond `max`. */
  trim(before: number, max: number): Promise<void>;
}

/** An answer from the gateway, as much as the client needs of it. */
export type SendResult =
  | { readonly status: 202 | 204 }
  | { readonly status: 400 | 403 }
  | { readonly status: 409; readonly currentVersion: string | null }
  | { readonly status: 429; readonly retryAfterMs: number }
  | { readonly status: 'failed' };

/** The two routes, as each app reaches them. */
export interface AnalyticsTransport {
  consent(body: {
    analyticsDeviceId: string;
    state: 'GRANTED' | 'WITHDRAWN';
    policyVersion: string;
  }): Promise<SendResult>;
  events(
    body: { analyticsDeviceId: string; events: readonly unknown[] },
    options?: { keepalive?: boolean },
  ): Promise<SendResult>;
}

/** What each app supplies. */
export interface AnalyticsDeps {
  load(): Promise<AnalyticsState | null>;
  save(state: AnalyticsState): Promise<void>;
  readonly queue: AnalyticsQueue;
  readonly transport: AnalyticsTransport;
  newId(): string;
  now(): number;
  /** The last position the app already has, and when; null without one. */
  position(): { lat: number; lng: number; at: number } | null;
  /** The app's language now (non-narration events carry it). */
  language(): string;
  /** The privacy version this build ships with. */
  readonly buildPolicyVersion: string;
  /** A `409` named a newer privacy version: the app's own handling (the notice again). */
  onPolicyOutdated?(version: string): void;
  /** A batch the gateway refused as malformed: a client bug, reported. */
  report?(error: Error): void;
}

/** A narration event's own fields. */
export interface NarrationFields {
  readonly placeId: string;
  /** The language the story played in. */
  readonly lang: string;
}

/** What `record` takes: the type's own fields; the client adds the rest. */
export type RecordInput =
  | { type: AnalyticsEventType.APP_OPENED }
  | {
      type: AnalyticsEventType.NARRATION_STARTED;
      narration: NarrationFields;
      trigger: AnalyticsTrigger;
      audioTier: AudioTier;
    }
  | {
      type: AnalyticsEventType.NARRATION_COMPLETED | AnalyticsEventType.NARRATION_ABANDONED;
      narration: NarrationFields;
      listenMs: number;
    }
  | { type: AnalyticsEventType.PLACE_OPENED; placeId: string }
  | { type: AnalyticsEventType.QR_SCANNED; target: 'PLACE' | 'TOUR' }
  | { type: AnalyticsEventType.LANGUAGE_SELECTED; lang: string }
  | {
      type: AnalyticsEventType.PACK_INSTALLED;
      props: AnalyticsEventProps[AnalyticsEventType.PACK_INSTALLED];
    }
  | { type: AnalyticsEventType.SEARCH_PERFORMED; resultCount: number }
  | { type: AnalyticsEventType.TOUR_STARTED; tourId: string };

/** What a screen needs to draw the question and Settings' row. */
export interface AnalyticsSnapshot {
  readonly choice: AnalyticsState['choice'];
  readonly counting: boolean;
  readonly question: Question;
  readonly state: AnalyticsState;
}

const MAX_LISTEN_MS = 24 * 60 * 60 * 1000;

/**
 * The tourist's analytics, shared by Android and the web (40's consent rules, ADR 0042): the
 * consent, the question's timing, the id and its rotation, sessions, the queue's caps and the
 * sender. Each app supplies its storage, its transport and its clock.
 */
export class AnalyticsClient {
  private state: AnalyticsState;
  private readonly listeners = new Set<(snapshot: AnalyticsSnapshot) => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private flushing: Promise<void> | null = null;

  private constructor(
    private readonly deps: AnalyticsDeps,
    state: AnalyticsState,
  ) {
    this.state = state;
  }

  /** The client over what the install remembers. */
  static async open(deps: AnalyticsDeps): Promise<AnalyticsClient> {
    return new AnalyticsClient(
      deps,
      restoreAnalyticsState(await deps.load(), deps.buildPolicyVersion),
    );
  }

  snapshot(): AnalyticsSnapshot {
    return {
      choice: this.state.choice,
      counting: isCounting(this.state),
      question: questionOwed(this.state),
      state: this.state,
    };
  }

  /**
   * Reads the stored state again — another tab of the same browser may have recorded since — and
   * keeps the newest privacy version either knew.
   */
  reload(): Promise<void> {
    return this.change(async (state) => {
      const stored = await this.deps.load();
      return stored === null ? state : restoreAnalyticsState(stored, state.knownPolicyVersion);
    });
  }

  /** How many events wait in the queue (Diagnostics). */
  queued(): Promise<number> {
    return this.deps.queue.count();
  }

  /** Calls `listener` on every change; returns the unsubscribe. */
  subscribe(listener: (snapshot: AnalyticsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** *Allow*, from the question or Settings: a grant at the newest version known, sent now. */
  allow(): Promise<void> {
    return this.change((state, now) => {
      const keep = state.choice === 'GRANTED' && state.current !== null;
      const current = keep ? state.current : this.newAnalyticsId(now);
      return {
        ...state,
        choice: 'GRANTED',
        policyVersion: state.knownPolicyVersion,
        accepted: false,
        grantPending: true,
        asked: 0,
        due: false,
        current,
        remembered: keep ? state.remembered : [...state.remembered, current],
        retryAt: null,
      };
    }).then(() => this.flush());
  }

  /**
   * *No thanks*, or Settings' switch off: nothing more is recorded, the queue emptied at once, and
   * every id of the last 90 days withdrawn — the server deletes their raw events.
   */
  withdraw(): Promise<void> {
    return this.change(async (state, now) => {
      await this.deps.queue.clear();
      const ids = stillRemembered(state.remembered, now).map((id) => id.id);
      return {
        ...state,
        choice: 'WITHDRAWN',
        policyVersion: state.knownPolicyVersion,
        accepted: false,
        grantPending: false,
        asked: 0,
        due: false,
        current: null,
        remembered: [],
        withdrawalsPending: [...new Set([...state.withdrawalsPending, ...ids])],
        retryAt: null,
      };
    }).then(() => this.flush());
  }

  /** The question closed without a choice: two closes and it never shows by itself again. */
  closeQuestion(): Promise<void> {
    return this.change((state) => ({
      ...state,
      asked: Math.min(state.asked + 1, ASK_LIMIT),
      due: false,
    }));
  }

  /** A story ended — played through or stopped — after `soundMs` of sound. */
  storyEnded(soundMs: number): Promise<void> {
    return this.change((state) =>
      state.choice === null && soundMs >= STORY_HEARD_MS && state.asked < ASK_LIMIT && !state.due
        ? { ...state, due: true }
        : state,
    ).then(() => (soundMs > 0 ? this.flush() : undefined));
  }

  /** Makes the first question due without a story — Diagnostics' shortcut. */
  makeDue(): Promise<void> {
    return this.change((state) => ({ ...state, due: true }));
  }

  /** The server named a newer privacy version: known from now on, never forgotten. */
  policyHeard(version: string): Promise<void> {
    return this.change((state) => ({
      ...state,
      knownPolicyVersion: newerVersion(state.knownPolicyVersion, version),
    }));
  }

  /** Pretends the consent was given on an older policy — Diagnostics' shortcut to the new-policy question. */
  pretendPolicyChanged(): Promise<void> {
    return this.change((state) =>
      state.choice === 'GRANTED' ? { ...state, policyVersion: '2000-01-01', asked: 0 } : state,
    );
  }

  /**
   * The app came to the front: a new session, with its `APP_OPENED`, unless something was
   * recorded in the last 30 minutes.
   */
  async foreground(): Promise<void> {
    const now = this.deps.now();
    const last = this.state.lastRecordedAt;
    if (last === null || now - last >= SESSION_IDLE_MS || this.state.sessionId === null) {
      await this.change((state) => ({ ...state, sessionId: this.deps.newId() }));
      await this.record({ type: AnalyticsEventType.APP_OPENED });
    }
    await this.flush();
  }

  /**
   * Records one event while counting — nothing otherwise, and nothing kept for later: the id
   * replaced when it's 30 days old, the session's id, the device clock, a cell from a fix under
   * 5 minutes old (never a coordinate), checked before it's queued.
   */
  record(input: RecordInput): Promise<void> {
    return this.change(async (state, now) => {
      if (!isCounting(state)) return state;
      let next = state;
      if (rotationDue(state.current!, now)) {
        const fresh = this.newAnalyticsId(now);
        next = {
          ...next,
          current: fresh,
          grantPending: true,
          remembered: [...stillRemembered(next.remembered, now), fresh],
        };
      }
      const sessionId = next.sessionId ?? this.deps.newId();
      const event = zAnalyticsEvent.parse({
        id: this.deps.newId(),
        sessionId,
        occurredAt: isoTime(now),
        ...this.fields(input),
        ...this.cell(now),
      });
      await this.deps.queue.add({
        id: event.id,
        analyticsDeviceId: next.current!.id,
        body: JSON.stringify(event),
        recordedAt: now,
      });
      await this.deps.queue.trim(now - EVENT_CLOCK_PAST_MS, QUEUE_MAX_ROWS);
      return {
        ...next,
        sessionId,
        lastRecordedAt: now,
        current: { ...next.current!, lastUsedAt: now },
        remembered: next.remembered.map((id) =>
          id.id === next.current!.id ? { ...id, lastUsedAt: now } : id,
        ),
      };
    });
  }

  /**
   * Sends what's owed, one request at a time: withdrawals, then the current id's grant, then
   * batches of one id, oldest first — at most 40 an hour, backing off after a failure. Never
   * throws; a second call while one runs joins it.
   */
  flush(options: { keepalive?: boolean } = {}): Promise<void> {
    if (options.keepalive === true) return this.sendOnce(true).then(() => undefined);
    this.flushing ??= this.drain().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** Empties what this install sends and forgets: *Forget this install*, after a withdrawal. */
  async forget(): Promise<void> {
    await this.withdraw();
    await this.change(async (state) => {
      await this.deps.queue.clear();
      return restoreAnalyticsState(null, state.knownPolicyVersion);
    });
  }

  private async drain(): Promise<void> {
    for (let rounds = 0; rounds < 100; rounds++) {
      const sent = await this.sendOnce(false);
      if (!sent) return;
    }
  }

  /** One request, if one is owed and allowed now; whether the next may follow at once. */
  private async sendOnce(keepalive: boolean): Promise<boolean> {
    const now = this.deps.now();
    const state = this.state;
    if (!keepalive && state.retryAt !== null && now < state.retryAt) return false;
    const [withdrawal] = state.withdrawalsPending;
    if (withdrawal !== undefined) {
      const result = await this.deps.transport.consent({
        analyticsDeviceId: withdrawal,
        state: 'WITHDRAWN',
        policyVersion: state.knownPolicyVersion,
      });
      return this.settle(result, 'withdrawal', (next) => ({
        ...next,
        withdrawalsPending: next.withdrawalsPending.filter((id) => id !== withdrawal),
      }));
    }
    if (state.choice !== 'GRANTED' || state.current === null || state.policyVersion === null)
      return false;
    if (state.grantPending) {
      const grantedId = state.current.id;
      const result = await this.deps.transport.consent({
        analyticsDeviceId: grantedId,
        state: 'GRANTED',
        policyVersion: state.policyVersion,
      });
      return this.settle(result, 'grant', (next) =>
        next.current?.id === grantedId ? { ...next, grantPending: false, accepted: true } : next,
      );
    }
    const recent = state.sentAt.filter((at) => now - at < HOUR_MS);
    if (recent.length >= BATCHES_PER_HOUR) return false;
    const rows = await this.deps.queue.oldest(
      keepalive ? PAGEHIDE_MAX_EVENTS : ANALYTICS_BATCH_MAX * 3,
    );
    const first = rows[0];
    if (first === undefined) return false;
    const limit = keepalive ? PAGEHIDE_MAX_EVENTS : ANALYTICS_BATCH_MAX;
    const batch = rows
      .filter((row) => row.analyticsDeviceId === first.analyticsDeviceId)
      .slice(0, limit);
    const result = await this.deps.transport.events(
      {
        analyticsDeviceId: first.analyticsDeviceId,
        events: batch.map((row) => JSON.parse(row.body) as unknown),
      },
      { keepalive },
    );
    if (result.status === 202 || result.status === 400) {
      await this.deps.queue.remove(batch.map((row) => row.id));
      if (result.status === 400)
        this.deps.report?.(new Error('analytics batch refused as malformed'));
    }
    return this.settle(result, 'events', (next) => ({
      ...next,
      sentAt: [...next.sentAt.filter((at) => now - at < HOUR_MS), now],
    }));
  }

  /** Folds one answer into the state; whether the next request may follow at once. */
  private async settle(
    result: SendResult,
    what: string,
    onSuccess: (state: AnalyticsState) => AnalyticsState,
  ): Promise<boolean> {
    let more = false;
    await this.change((state, now) => {
      const base = { ...state, lastSend: `${what}: ${result.status}` };
      switch (result.status) {
        case 202:
        case 204:
          more = true;
          return { ...onSuccess(base), retryAt: null, failures: 0 };
        case 400:
          more = true;
          return onSuccess(base);
        case 403:
          // The server's gate refused: re-grant, and a newer policy shows itself as a 409.
          return { ...base, accepted: false, grantPending: true };
        case 409: {
          if (result.currentVersion !== null) this.deps.onPolicyOutdated?.(result.currentVersion);
          return {
            ...base,
            grantPending: false,
            knownPolicyVersion:
              result.currentVersion === null
                ? base.knownPolicyVersion
                : newerVersion(base.knownPolicyVersion, result.currentVersion),
          };
        }
        case 429:
          return { ...base, retryAt: now + result.retryAfterMs };
        default: {
          const failures = base.failures + 1;
          const wait = Math.min(BACKOFF_FIRST_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
          return { ...base, failures, retryAt: now + wait };
        }
      }
    });
    return more;
  }

  private newAnalyticsId(now: number): AnalyticsId {
    return { id: this.deps.newId(), createdAt: now, lastUsedAt: now };
  }

  private fields(input: RecordInput): Record<string, unknown> {
    switch (input.type) {
      case AnalyticsEventType.NARRATION_STARTED:
        return {
          type: input.type,
          placeId: input.narration.placeId,
          lang: input.narration.lang,
          trigger: input.trigger,
          audioTier: input.audioTier,
        };
      case AnalyticsEventType.NARRATION_COMPLETED:
      case AnalyticsEventType.NARRATION_ABANDONED:
        return {
          type: input.type,
          placeId: input.narration.placeId,
          lang: input.narration.lang,
          listenMs: Math.min(Math.max(Math.round(input.listenMs), 0), MAX_LISTEN_MS),
        };
      case AnalyticsEventType.PLACE_OPENED:
        return { type: input.type, placeId: input.placeId, lang: this.deps.language() };
      case AnalyticsEventType.QR_SCANNED:
        return { type: input.type, lang: this.deps.language(), props: { target: input.target } };
      case AnalyticsEventType.LANGUAGE_SELECTED:
        return { type: input.type, lang: input.lang };
      case AnalyticsEventType.PACK_INSTALLED:
        return { type: input.type, lang: this.deps.language(), props: input.props };
      case AnalyticsEventType.SEARCH_PERFORMED:
        return {
          type: input.type,
          lang: this.deps.language(),
          props: { resultCount: input.resultCount },
        };
      case AnalyticsEventType.TOUR_STARTED:
        return { type: input.type, lang: this.deps.language(), props: { tourId: input.tourId } };
      default:
        return { type: input.type, lang: this.deps.language() };
    }
  }

  /** The cell of a fix under 5 minutes old — only the cell; nothing else of the position. */
  private cell(now: number): { cell?: string } {
    const fix = this.deps.position();
    if (fix === null || now - fix.at > CELL_FIX_MAX_AGE_MS) return {};
    return { cell: geohashOf(fix.lat, fix.lng) };
  }

  /** Applies one change after the ones before it, saves it, tells the listeners. */
  private change(
    step: (state: AnalyticsState, now: number) => AnalyticsState | Promise<AnalyticsState>,
  ): Promise<void> {
    const run = this.chain.then(async () => {
      const next = await step(this.state, this.deps.now());
      if (next === this.state) return;
      this.state = next;
      await this.deps.save(next);
      const snapshot = this.snapshot();
      for (const listener of this.listeners) listener(snapshot);
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

/** Epoch ms → `YYYY-MM-DDTHH:mm:ss.sssZ`, as `Date#toISOString` writes it (core keeps off `Date`). */
export function isoTime(ms: number): string {
  const day = 86_400_000;
  const days = Math.floor(ms / day);
  const rest = ms - days * day;
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const time = `${pad(Math.floor(rest / 3_600_000))}:${pad(Math.floor(rest / 60_000) % 60)}:${pad(Math.floor(rest / 1_000) % 60)}.${pad(rest % 1_000, 3)}`;
  return `${civilDate(days)}T${time}Z`;
}
