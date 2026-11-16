# 0063 — Google sign-in reaches the web app and owners, never staff, and can be unlinked

**Status:** Accepted · **Date:** 2026-10-19 · **Supersedes:** [0062](./0062-tourists-may-continue-with-google.md) (in part — "in the Android app" only, the console's owners on email and password only, and removing a linked Google identity left undecided) · **Superseded by:** —

## Context

[ADR 0062](./0062-tourists-may-continue-with-google.md) let tourists continue with Google in the Android app and left three things open: the web app, the console's owners, and removing a link. The product owner has since decided all three.

The web app is the only Wayfare an iPhone user gets ([ADR 0059](./0059-the-native-app-is-android-only.md)); leaving it on email and password alone would give the iPhone tourist the slower door. Venue owners are paying customers who already have Google accounts, and their sign-in protects money: payout routing, vouchers sold. Staff accounts (moderators, admins, the super admin) can change anyone's data; their access is the one place where a second, outside way in widens the attack surface for no gain, since staff are few and set up by an admin. And an account that can be linked to Google must also be able to stop being linked: a tourist who changes Google accounts, or an owner who wants one door, should not need support to do it.

## Decision

- **Continue with Google is offered to tourists in the Android app and the web app, and to venue owners in the console**, beside email and password.
- **Never to staff.** An account holding any staff role signs in with email and password only: identity refuses a Google sign-in, and a new link, for it. An account that gains a staff role keeps its Google link on record, but the link stops opening the account until the role is gone; it signs in with its password, which *Forgot password?* can set.
- **A Google link can be removed** by the account itself, **only when the account has a password** — otherwise it would have no way in — after confirming with the password or with Google. Removing it ends every other session, as a password change does.
- **Adding or removing a Google link is a credential change:** it stamps the account's `credentials_changed_at`, so an owner's payout cooldown ([ADR 0052](./0052-email-change-revert-and-owner-recovery.md)) applies to it as to a password reset.
- **When continuing with Google removes an unverified account's password** (ADR 0062's linking rule), the address also gets an email saying so, besides the app's one-time notice.
- **Local development and the tests use a fake Google issuer**, as `wayfare-fake-gcs` stands in for Cloud Storage: identity trusts signed test tokens from a local key, for any address the test names, and refuses that issuer in production. A real Google Cloud OAuth client is configured only for real builds.

## Consequences

- One Google door for every tourist, Android or iPhone, and for owners — and none for staff, whose sign-in stays as narrow as it is.
- **Owners' Google accounts now guard money.** The payout cooldown covers linking and unlinking, and an owner's Google account becomes part of what support checks in a recovery ([ADR 0052](./0052-email-change-revert-and-owner-recovery.md)).
- **A role change can close a door:** an owner promoted to staff loses Google sign-in; the console must say why when it refuses.
- **The fake issuer is a security boundary of its own:** production must refuse it by configuration that cannot be left on, with a test that proves the refusal.
- **The web and console halves wait for those apps to exist**; the server supports every client from the start.

## See also

- [0062](./0062-tourists-may-continue-with-google.md) — the Google sign-in this widens; its verification and linking rules stand
- [0059](./0059-the-native-app-is-android-only.md) — why the web app is the iPhone tourist's only door
- [0052](./0052-email-change-revert-and-owner-recovery.md) — the payout cooldown that linking and unlinking now trigger
- [0060](./0060-the-web-apps-are-nextjs.md) — the web app and the console that will carry the button
