# 0062 — Tourists may continue with Google, beside email and password

**Status:** Accepted · **Date:** 2026-10-19 · **Supersedes:** — · **Superseded by:** [0063](./0063-google-sign-in-reaches-the-web-and-owners-never-staff.md) (in part — the web app, owners, unlinking); [0064](./0064-google-links-by-itself-only-where-google-owns-the-mailbox.md) (in part — automatic linking only where Google owns the mailbox)

## Context

A tourist's account is optional ([ADR 0003](./0003-anonymous-device-is-the-primary-identity.md)): the app works fully without one, and an account only keeps favourites across phones today, purchases later. So the effort of creating one decides whether anyone does. Email and password ask for a new password and a verification email; on an Android phone, which is already signed into a Google account, "Continue with Google" is one tap and the address arrives already verified.

The forces against it are real. A second way into an account brings **account linking** — the same address reached by a password and by Google — and with it the classic *pre-account takeover*: someone registers a victim's address with a password, never verifies it, and waits for the victim to arrive through Google into an account whose password the attacker holds. A password-less account cannot answer the routes that ask for the current password (deleting the account, changing its email or password). It adds a Google Cloud OAuth client, a verifier on the server, and a line in the privacy policy. Apple's rule that an app offering social sign-in must also offer *Sign in with Apple* does not apply: Wayfare's native app is Android-only ([ADR 0059](./0059-the-native-app-is-android-only.md)).

## Decision

- **Tourists may continue with Google**, in the Android app, beside email and password, which stay for everyone who wants them — and for the console's staff and owners, who keep email and password only.
- **The app gets a Google ID token from Android's Credential Manager** and sends it to `POST /auth/google`; **identity verifies it** — Google's signature (its published keys), `iss`, `aud` (Wayfare's server client id), `exp`, and `email_verified: true`, refusing any other. The token is never stored.
- **A Google identity is linked to an account by Google's subject id** (`sub`) in a new identity table, never by the address alone. A known subject signs that account in.
- **An unknown subject whose verified address belongs to an account links to it** — and **if that account's address was never verified, its password is removed and its sessions revoked** as it is linked: whoever registered the address without proving it loses the way in, and the person who owns the mailbox keeps the account.
- **An unknown subject whose address belongs to no account creates one**, with the address verified and no password; continuing is accepting the current terms, said beside the button.
- **The request claims the device**, as register and login do; signing in with Google is in every other way a sign-in (the same session, tokens and refresh rules).
- **A password-less account proves itself with a fresh Google ID token** wherever the API asks for the current password; it can add a password through *Forgot password?*.
- **Wayfare keeps the address and the name only**, never the Google picture or anything else the token carries.

## Consequences

- One tap to an account on most Android phones, which is what an optional account needs to be used at all.
- **Account linking is now a security boundary.** The rule rests on Google's `email_verified` and on wiping the password of an unverified account at linking; a mistake here hands an account to the wrong person, so it is specified with tests for each case.
- **Every "current password" check gains a second form** (a fresh Google token), so each route that asks for a password changes, and the app needs a re-authentication step.
- **A dependency on Google** at sign-in time: if Google is unreachable, Google accounts cannot sign in (their existing sessions keep working); accounts with a password can.
- **New setup:** a Google Cloud OAuth client for the Android app (bound to the signing key's SHA-1, debug and release) and a server client id, configuration per environment, and a privacy-policy line naming Google as a sign-in provider.
- **Not decided here:** Google on the web app (the PWA), removing a linked Google identity, and other providers — each a later decision if asked for.

## See also

- [0003](./0003-anonymous-device-is-the-primary-identity.md) — the device stays the primary identity; an account, however made, claims it
- [0059](./0059-the-native-app-is-android-only.md) — why *Sign in with Apple* is not required
- [0048](./0048-erasure-anonymises-purchases.md) — erasure of an account, which now also removes its Google link
