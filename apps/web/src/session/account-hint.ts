/**
 * Set while this browser holds an account session, so a page knows to ask who it is and a `401`
 * knows to refresh. Not a credential: the session itself is in the gateway's `httpOnly` cookies.
 */
export const ACCOUNT_HINT_COOKIE = 'wf_web_account';
