import {
  ApiError,
  apiFetch,
  authGoogleConfirm,
  authGoogleLink,
  authGoogleNonce,
  authGoogleSignIn,
  usersUnlinkGoogle,
} from '@wayfare/api-client';
import { GoogleOutcome } from '@wayfare/contracts';
import { create } from 'zustand';
import { googleFailureOf, signInWithGoogle } from '../../modules/google-sign-in/src';
import { DIAGNOSTICS_ENABLED, GOOGLE_SERVER_CLIENT_ID } from '../env';
import { useAccountStore } from '../session/account-store';
import { useAppStore } from '../state/app-store';
import { favouritesOnPhone, refreshMe, signedIn, signIn } from './actions';
import { failureOf } from './google-failures';
import type { GoogleFailure } from './google-failures';
import type { ItsYou, SignedIn } from './actions';

/** What Google's chooser, or the fake picker, gave. */
type Picked =
  | { readonly kind: 'token'; readonly idToken: string; readonly email: string }
  | { readonly kind: 'cancelled' | 'no-account' | 'unreachable' | 'unavailable' };

/** Every way Continue with Google ends (K14). */
export type GoogleAnswer =
  | ({ readonly kind: 'signed-in'; readonly outcome: GoogleOutcome } & SignedIn)
  | { readonly kind: 'needs-password'; readonly email: string; readonly linkTicket: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly reason: GoogleFailure };

// ——— The fake picker (Diagnostics, K12) ———

/** A pick made in the fake picker: an address and how Google would vouch for it. */
export interface FakePick {
  readonly email: string;
  readonly verified: boolean;
  readonly workspace: boolean;
}

interface FakeGoogleState {
  /** Diagnostics' *Fake Google account* switch. */
  enabled: boolean;
  /** An open picker, waiting for its choice. */
  pending: ((choice: FakePick | 'cancelled' | 'no-account' | 'unreachable') => void) | null;
}

/** The fake path's state: the switch, and the picker the root layout shows while one is pending. */
export const useFakeGoogle = create<FakeGoogleState>(() => ({ enabled: false, pending: null }));

/** Whether the button uses the fake picker: a Diagnostics build with the switch on. */
const usesFake = () => DIAGNOSTICS_ENABLED && useFakeGoogle.getState().enabled;

/** The fake issuer's token for a pick, minted by the stack (`POST /dev/google-token`). */
async function mintFake(pick: FakePick, nonce: string): Promise<string> {
  const domain = pick.email.slice(pick.email.lastIndexOf('@') + 1);
  const { data } = await apiFetch<{ data: { idToken: string } }>('/dev/google-token', {
    method: 'POST',
    anonymous: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: pick.email,
      emailVerified: pick.verified,
      nonce,
      ...(pick.workspace ? { hd: domain } : {}),
    }),
  });
  return data.idToken;
}

/** One token for `nonce`: Google's chooser, or in a Diagnostics build the fake picker. */
async function pick(nonce: string): Promise<Picked> {
  if (usesFake()) {
    const choice = await new Promise<FakePick | 'cancelled' | 'no-account' | 'unreachable'>(
      (resolve) => useFakeGoogle.setState({ pending: resolve }),
    );
    useFakeGoogle.setState({ pending: null });
    if (typeof choice === 'string') return { kind: choice };
    return { kind: 'token', idToken: await mintFake(choice, nonce), email: choice.email };
  }
  if (GOOGLE_SERVER_CLIENT_ID === '') return { kind: 'unavailable' };
  try {
    const token = await signInWithGoogle(GOOGLE_SERVER_CLIENT_ID, nonce);
    return { kind: 'token', ...token };
  } catch (error) {
    const failure = googleFailureOf(error);
    return {
      kind:
        failure === 'CANCELLED'
          ? 'cancelled'
          : failure === 'NO_ACCOUNT'
            ? 'no-account'
            : 'unreachable',
    };
  }
}

/**
 * Continue with Google (K4, K14): a nonce for this phone, a token carrying it, then the server's
 * answer — signed in (created, signed in, linked, or linked with the old password removed), the
 * password step (ADR 0064), or a failure. Offline and rate limits throw, as the email form's do.
 */
export async function continueWithGoogle(): Promise<GoogleAnswer> {
  const { nonce } = (await authGoogleNonce()).data;
  const picked = await pick(nonce);
  if (picked.kind === 'cancelled') return { kind: 'cancelled' };
  if (picked.kind !== 'token') return { kind: 'failed', reason: picked.kind };
  const favourites = await favouritesOnPhone();
  try {
    const { data } = await authGoogleSignIn({
      idToken: picked.idToken,
      preferredLocale: useAppStore.getState().language ?? 'en',
    });
    const result = await signedIn(data, favourites);
    const outcome = data.outcome as GoogleOutcome;
    // Said once, in Settings (frame K6).
    if (outcome === GoogleOutcome.LINKED_PASSWORD_REMOVED)
      useAccountStore.setState({ notice: 'password-removed' });
    return { kind: 'signed-in', outcome, ...result };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'GOOGLE_LINK_NEEDS_PASSWORD') {
      const { linkTicket } = error.details as { linkTicket: string };
      return { kind: 'needs-password', email: picked.email, linkTicket };
    }
    const reason = failureOf(error);
    if (reason === null) throw error;
    return { kind: 'failed', reason };
  }
}

/**
 * ADR 0064's password step (frame K9): signs in with the address's Wayfare password, then links
 * the Google account the chooser picked. A wrong password throws as the sign-in form's does; a
 * lapsed ticket is `CONFIRMATION_EXPIRED` ("That took too long").
 */
export async function linkWithPassword(
  email: string,
  password: string,
  linkTicket: string,
): Promise<SignedIn> {
  const result = await signIn(email, password);
  await authGoogleLink({ linkTicket });
  await refreshMe().catch(() => undefined);
  return result;
}

/** A Google confirmation in place of the password (frames A3g, A7g), and the address confirmed. */
export async function confirmWithGoogle(): Promise<
  | { readonly kind: 'confirmed'; readonly proof: ItsYou; readonly email: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed' }
> {
  const { nonce } = (await authGoogleNonce()).data;
  const picked = await pick(nonce);
  if (picked.kind === 'cancelled') return { kind: 'cancelled' };
  if (picked.kind !== 'token') return { kind: 'failed' };
  try {
    const { data } = await authGoogleConfirm({ idToken: picked.idToken });
    return { kind: 'confirmed', proof: { confirmation: data.confirmation }, email: picked.email };
  } catch (error) {
    if (error instanceof ApiError && error.status !== 0 && error.status !== 429)
      return { kind: 'failed' };
    throw error;
  }
}

/** *Remove Google sign-in* (frame U2): with the current password; every other phone signs out. */
export async function unlinkGoogle(currentPassword: string): Promise<void> {
  await usersUnlinkGoogle({ currentPassword });
  await refreshMe();
}
