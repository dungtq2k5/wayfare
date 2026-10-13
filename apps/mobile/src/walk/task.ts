import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { hydrateWalk, installWalk, WALK_TASK } from './controller';
import { pushFix } from './store';

installWalk();
// Headless, with the app swiped away, the task is all that runs: it reads the kept walk itself.
void hydrateWalk();

/**
 * The location task. TaskManager tasks must exist when the bundle loads, so this is defined at
 * module scope and imported from the root layout. The callback hands the fix on and returns: the
 * engine, the player and the network run from the store's subscribers (conventions §12.3).
 */
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(WALK_TASK, ({ data, error }) => {
  if (error || !data) return Promise.resolve();
  for (const location of data.locations) {
    pushFix({
      t: location.timestamp,
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracyM: location.coords.accuracy ?? 9_999,
    });
  }
  return Promise.resolve();
});
