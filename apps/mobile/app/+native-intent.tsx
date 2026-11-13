import { accountLinkOf } from '../src/account/links';
import { routeForLink } from '../src/codes/link-entry';

/**
 * Every link from outside the app passes here first, cold or warm. An emailed account link opens
 * its result screen (K8); any other Wayfare link is a code. The app's screens sit behind the
 * first run's guard, so a route for links would never mount before onboarding; the code is kept
 * instead, and the Map opens it.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const account = accountLinkOf(path);
  if (account !== null) {
    return `/account/link?page=${account.page}&token=${encodeURIComponent(account.token)}`;
  }
  return routeForLink(path);
}
