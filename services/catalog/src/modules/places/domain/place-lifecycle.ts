import { PlaceStatus } from '@wayfare/contracts';

/** What can move a Place between statuses (rdm-spec §1.6). */
export enum PlaceLifecycleEvent {
  /** An admin or an approval asked for publication; also a reactivation. */
  ACTIVATION_REQUESTED = 'ACTIVATION_REQUESTED',
  /** The activation gate opened. */
  GATE_OPENED = 'GATE_OPENED',
  /** The Vietnamese source text changed on a live Place. */
  SOURCE_CHANGED = 'SOURCE_CHANGED',
  /** An admin, the owner or an entitlement lapse took it offline. */
  DEACTIVATED = 'DEACTIVATED',
}

/** The transition table (rdm-spec §1.6). Anything not listed is refused. */
export const PLACE_TRANSITIONS: Readonly<
  Record<PlaceStatus, Partial<Record<PlaceLifecycleEvent, PlaceStatus>>>
> = {
  [PlaceStatus.DRAFT]: { [PlaceLifecycleEvent.ACTIVATION_REQUESTED]: PlaceStatus.PROCESSING },
  [PlaceStatus.PROCESSING]: {
    [PlaceLifecycleEvent.GATE_OPENED]: PlaceStatus.ACTIVE,
    [PlaceLifecycleEvent.DEACTIVATED]: PlaceStatus.INACTIVE,
  },
  [PlaceStatus.ACTIVE]: {
    [PlaceLifecycleEvent.SOURCE_CHANGED]: PlaceStatus.PROCESSING,
    [PlaceLifecycleEvent.DEACTIVATED]: PlaceStatus.INACTIVE,
  },
  [PlaceStatus.INACTIVE]: { [PlaceLifecycleEvent.ACTIVATION_REQUESTED]: PlaceStatus.PROCESSING },
};

/** A refused transition; the service answers `INVALID_STATE { status: from }`. */
export interface IllegalTransitionError extends Error {
  readonly name: 'IllegalTransitionError';
  readonly from: PlaceStatus;
  readonly event: PlaceLifecycleEvent;
}

/** True for the error `transition` throws. */
export function isIllegalTransition(error: unknown): error is IllegalTransitionError {
  return error instanceof Error && error.name === 'IllegalTransitionError';
}

/** The status `event` moves a Place in `from` to; throws `IllegalTransitionError` otherwise. */
export function transition(from: PlaceStatus, event: PlaceLifecycleEvent): PlaceStatus {
  const to = PLACE_TRANSITIONS[from][event];
  if (to !== undefined) return to;
  throw Object.assign(new Error(`A ${from} Place cannot take ${event}`), {
    name: 'IllegalTransitionError' as const,
    from,
    event,
  });
}

/** What tourists can see of a Place: its status and whether it is deleted. */
export interface PlaceVisibility {
  readonly status: PlaceStatus;
  readonly deleted: boolean;
}

/**
 * The one `catalog.place.status_changed` a transaction publishes (api-endpoints-plan §10): the
 * state before its first transition and after its last, or null when neither changed.
 */
export function netVisibilityChange(
  before: PlaceVisibility,
  after: PlaceVisibility,
): { from: PlaceStatus; to: PlaceStatus; deleted: boolean } | null {
  if (before.status === after.status && before.deleted === after.deleted) return null;
  return { from: before.status, to: after.status, deleted: after.deleted };
}
