import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { accountSession } from '../session';
import { outdatedTerms, refreshMe } from './actions';

/**
 * At launch, signed in: the account as the server holds it (a refused refresh ends the session
 * here, K2), then new terms to accept before it is used (frame A10, K16). Offline, nothing.
 */
export function useAccountBoot(enabled: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      if (!(await accountSession.isSignedIn())) return;
      try {
        await refreshMe();
        if (!(await accountSession.isSignedIn())) return;
        if ((await outdatedTerms()).length > 0) router.push('/account/terms');
      } catch {
        // Offline, or the gateway is down: the next launch asks again.
      }
    })();
  }, [enabled, router]);
}
