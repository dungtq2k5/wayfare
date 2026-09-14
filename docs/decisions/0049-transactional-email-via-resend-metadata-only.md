# 0049 — Transactional email goes through Resend, and only delivery metadata is recorded

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

Dunning is the first flow where an unread email has a visible consequence: a lapsed subscription unpublishes an owner's places. "You never emailed me" must be answerable from our own data. No provider had been chosen, and Firebase offers no general transactional sending with delivery webhooks.

## Decision

- **Resend** sends in staging and production, behind the `EmailProvider` interface; local development uses Nodemailer to a local mail catcher.
- **One `email_deliveries` row per send**, written before sending, which is also the guarantee of one email per triggering event.
- **Metadata only**: never the body, subject or links (links carry single-use tokens). The address is stored masked and as a **keyed** hash.
- **Statuses only move forward**; `BOUNCED` and `FAILED` are final. A hard bounce sets `users.email_bounced_at` and shows the owner a banner; a complaint does not.
- **Open and click tracking are off.** Outside production, email reaches only an allowlist of team addresses.
- Security emails are always attempted; in-app notifications remain the primary channel.

## Consequences

- Support can answer delivery disputes without storing anything that could take over an account.
- A new webhook route, table and user column exist, plus provider configuration that must stay correct (tracking off).
- Correctness does not depend on the provider's own idempotency support.

## See also

- rdm-spec I-13 · api-endpoints-plan §1.9 · architecture-and-tech-stack §10
