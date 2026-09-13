# 0036 — Staging runs on Cloud Run, Cloud SQL and Firebase Hosting

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Deployment options ranged from Kubernetes (correct at scale, wrong for this team size) to container platforms such as Fly.io and Render, to Google Cloud — which the storage decision already commits us to.

## Decision

**Cloud Run** for services, **Cloud SQL for PostgreSQL** with PostGIS, **Memorystore** for Redis, **NATS** as a small container, **GCS** behind Cloud CDN, **Secret Manager** for secrets, **Firebase Hosting** for the web apps, **EAS Build** for mobile distribution.

Images go to **Artifact Registry**, tagged by commit SHA. Schema reaches staging through `prisma migrate deploy` per service, run from CI.

## Consequences

- One cloud, already chosen by the storage decision, so there is one set of credentials and one billing account.
- Cloud Run scales to zero, which matters for a project with no traffic between demos.
- Firebase Hosting gives preview channels per pull request for free, which is genuinely useful in review.
- **The local topology of one Postgres server per service does not survive economically into staging.** One Cloud SQL instance with a database per service is the deployed equivalent; the connection-string shape is unchanged, only the host. This is the intended compromise, not a drift.
- There is no managed NATS on GCP, so JetStream persistence is our operational problem — it needs a volume and a backup story.
- Cold starts are real on Cloud Run. If they become an irritation the containers are portable to Fly.io or Render without code changes.

## See also

- [0022](./0022-gcs-behind-a-storage-provider-interface.md) — the decision that anchors the cloud
- [0011](./0011-one-postgres-server-per-service.md) — the local topology this compromises on
