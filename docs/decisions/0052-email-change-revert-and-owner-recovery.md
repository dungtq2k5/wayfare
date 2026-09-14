# 0052 — Email changes are revertible, credential changes cool payouts down, and owner recovery needs two people

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

Email change notifies the old address, but a victim may lose control of an account before noticing, and an owner who genuinely loses their mailbox has no way back. Talking support into changing an email is the classic takeover, and an owner account routes money.

## Decision

- **Revert:** the "email changed" notice carries a 7-day "this wasn't me" link that restores the old address, revokes sessions and forces a password reset. While it is live the old address stays reserved, and deleting the account, changing the email again, changing payout details and inviting staff are refused.
- **Payout cooldown:** for 7 days after any email change, password reset or completed recovery on an owner account, **changing** payout routing is refused; viewing stays available. Surfaces that cannot separate the two (the Express dashboard) are blocked; embedded components are served with editing features disabled.
- **Owner recovery is support-assisted**, with no public form: at least two evidence checks including a phone callback, **opened and approved by different people holding different permissions**, a 72-hour hold the owner can cancel from any reachable channel, and completion through the normal address-bound link.
- Tourists and staff get no manual override.

## Consequences

- A takeover through a mailbox or a password reset cannot reach payouts for a week.
- Legitimate owners who change credentials wait 7 days to change their bank account.
- Owner recovery requires two different staff; a team that cannot provide them cannot recover owners.

## See also

- rdm-spec I-1, I-9, I-14 · api-endpoints-plan §1.2, §1.10, §5.3
