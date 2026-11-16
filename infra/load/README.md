# The load test

**k6 image: `grafana/k6:2.3.0`** (pinned in `run.sh`; no npm dependency).

A crowd of tourists against the local Compose stack (architecture §12): the routes a phone and the web map call, at a pilot's size, with budgets the run fails against (product §10). Run by hand before a release and after a change to a hot route — never in CI: a 19-minute run on a shared runner measures the runner.

## Running it

1. **A fresh stack with the load seed.** The stack and its seeds, then 2,000 more live Places in District 1:

   ```sh
   docker compose --profile apps down -v   # wipes the development databases
   docker compose --profile apps up -d --wait
   pnpm db:setup && pnpm --filter @wayfare/catalog storage:setup
   pnpm seed:dev
   pnpm seed:load                           # waits until all 2,000 are live (minutes)
   ```

   `seed:load` makes its Places through catalog's own service, as the pilot seed does, so each has its five languages and its audio; it is additive — a second run keeps what the first made.

2. **The smoke run** — 5 installs for 1 minute, every call once at least; it fails unless every call answers as the contract says:

   ```sh
   pnpm load -- --smoke
   ```

3. **The run** — about 19 minutes:

   ```sh
   pnpm load
   ```

`pnpm load` recreates the gateway with `infra/docker/compose.load.yaml` and restores the normal one when it ends (by hand, should it be killed: `docker compose up -d gateway`). The override believes one `X-Forwarded-For` hop, so each install's own address keys its IP buckets, as for phones on different networks; and it keeps one trace in ten. `LOAD_STACK=screens pnpm load` runs against the screens' disposable stack (`apps/console/e2e/screens/stack.sh`) instead; seed it with that stack's addresses.

The summary is printed and written to `results/` (gitignored): per route and phase, the requests, p50, p95, p99 and errors; the full sync's time, on-demand audio's time to ready, the deltas' size; and the stack's version.

## The crowd

**`tourists`** — each virtual user is one install. Stages: up to 300 over 2 minutes, **hold 300 for 10 minutes**, up to 900 over 30 seconds, **spike** 2 minutes, back to 300 over 30 seconds, **recovery** 3 minutes, down over 30 seconds.

- **Launch** (once): `POST /devices`; analytics consent with its own analytics id; `/areas`, `/categories`, the tourist UI bundle; `/sync/places` page by page to `meta.complete`, and `/sync/tours`; one hotset (a language switch's warm-up). Installs started after the hold are a tour bus that synced at its hotel: a delta from the version the run's setup synced, not a full sync.
- **Every 5 s**: `GET /places/nearby` (1 km, 50) at a point walking along Đồng Khởi and Lê Lợi — a deliberate overestimate: the Android app reads its synced records and never calls nearby; this stands for a web map being panned, the case product §10's number is about. The first tick also reports `POST /telemetry/activity`.
- **Every minute**: `POST /narration/prefetch` with up to three Places — the walk's own call.
- **Every 2 minutes**: listening — `GET /places/:id`, `POST /narration/on-demand` in a long-tail language and its status until the text is ready (polled every half second, to measure when it is ready rather than when a client would look), then `GET /narration/tts/stream` with the device token (Android's way). Long-tail languages are text-only — no voice is pinned for them — so the audio streamed is the Place's English.
- **Every 5 minutes**: one analytics batch of 20 events, and a delta sync (a phone's background sync).
- **The token** is refreshed 14 minutes after it was issued.

Together the narration calls use 16 of the device's 30 `NARRATION_ON_DEMAND` per 10 minutes; every other bucket is further off. **`qr`** — one sticker scanned a second, with no client header and the redirect not followed.

Providers stay fake (translation, speech, payments): the run measures Wayfare, never a vendor's quota or bill.

## The budgets

A route's numbers are tagged with its **phase**; the **hold** is the steady crowd, and only its numbers fail the run. The spike and the recovery are reported, and fail only past 1 % errors.

| Threshold | Budget | Why |
| :---- | :---- | :---- |
| `GET /places/nearby` p95, hold | < 150 ms | product §10 |
| `GET /places/:id` p95, hold | < 200 ms | a Place's page |
| `POST /narration/prefetch` p95, hold | < 300 ms | the walk's call |
| `POST /analytics/events` p95, hold | < 200 ms | a batch |
| `GET /q/:code` p95, hold | < 100 ms | a camera waiting on a redirect |
| `on_demand_ready_ms` p95, hold | < 5 s | from the request to the long-tail text ready (product §10's tier 1.5 is audio, which the long tail doesn't have) |
| `sync_full_ms` p95 | < 1.5 s | a whole paged full sync; first launches happen during the ramp |
| delta page p95 | < 300 ms | a background sync, and the spike's installs |
| a delta's body | < 50 KB | product §10 |
| errors per route, hold | < 0.5 % | a `429` counts: the crowd stays inside every bucket, so one means the limits and the apps disagree |
| errors, spike and recovery | < 1 % | |

**A miss** is explained from Jaeger (`http://localhost:16686`): search the `gateway` service by its span's `http.route` and a minimum duration; the slowest span under it names the fix.

## The latest numbers

**2026-11-11**, the first run: the screens' stack (`LOAD_STACK=screens`), gateway `0.0.0-dev`, 2,018 live Places in District 1, one machine (16 cores) running the stack and k6. 0 errors on every route in every phase; every hold budget held; **the delta's size missed** (below).

| Route | Hold p50 / p95 / p99 (ms) | Spike p95 (ms) | Budget (hold p95) |
| :---- | :---- | :---- | :---- |
| `GET /places/nearby` | 20 / 48 / 70 | 64 | 150 |
| `GET /places/:id` | 6 / 21 / 38 | 57 | 200 |
| `POST /narration/prefetch` | 12 / 52 / 88 | 96 | 300 |
| `POST /analytics/events` | 11 / 19 / 30 | 16 | 200 |
| `GET /q/:code` | 8 / 17 / 32 | 39 | 100 |
| `GET /sync/places`, a delta page | 20 / 42 / 73 | 66 | 300 |

- `sync_full_ms` (the 300 first launches, during the ramp): p50 121, p95 142 — budget 1.5 s.
- `on_demand_ready_ms` (long-tail text): p50 524, p95 561 — budget 5 s. The `202` then told a client to look again after 5 s; it says 1 s now (`ON_DEMAND_RETRY_AFTER_MS`), so a client asks several times inside its 5 s wait.
- **A delta's body: p50 247 KB, max 269 KB — budget 50 KB, missed.** Every long-tail localization the crowd asked for bumped its Place's `sync_version`, so each install's 5-minute delta carried every such Place (363 by the end) whole, about 680 bytes each — though an English install reads nothing that changed. The fix is a sync version per language: a known gap, its own round.
