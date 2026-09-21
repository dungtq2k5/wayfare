/**
 * The pages an emailed account link opens, relative to the console or web app base
 * (api-endpoints-plan §1.2).
 */
export const ACCOUNT_LINK_PATHS = {
  verifyEmail: '/verify-email',
  resetPassword: '/reset-password',
  setupAccount: '/setup-account',
  confirmEmailChange: '/confirm-email-change',
  revertEmailChange: '/revert-email-change',
  /** Where a mail sends someone who simply needs to sign in again. */
  signIn: '/sign-in',
  /** The "this wasn't me" link every hold notice carries. */
  cancelRecovery: '/recovery/cancel',
  /** The link to the requested address once the hold has passed. */
  completeRecovery: '/recovery/complete',
  /** The owner's application status; opened without a token. */
  ownerRegistration: '/owner/registration',
  /** The owner's plan page; opened without a token. */
  ownerBilling: '/owner/billing',
  /** The owner's submissions; opened without a token. */
  ownerSubmissions: '/owner/submissions',
} as const;

/** A page an emailed link may open. */
export type AccountLinkPath = keyof typeof ACCOUNT_LINK_PATHS;

/**
 * An emailed link. The token travels in the URL fragment, which browsers never send to a server;
 * the page reads it, strips it, and posts it in a body (api-endpoints-plan §1.2).
 */
export function accountLink(base: string, path: AccountLinkPath, token?: string): string {
  // FIXME Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking.
  const url = `${base.replace(/\/+$/, '')}${ACCOUNT_LINK_PATHS[path]}`;
  return token === undefined ? url : `${url}#token=${encodeURIComponent(token)}`;
}
