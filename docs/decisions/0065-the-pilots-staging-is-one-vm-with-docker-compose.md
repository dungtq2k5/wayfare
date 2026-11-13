# 0065 — The pilot's staging is one VM running Docker Compose

**Status:** Accepted · **Date:** 2026-10-23 · **Supersedes:** [0036](./0036-cloud-run-cloud-sql-firebase-hosting.md) (in part — Cloud Run, Cloud SQL, Memorystore and Cloud CDN for staging) · **Superseded by:** —

## Context

[ADR 0036](./0036-cloud-run-cloud-sql-firebase-hosting.md) chose Cloud Run, Cloud SQL and Memorystore for staging. Nothing of it has been built, and the demo build now needs a backend testers can reach from anywhere.

On Cloud Run, the five services' gRPC calls to each other must carry TLS and Cloud Run's IAM identity and pass through a VPC connector; Cloud SQL needs a private IP; NATS still needs a VM, since GCP has no managed NATS. None of that exists in the code today, and all of it is days of infrastructure work before a single tester can sign in. Meanwhile the whole stack — every service, its own Postgres with PostGIS, Redis, NATS — already boots with one `docker compose --profile apps up` locally and in CI, where it is tested on every pull request. The pilot's traffic is a handful of testers and a recorded walk.

## Decision

- **Staging is one Compute Engine VM** (`e2-standard-2`, region `asia-southeast1`, the nearest to Vietnam) **running the repository's Docker Compose stack**: the five services, their Postgres servers, Redis and NATS with a persistent disk, from images built in CI and pushed to **Artifact Registry**, tagged by commit SHA.
- **Caddy**, on the same VM, terminates HTTPS with automatic certificates for `api.wayfare.app` and `go.wayfare.app` (the gateway) and serves **`wayfare.app`'s static pages** — `/.well-known/assetlinks.json`, the privacy policy, the terms, and a landing page for Place and account links opened without the app — until the web app exists ([ADR 0060](./0060-the-web-apps-are-nextjs.md)).
- **Google Cloud keeps what it does best:** **Cloud Storage** for media and map packs (public reads straight from the bucket; no CDN yet), **Secret Manager** for every secret, read when the VM's stack starts, **a nightly `pg_dump` of each database to a Cloud Storage bucket** with a retention policy, and Cloud Logging for the containers' logs.
- **Only the gateway and Caddy are reachable from outside**; every other port binds to the VM's loopback or the Compose network, as locally.
- **Cloud Run stays the plan for production**, revisited by its own ADR when there is production traffic.

## Consequences

- The demo runs on the stack CI already proves, with almost no new code: environment, secrets and a deploy script.
- **One machine is one failure:** if the VM stops, staging stops, and nothing scales. Acceptable for a pilot; a restore from the nightly dumps is the recovery, and it must be rehearsed once.
- **We patch an operating system** and watch a disk: the VM uses Container-Optimized OS, which updates itself, and a disk alert warns before Postgres fills it.
- **A fixed cost** of about $50 a month, with no scale to zero; a budget alert on the project caps the surprise.
- Firebase Hosting is not used for now: `wayfare.app`'s few static files ride on the same Caddy.

## See also

- [0036](./0036-cloud-run-cloud-sql-firebase-hosting.md) — the managed topology this defers; its Artifact Registry, Secret Manager and migrate-from-the-deploy rules stand
- [0011](./0011-one-postgres-server-per-service.md) — one Postgres server per service, kept as is on the VM
- [0060](./0060-the-web-apps-are-nextjs.md) — the web app whose pages Caddy stands in for until it exists
