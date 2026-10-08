import { openingState } from '@wayfare/core';
import type { OpeningHoursRowInput, OpeningState } from '@wayfare/core';
import { useTourist } from '../i18n/use-tourist';

/** What to say about a Place's hours, and in which tone; null when there are no hours to speak of. */
export interface OpenSummary {
  readonly tone: 'success' | 'warning' | 'offline';
  readonly text: string;
  readonly state: OpeningState;
}

/**
 * The opening state in words, evaluated in the business time zone. A Place with no hours returns
 * null: a list never says *Open now* for it (product F1).
 */
export function useOpenSummary(
  rows: readonly OpeningHoursRowInput[],
  now: number = Date.now(),
): OpenSummary | null {
  const { t, tFamily } = useTourist();
  const state = openingState(rows, now);
  switch (state.kind) {
    case 'not-listed':
      return null;
    case 'open':
      return state.closesSoon
        ? { tone: 'warning', text: t('place.open.closesSoon', { time: state.closesAt }), state }
        : { tone: 'success', text: t('place.open.until', { time: state.closesAt }), state };
    case 'closed': {
      if (state.opensAt === null || state.opensInDays === null) {
        return { tone: 'offline', text: t('place.closed.noOpening'), state };
      }
      const time = state.opensAt;
      const text =
        state.opensInDays === 0
          ? t('place.closed.opensToday', { time })
          : state.opensInDays === 1
            ? t('place.closed.opensTomorrow', { time })
            : t('place.closed.opensOn', {
                day: tFamily('weekday', String(state.opensWeekday)),
                time,
              });
      return { tone: 'offline', text, state };
    }
  }
}
