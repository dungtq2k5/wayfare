import { routeForLink } from '../src/codes/link-entry';

/**
 * Every link from outside the app passes here first, cold or warm. The app's screens sit behind the
 * first run's guard, so a route for links would never mount before onboarding; the code is kept
 * instead, and the Map opens it.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return routeForLink(path);
}
