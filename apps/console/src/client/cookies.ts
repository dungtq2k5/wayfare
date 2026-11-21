/**
 * Set while this browser holds a session, so a failed refresh can tell "you were signed out" (C5)
 * from a first visit. Not a credential: the session itself is in the gateway's httpOnly cookies.
 * The cookie helpers themselves are shared: `@wayfare/ui/cookies`.
 */
export const SIGNED_IN_MARKER = 'wf_signed_in';
