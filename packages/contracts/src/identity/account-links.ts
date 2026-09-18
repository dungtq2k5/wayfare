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
  /** The owner's application status; opened without a token. */
  ownerRegistration: '/owner/registration',
} as const;

/** A page an emailed link may open. */
export type AccountLinkPath = keyof typeof ACCOUNT_LINK_PATHS;

/**
 * An emailed link. The token travels in the URL fragment, which browsers never send to a server;
 * the page reads it, strips it, and posts it in a body (api-endpoints-plan §1.2).
 */
export function accountLink(base: string, path: AccountLinkPath, token?: string): string {
  const url = `${base.replace(/\/+$/, '')}${ACCOUNT_LINK_PATHS[path]}`;
  return token === undefined ? url : `${url}#token=${encodeURIComponent(token)}`;
}
