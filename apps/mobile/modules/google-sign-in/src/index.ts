import { requireNativeModule } from 'expo';

/** Why Google's chooser gave no token. */
export type GoogleSignInFailure = 'CANCELLED' | 'NO_ACCOUNT' | 'FAILED';

const GoogleSignIn = requireNativeModule<{
  signIn(serverClientId: string, nonce: string): Promise<{ idToken: string; email: string }>;
  signOut(): Promise<void>;
}>('GoogleSignIn');

/** Shows Google's chooser; the token carries `nonce`. Rejects with a `GoogleSignInFailure` code. */
export function signInWithGoogle(
  serverClientId: string,
  nonce: string,
): Promise<{ idToken: string; email: string }> {
  return GoogleSignIn.signIn(serverClientId, nonce);
}

/** Forgets the pick, so the next sign-in shows the chooser (frame S1g). */
export function forgetGoogleChoice(): Promise<void> {
  return GoogleSignIn.signOut();
}

/** A rejection's failure code, or `FAILED` for anything unexpected. */
export function googleFailureOf(error: unknown): GoogleSignInFailure {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'CANCELLED' || code === 'NO_ACCOUNT' ? code : 'FAILED';
}
