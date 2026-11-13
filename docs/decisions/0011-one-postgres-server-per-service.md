# 0011 — Each service gets its own Postgres server, with a paired test database

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Service boundaries can be enforced at three strengths: a shared database (convention only), one database with a schema per service (weak), or a database per service (real). The course-level argument is about demonstrating boundaries; the engineering argument is about whether one service can reach another's data by accident.

## Decision

**One Postgres container per service** in Compose. Inside each, two databases: the working database and an automatically provisioned test database.

```text
identity   → wayfare_identity   + wayfare_identity_test
catalog    → wayfare_catalog    + wayfare_catalog_test    (PostGIS)
narration  → wayfare_narration  + wayfare_narration_test
billing    → wayfare_billing    + wayfare_billing_test
```

Connection strings follow one shape, so the test URL is **derivable** rather than separately configured:

```text
DATABASE_URL      = postgresql://user:pass@catalog-db:5432/wayfare_catalog?schema=public
DATABASE_URL_TEST = postgresql://user:pass@catalog-db:5432/wayfare_catalog_test?schema=public
```

Both are created by the container init script on first boot.

## Consequences

- Genuine isolation. A service cannot reach another's data even by mistake, migrations are fully independent, and one service's heavy query cannot affect another's latency.
- A fresh clone plus `docker compose up` yields a working *and* a testable stack with no manual setup, and no way to point a test suite at development data.
- **The cost is developer-laptop RAM** — budget 150–250 MB per container. If that becomes painful the fallback is one server with a database per service; the connection-string shape is unchanged, only the host. **Do not** fall back to a schema per service, which gives away the isolation this decision exists to buy.
- **There are no cross-service transactions.** An operation spanning `catalog` and `billing` cannot be atomic. See [0013](./0013-no-cross-service-foreign-keys.md).
- Staging cannot economically run one managed instance per service. One instance with a database per service is the deployed equivalent.

## See also

- [0013](./0013-no-cross-service-foreign-keys.md) — the consequence that bites
- [0034](./0034-vitest-is-the-only-test-runner.md) — how the test database is used
