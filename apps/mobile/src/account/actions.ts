import {
  authLogin,
  authLogout,
  authLogoutAll,
  authRegister,
  emailChangeConfirmChange,
  emailChangeRequestChange,
  emailChangeRequestVerification,
  emailChangeRevertChange,
  emailChangeVerify,
  favoritesList,
  passwordChange,
  passwordForgot,
  passwordReset,
  passwordValidate,
  usersAccept,
  usersAcceptances,
  usersErase,
  usersMe,
  usersUpdate,
} from '@wayfare/api-client';
import type { SessionResponseDto } from '@wayfare/api-client';
import { LEGAL_DOCUMENT_VERSIONS, LegalDocument } from '@wayfare/contracts';
import { accountSession } from '../session';
import { useAccountStore } from '../session/account-store';
import type { AccountUser } from '../session/account-store';
import { useAppStore } from '../state/app-store';
import { queryClient } from '../state/query-client';
import { API_DELETE_WORD, outdatedDocuments, phoneMoved } from './rules';
import { forgetGoogleChoice } from '../../modules/google-sign-in/src';
import { GOOGLE_SERVER_CLIENT_ID } from '../env';

/** The documents an account must hold current (K16): the terms, and the device's privacy policy. */
const ACCOUNT_DOCUMENTS: readonly LegalDocument[] = [
  LegalDocument.TERMS_OF_SERVICE,
  LegalDocument.PRIVACY_POLICY,
];

const userOf = (user: {
  id: string;
  email: string;
  fullName?: string | null;
  isEmailVerified: boolean;
}): AccountUser => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName ?? null,
  isEmailVerified: user.isEmailVerified,
});

/** Favourites follow the bearer: every list refetches when it changes. */
const refreshFavourites = () =>
  queryClient.invalidateQueries({ queryKey: ['/api/v1/me/favorites'], refetchType: 'all' });

/** How many favourites this phone holds, before it joins an account (K6); 0 when it cannot tell. */
export async function favouritesOnPhone(): Promise<number> {
  try {
    const lang = useAppStore.getState().language ?? 'en';
    return (await favoritesList({ lang, limit: 50 })).data.length;
  } catch {
    return 0;
  }
}

/** What signing in leaves for the screens to say. */
export interface SignedIn {
  /** The phone's own favourites that joined, for frame G6; 0 says "Signed in" alone. */
  readonly favourites: number;
  /** New terms to accept before the account is used (frame A10, K16). */
  readonly needsTerms: boolean;
}

/** Every way in ends here: the session kept, the account remembered, its favourites refetched. */
export async function signedIn(session: SessionResponseDto, favourites: number): Promise<SignedIn> {
  await accountSession.start({
    accessToken: session.accessToken!,
    refreshToken: session.refreshToken!,
  });
  const user = userOf(session.user);
  const { lastAccountId } = useAccountStore.getState();
  useAccountStore.setState({
    user,
    lastAccountId: user.id,
    pendingEmail: null,
    // A phone another account had signed into moved to this one (frame G7, K3); otherwise any
    // earlier "signed out" card has said its piece.
    notice: phoneMoved(lastAccountId, user.id) ? 'phone-moved' : null,
    favouritesNotice: false,
    // Signing in retires the Favourites offer for good on this phone (K19).
    offerDismissed: true,
  });
  await refreshFavourites();
  // How the account signs in, for the account screen (frames A1g, A1g2).
  await refreshMe().catch(() => undefined);
  return { favourites, needsTerms: (await outdatedTerms()).length > 0 };
}

/**
 * Create an account (frames G1–G3, K5). Sent with the device's bearer — never the no-bearer mode —
 * so the server claims this phone and the session names it (K1).
 */
export async function createAccount(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<SignedIn> {
  const favourites = await favouritesOnPhone();
  const { data } = await authRegister({
    email: input.email.trim(),
    password: input.password,
    ...(input.fullName.trim() === '' ? {} : { fullName: input.fullName.trim() }),
    preferredLocale: useAppStore.getState().language ?? 'en',
    termsVersion: LEGAL_DOCUMENT_VERSIONS[LegalDocument.TERMS_OF_SERVICE],
  });
  return signedIn(data, favourites);
}

/** Sign in (frames G4–G6, K1): with the device's bearer, so this phone is claimed. */
export async function signIn(email: string, password: string): Promise<SignedIn> {
  const favourites = await favouritesOnPhone();
  const { data } = await authLogin({ email: email.trim(), password });
  return signedIn(data, favourites);
}

/** Ends the account on this phone: the device's token from now on (K2). */
export async function endLocally(): Promise<void> {
  await accountSession.end();
  // The next Continue with Google shows the chooser again (frame S1g); the fake picker has no pick.
  if (GOOGLE_SERVER_CLIENT_ID !== '') await forgetGoogleChoice().catch(() => undefined);
  useAccountStore.setState({ user: null, pendingEmail: null });
  await refreshFavourites();
}

/** *Sign out* (frame A5, K13): revoked on the server when it can be, ended here either way. */
export async function signOut(): Promise<void> {
  const refreshToken = await accountSession.refreshToken();
  if (refreshToken !== null) {
    await authLogout({ refreshToken }, { anonymous: true }).catch(() => undefined);
  }
  await endLocally();
}

/** *Sign out on every phone* (frame A6, K13). */
export async function signOutEverywhere(): Promise<void> {
  await authLogoutAll();
  await endLocally();
}

/**
 * What a protected form sends: the current password, or for an account that signs in with Google
 * only, a Google confirmation (frames A3g, A7g).
 */
export type ItsYou = { readonly currentPassword: string } | { readonly confirmation: string };

/** *Delete account* (frame A7, K14): the API's word, whatever the tourist typed. */
export async function deleteAccount(proof: ItsYou): Promise<void> {
  await usersErase({ ...proof, confirm: API_DELETE_WORD });
  await endLocally();
}

/** The account as the server holds it now (frame A1); a waiting change ends once it shows (A3b). */
export async function refreshMe(): Promise<void> {
  const { data } = await usersMe();
  const user = { ...userOf(data.user), signIn: data.signIn };
  const { pendingEmail } = useAccountStore.getState();
  useAccountStore.setState({
    user,
    pendingEmail: pendingEmail === user.email ? null : pendingEmail,
  });
}

/** *Resend* the verification (frame G3). */
export async function resendVerification(): Promise<void> {
  await emailChangeRequestVerification();
}

/** The name (frame A2, K11): never empty — the API takes a non-empty name only. */
export async function changeName(fullName: string): Promise<void> {
  await usersUpdate({ fullName: fullName.trim() });
  await refreshMe();
}

/** *Change email* (frame A3): the address changes only when the link is opened (A3b). */
export async function requestEmailChange(newEmail: string, proof: ItsYou) {
  await emailChangeRequestChange({ newEmail: newEmail.trim(), ...proof });
  useAccountStore.setState({ pendingEmail: newEmail.trim().toLowerCase() });
}

/** *Change password* (frame A4, K12): this phone stays signed in. */
export async function changePassword(currentPassword: string, newPassword: string) {
  await passwordChange({ currentPassword, newPassword });
}

/** *Forgot password?* (frame G8): the same answer whether or not the account exists. */
export async function forgotPassword(email: string): Promise<void> {
  await passwordForgot({ email: email.trim() });
}

/** The documents this account has not accepted in their current version (K16). */
export async function outdatedTerms(): Promise<LegalDocument[]> {
  const { data } = await usersAcceptances();
  return outdatedDocuments(data, ACCOUNT_DOCUMENTS);
}

/** *Accept and continue* (frame A10): each outdated document at its current version. */
export async function acceptTerms(): Promise<void> {
  for (const document of await outdatedTerms()) {
    await usersAccept({ document, version: LEGAL_DOCUMENT_VERSIONS[document] });
  }
}

/**
 * Before a link's call: signed in, an account call makes sure the bearer is fresh, so the server
 * can say whether the link is this account's (K10). A link route is public and never refuses an
 * expired bearer; it would only answer "another account".
 */
async function freshBearer(): Promise<boolean> {
  if (!(await accountSession.isSignedIn())) return false;
  await refreshMe().catch(() => undefined);
  return accountSession.isSignedIn();
}

export interface LinkAnswer {
  readonly emailMasked: string;
  readonly sameAccount: boolean;
  readonly signedIn: boolean;
}

/** The verify, confirm and revert links (K9). A revert of this account ends its session here. */
export async function openLink(
  page: 'verify' | 'confirm' | 'revert',
  token: string,
): Promise<LinkAnswer> {
  const signedInNow = await freshBearer();
  const call =
    page === 'verify'
      ? emailChangeVerify
      : page === 'confirm'
        ? emailChangeConfirmChange
        : emailChangeRevertChange;
  const { data } = await call({ token });
  if (data.sameAccount && page === 'revert') await endLocally();
  else if (data.sameAccount) await refreshMe().catch(() => undefined);
  return { ...data, signedIn: signedInNow };
}

/** A reset link, read before its form shows (frame L2). */
export async function validateReset(token: string): Promise<LinkAnswer> {
  const signedInNow = await freshBearer();
  const { data } = await passwordValidate({ token });
  return { emailMasked: data.emailMasked, sameAccount: data.sameAccount, signedIn: signedInNow };
}

/**
 * Saves a reset link's password (K9). It revokes every session of that account, so when it was
 * this phone's, the app signs in again at once with the stored address — before any other call,
 * or the revocation would reach the session as "signed out elsewhere".
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  again: boolean,
): Promise<SignedIn | null> {
  const email = useAccountStore.getState().user?.email ?? null;
  await passwordReset({ token, newPassword });
  if (!again || email === null) return null;
  await accountSession.end();
  const { data } = await authLogin({ email, password: newPassword });
  return signedIn(data, 0);
}
