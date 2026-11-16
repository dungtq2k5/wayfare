import { ANALYTICS_ID_ROTATION_DAYS, RAW_EVENT_RETENTION_DAYS } from '@wayfare/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an id is used before the next event replaces it (ADR 0042). */
export const ANALYTICS_ID_ROTATION_MS = ANALYTICS_ID_ROTATION_DAYS * DAY_MS;

/** How long the app remembers an id it used: the server may still hold its raw events. */
export const ANALYTICS_ID_MEMORY_MS = RAW_EVENT_RETENTION_DAYS * DAY_MS;

/** A session ends after this long with nothing recorded (rdm-spec A-2's `session_id`). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

/** A story counts as heard — and makes the question due — after this much sound. */
export const STORY_HEARD_MS = 1_000;

/** Closing the question without a choice this many times stops it showing by itself. */
export const ASK_LIMIT = 2;

/** The tourist's decision: none yet, yes, or no. */
export type ConsentChoice = 'GRANTED' | 'WITHDRAWN' | null;

/** An analytics id, when it was made, and when it was last used. */
export interface AnalyticsId {
  readonly id: string;
  readonly createdAt: number;
  readonly lastUsedAt: number;
}

/**
 * What the install remembers about analytics — one value in its key-value store, never beside the
 * device credentials (ADR 0042).
 */
export interface AnalyticsState {
  /** The choice, and the privacy policy version it was made against. */
  readonly choice: ConsentChoice;
  readonly policyVersion: string | null;
  /** True once the server accepted the grant for the current id: until then nothing is recorded. */
  readonly accepted: boolean;
  /** Showings of the question closed without a choice. */
  readonly asked: number;
  /** A heard story made the first question due. */
  readonly due: boolean;
  /** The newest privacy version the app has heard of: the build's, raised by the server, never lowered. */
  readonly knownPolicyVersion: string;
  /** The id events are recorded under; null without a grant. */
  readonly current: AnalyticsId | null;
  /** The current id's grant still to post: a new choice, a rotation, a policy's re-grant. */
  readonly grantPending: boolean;
  /** Every id used in the last 90 days, the current one included. */
  readonly remembered: readonly AnalyticsId[];
  /** Ids whose withdrawal is still to post. */
  readonly withdrawalsPending: readonly string[];
  /** The session events carry, and when the last event was recorded. */
  readonly sessionId: string | null;
  readonly lastRecordedAt: number | null;
  /** The sender's pace and backoff. */
  readonly sentAt: readonly number[];
  readonly retryAt: number | null;
  readonly failures: number;
  /** The last send's outcome, for Diagnostics. */
  readonly lastSend: string | null;
}

/** A fresh install's state: nothing chosen, the build's privacy version known. */
export function initialAnalyticsState(buildPolicyVersion: string): AnalyticsState {
  return {
    choice: null,
    policyVersion: null,
    accepted: false,
    asked: 0,
    due: false,
    knownPolicyVersion: buildPolicyVersion,
    current: null,
    grantPending: false,
    remembered: [],
    withdrawalsPending: [],
    sessionId: null,
    lastRecordedAt: null,
    sentAt: [],
    retryAt: null,
    failures: 0,
    lastSend: null,
  };
}

/**
 * A stored state read back over the build's: a newer build's privacy version raises the known one,
 * a launch never lowers it.
 */
export function restoreAnalyticsState(
  stored: AnalyticsState | null,
  buildPolicyVersion: string,
): AnalyticsState {
  if (stored === null) return initialAnalyticsState(buildPolicyVersion);
  return {
    ...initialAnalyticsState(buildPolicyVersion),
    ...stored,
    knownPolicyVersion: newerVersion(stored.knownPolicyVersion, buildPolicyVersion),
  };
}

/** The newer of two policy versions — dates, so they compare as strings. */
export const newerVersion = (a: string, b: string): string => (a >= b ? a : b);

/**
 * Whether events are recorded now: a grant the server accepted, on a policy not older than the
 * newest the app knows. Anything else records nothing — nothing is kept "for later".
 */
export function isCounting(state: AnalyticsState): boolean {
  return (
    state.choice === 'GRANTED' &&
    state.accepted &&
    state.current !== null &&
    state.policyVersion !== null &&
    state.policyVersion >= state.knownPolicyVersion
  );
}

/** Which question the app owes the tourist, if any: the first, or a new policy's. */
export type Question = 'first' | 'changed' | null;

/**
 * The question owed now (the screens decide whether this is the moment): the first while nothing
 * was chosen, it's due and it wasn't closed twice; a new policy's while a grant is on an older one.
 * A tourist who said no isn't asked again — Settings is the way in.
 */
export function questionOwed(state: AnalyticsState): Question {
  if (state.choice === null && state.due && state.asked < ASK_LIMIT) return 'first';
  if (
    state.choice === 'GRANTED' &&
    state.policyVersion !== null &&
    state.policyVersion < state.knownPolicyVersion &&
    state.asked < ASK_LIMIT
  )
    return 'changed';
  return null;
}

/** Whether an id is due to be replaced at `now`. */
export const rotationDue = (id: AnalyticsId, now: number): boolean =>
  now - id.createdAt >= ANALYTICS_ID_ROTATION_MS;

/** The ids still remembered at `now`: used in the last 90 days. */
export const stillRemembered = (ids: readonly AnalyticsId[], now: number): AnalyticsId[] =>
  ids.filter((id) => now - id.lastUsedAt < ANALYTICS_ID_MEMORY_MS);
