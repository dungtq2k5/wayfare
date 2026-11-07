import { NarrationTracker } from '@wayfare/core';
import { analytics } from './analytics';

/** The player's narration, told to the install's analytics. */
export const narrationTracker = new NarrationTracker(analytics, () => Date.now());
