import { PLACE_STATUSES, PlaceStatus } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import {
  isIllegalTransition,
  netVisibilityChange,
  PlaceLifecycleEvent,
  transition,
} from './place-lifecycle';

const { DRAFT, PROCESSING, ACTIVE, INACTIVE } = PlaceStatus;
const E = PlaceLifecycleEvent;

const ALLOWED: [PlaceStatus, PlaceLifecycleEvent, PlaceStatus][] = [
  [DRAFT, E.ACTIVATION_REQUESTED, PROCESSING],
  [PROCESSING, E.GATE_OPENED, ACTIVE],
  [ACTIVE, E.SOURCE_CHANGED, PROCESSING],
  [ACTIVE, E.DEACTIVATED, INACTIVE],
  [PROCESSING, E.DEACTIVATED, INACTIVE],
  [INACTIVE, E.ACTIVATION_REQUESTED, PROCESSING],
];

describe('transition', () => {
  it.each(ALLOWED)('%s --%s--> %s', (from, event, to) => {
    expect(transition(from, event)).toBe(to);
  });

  const refused = PLACE_STATUSES.flatMap((from) =>
    Object.values(E)
      .filter((event) => !ALLOWED.some(([f, e]) => f === from && e === event))
      .map((event): [PlaceStatus, PlaceLifecycleEvent] => [from, event]),
  );

  it.each(refused)('refuses %s --%s', (from, event) => {
    let thrown: unknown;
    try {
      transition(from, event);
    } catch (error) {
      thrown = error;
    }
    expect(isIllegalTransition(thrown)).toBe(true);
    expect(thrown).toMatchObject({ from, event });
  });

  it('covers every pair', () => {
    expect(ALLOWED.length + refused.length).toBe(PLACE_STATUSES.length * Object.values(E).length);
  });

  it('does not mistake another error for a refusal', () => {
    expect(isIllegalTransition(new Error('x'))).toBe(false);
    expect(isIllegalTransition('x')).toBe(false);
  });
});

describe('netVisibilityChange', () => {
  it('reports the net change across several steps, once', () => {
    expect(
      netVisibilityChange({ status: INACTIVE, deleted: false }, { status: ACTIVE, deleted: false }),
    ).toEqual({ from: INACTIVE, to: ACTIVE, deleted: false });
  });

  it('reports a delete that changes no status', () => {
    expect(
      netVisibilityChange({ status: ACTIVE, deleted: false }, { status: ACTIVE, deleted: true }),
    ).toEqual({ from: ACTIVE, to: ACTIVE, deleted: true });
  });

  it('reports nothing when the steps cancel out', () => {
    expect(
      netVisibilityChange({ status: ACTIVE, deleted: false }, { status: ACTIVE, deleted: false }),
    ).toBeNull();
  });
});
