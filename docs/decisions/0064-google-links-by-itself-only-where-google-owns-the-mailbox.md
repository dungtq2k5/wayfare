# 0064 — A Google sign-in links to an existing account by itself only where Google owns the mailbox

**Status:** Accepted · **Date:** 2026-10-19 · **Supersedes:** [0062](./0062-tourists-may-continue-with-google.md) (in part — "an unknown subject whose verified address belongs to an account links to it", and the password removal that goes with it, for every address) · **Superseded by:** —

## Context

[ADR 0062](./0062-tourists-may-continue-with-google.md) links a Google sign-in to the Wayfare account that holds the same address whenever Google's token says `email_verified`, and removes the password of an account whose own address was never verified. That rests on `email_verified` meaning *this person controls this mailbox now*.

It means that only where Google owns the mailbox: a Gmail address, or a Google Workspace domain (the token then carries `hd`). For any other address used as a Google account — a Yahoo or an employer's address — `email_verified` means the address was proven to Google once, possibly years ago; the mailbox may since have changed hands, or the Google account may have been made with an address its owner no longer reads. Linking such a sign-in by itself, and above all removing a password because of it, could hand someone else's Wayfare account to whoever holds that Google account.

## Decision

- **An address Google is authoritative for** — it ends in `@gmail.com` or `@googlemail.com`, or the token carries an `hd` claim (Workspace) — **links by itself**, and ADR 0062's rules stand for it: an existing account links; an account whose address was never verified also loses its password.
- **Any other address** with an existing Wayfare account **does not link by itself**: the server answers that the account's password is needed; the app asks for it once, and a sign-in that carries both the Google token and the account's correct password links. **No password is ever removed for such an address.**
- **Whoever does not know that password** — because someone else registered the address — uses *Forgot password?*: the reset link goes to the address, which proves the mailbox today, sets a new password (ending every session, as a reset does), and the Google sign-in then links with it.
- **An address with no Wayfare account creates one** through Google, authoritative or not, as ADR 0062 says: there is no account to take over.

## Consequences

- The automatic path stays one tap for the common case, Gmail and Workspace accounts; everyone else confirms once, with a password they already have or one the reset sets.
- **The pre-registration defence holds for every address:** for an authoritative one through the password removal, for any other through the reset, which only the mailbox's owner can complete.
- **One more state to design and build:** "enter your Wayfare password to link Google", and a refusal when the password is wrong, counted like a failed sign-in.
- Google's list of authoritative domains is ours to keep: `@gmail.com`, `@googlemail.com` and `hd`; a domain Google later becomes authoritative for is added by a change, not discovered.

## See also

- [0062](./0062-tourists-may-continue-with-google.md) — the sign-in and linking rules this narrows
- [0063](./0063-google-sign-in-reaches-the-web-and-owners-never-staff.md) — who may use Google at all, and unlinking; unchanged
