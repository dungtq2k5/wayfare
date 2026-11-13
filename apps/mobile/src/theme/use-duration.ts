import { duration } from '@wayfare/design-tokens/tokens';
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { durationFor } from './duration';

type DurationToken = keyof typeof duration;

/**
 * An animation's length in milliseconds from `duration.*`, or 0 when the system removes
 * animations. Every animation takes its time from here (conventions §12.5).
 */
export function useDuration(token: DurationToken): number {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => live && setReduced(value));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return durationFor(duration, token, reduced);
}
