/** The account pages an emailed link opens in the app (K8), by their path on `wayfare.app`. */
export const LINK_PAGES = {
  'verify-email': 'verify',
  'reset-password': 'reset',
  'confirm-email-change': 'confirm',
  'revert-email-change': 'revert',
} as const;

export type LinkPage = (typeof LINK_PAGES)[keyof typeof LINK_PAGES];

/** An account link: its page and the token from its fragment (`#token=…`). */
export interface AccountLink {
  readonly page: LinkPage;
  readonly token: string;
}

/**
 * Reads an account link, `https://wayfare.app/<page>#token=…`; null for anything else. The token
 * travels in the fragment, so it never reaches a server log through the URL.
 */
export function accountLinkOf(url: string): AccountLink | null {
  const match = /^https:\/\/wayfare\.app\/([a-z-]+)\/?#(.*)$/.exec(url.trim());
  if (match === null) return null;
  const page = LINK_PAGES[match[1] as keyof typeof LINK_PAGES];
  if (page === undefined) return null;
  const token = new URLSearchParams(match[2]).get('token');
  return token === null || token === '' ? null : { page, token };
}

/** The result screens (frames L1, L3, L4, L5, L6). */
export type LinkResult = 'verified' | 'confirmed' | 'reverted' | 'expired' | 'other-account';

/**
 * Which result a link's answer shows (K9, K10). A link always acts for its own account; when this
 * phone is signed in as another, the screen says so and nothing here changes (frame L6). The
 * server says whether it is the same account: a masked address cannot.
 */
export function linkResultOf(
  page: Exclude<LinkPage, 'reset'>,
  answer: { readonly sameAccount: boolean } | 'expired',
  signedIn: boolean,
): LinkResult {
  if (answer === 'expired') return 'expired';
  if (signedIn && !answer.sameAccount) return 'other-account';
  return page === 'verify' ? 'verified' : page === 'confirm' ? 'confirmed' : 'reverted';
}

/**
 * After a reset link set a new password (K9): sign in again here when it was this account (the
 * reset revoked every session, so before any other call); with nobody signed in, the app has only
 * the masked address, so it opens Sign in with a note (frame L2c); for another account, this
 * phone stays as it was (frame L6).
 */
export function afterReset(
  sameAccount: boolean,
  signedIn: boolean,
): 'sign-in-again' | 'sign-in-screen' | 'other-account' {
  if (!signedIn) return 'sign-in-screen';
  return sameAccount ? 'sign-in-again' : 'other-account';
}
