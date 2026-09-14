# 0043 — Access tokens are signed with an asymmetric key; the gateway can only verify

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

The gateway verifies every access token, and `identity` issues them. With a shared HMAC secret, both hold the key that *mints* tokens — so a compromise of the internet-facing gateway is a compromise of every account, and the secret must be distributed to every service that ever needs to verify.

## Decision

Access tokens are **EdDSA (Ed25519) JWTs**, signed by `identity` with `JWT_PRIVATE_KEY`, which no other service holds. The gateway and any other verifier hold only the public key (`JWT_PUBLIC_KEY`, or a JWKS endpoint served by identity), with a `kid` header to allow rotation.

Refresh tokens and device secrets are opaque random values stored hashed, not JWTs, so they need no signing key at all.

Revocation within an access token's lifetime is by `users.tokens_valid_after`, checked from Redis at the gateway.

## Consequences

- The gateway can verify but never forge. Adding a verifying service is distributing a public key.
- Key rotation needs a two-key overlap window keyed by `kid`.
- architecture-and-tech-stack §14 lists `JWT_PRIVATE_KEY` for identity and `JWT_PUBLIC_KEY` for verifiers, replacing a shared secret.

## See also

- api-endpoints-plan §0.1 · development-conventions §5.4
