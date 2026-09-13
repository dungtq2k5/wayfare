# 0022 — Object storage is GCS, reached through a `StorageProvider` interface

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Place photos, generated MP3s and built PMTiles archives all need object storage. The team already knows Google Cloud Storage; S3-with-MinIO-locally would mean learning a second storage model for no product benefit.

Against that: this application serves a lot of audio and image bytes, and GCS charges for egress where some competitors do not.

## Decision

**GCS**, via `@google-cloud/storage` with a service-account credential. **`fake-gcs-server`** in Compose for local development, so no cloud account is needed day to day.

Reached through a **`StorageProvider` interface** — the same pattern as [0033](./0033-translation-and-tts-behind-provider-interfaces.md). Uploads use **signed URLs**: the client uploads directly to the bucket and tells the API only the resulting object name.

## Consequences

- One storage model to learn, and buckets provisioned through the Firebase console are ordinary GCS buckets, so either entry point works.
- The interface makes egress cost a one-file problem rather than a refactor if it ever matters.
- Signed URLs keep 5 MB photos out of Node processes entirely. They also mean the confirm step is a separate call, so an abandoned upload leaves an object with no database row — needs a cleanup job.
- **Firebase Storage security rules are irrelevant here.** Those govern direct client-SDK access; our writes are backend-mediated through signed URLs and our reads are public objects behind a CDN. Do not write rules that never execute.
- User-supplied filenames must never become object names. Generate them server-side and sniff magic bytes rather than trusting the extension.

## See also

- [0023](./0023-self-hosted-pmtiles-no-tile-vendor.md) — the largest objects stored
