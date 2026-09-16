# Product Overview — Wayfare

**Audience:** the developers on this team.

**Purpose:** answer one question — *what software are we actually building?*

**Companion docs:** [`architecture-and-tech-stack.md`](./architecture-and-tech-stack.md) answers *what do I need to know before I write code?* — and [`decisions/`](./decisions/) records *why*, one decision per file, permanently. Read this file first.

This document describes the product as it is intended to be. Where a choice was contested, the reasoning lives in an ADR rather than here, and is cited inline.

---

## Table of contents

1. [In one paragraph](#1-in-one-paragraph)
2. [The problem](#2-the-problem)
3. [Actors](#3-actors)
4. [Product surfaces](#4-product-surfaces)
5. [Domain glossary](#5-domain-glossary)
6. [Feature catalogue](#6-feature-catalogue)
7. [Key user journeys](#7-key-user-journeys)
8. [Business model and payments](#8-business-model-and-payments)
9. [Behavioural constants](#9-behavioural-constants)
10. [Non-functional requirements](#10-non-functional-requirements)
11. [Service decomposition](#11-service-decomposition)
12. [Scope and phasing](#12-scope-and-phasing)
13. [Success metrics](#13-success-metrics)
14. [Risks](#14-risks)

---

## 1. In one paragraph

**Wayfare is a self-guided, multilingual audio travel companion for Vietnam.** A tourist lands in a Vietnamese city, opens the app, picks their language, and starts walking. As they approach a registered place — a temple, a street-food stall, a viewpoint, a restaurant — the app detects it by GPS and **plays a narration in the tourist's own language, automatically, hands-free, with the phone in their pocket**. No local guide, no tour group, no schedule. It works offline, because a tourist on a foreign SIM usually has bad or no data. The places themselves are **registered and maintained by their owners** through a web portal; owners pay a subscription to be listed, promoted, and to sell vouchers in-app — **that is where the platform's revenue comes from**, handled end-to-end by **Stripe**.

**What it is:**

- An automatic, GPS-triggered, multilingual audio guide (a "walking tour that follows you").
- A discovery map of curated places and food, with owner-maintained content.
- A B2B SaaS + marketplace for venue owners (subscription + commission).
- Offline-first: a downloaded city works with airplane mode on.

**What it is *not*:**

- Not a hotel/flight booking OTA (no Booking.com / Agoda clone).
- Not a food-delivery app.
- Not a social network or a review site (ratings are a later, optional feature).
- Not a live human-guide marketplace.
- Not a general-purpose maps app — we do not compete with Google Maps on navigation.

---

## 2. The problem

A foreign tourist walking around Ho Chi Minh City hits four walls at once:

| Wall | Concrete symptom | How Wayfare answers it |
| :---- | :---- | :---- |
| **Language** | Signs, menus and stories are in Vietnamese only. Staff may not speak English. | Content is authored once in Vietnamese and served in the tourist's language as text **and** audio. |
| **Context** | They walk past a 200-year-old pagoda or a famous 40-year-old noodle stall and have no idea. | Geofenced auto-narration fires when they are physically near it. |
| **Connectivity** | Roaming is expensive, local eSIM coverage is patchy, and data dies exactly when they are lost. | Offline packs: map + content + images + audio downloaded over hotel Wi-Fi. |
| **Trust / discovery** | Small authentic places are invisible online; tourists default to the same few TripAdvisor spots. | Owners self-register and maintain their own listing; moderation keeps quality up. |

And the **owner** of a small local place has a symmetrical problem: real tourist foot traffic walks past the door every day and cannot be converted, because nothing in the shop speaks the tourist's language. Wayfare sells that owner a channel.

---

## 3. Actors

| # | Actor | Auth | Primary surface | What they care about |
| :---- | :---- | :---- | :---- | :---- |
| **A1** | **Tourist** (end user) | **Anonymous by default.** Optional account, required only to purchase or sync across devices. | Mobile app (primary), Web PWA (secondary) | Hearing the right story at the right moment, in their language, without burning battery or data. |
| **A2** | **Venue Owner** (paying customer) | Account + email verification + **manual identity verification by an admin** | Web console → Owner Portal | Getting listed, looking good, being found, selling vouchers, getting paid, seeing their own stats. |
| **A3** | **Content Moderator / Admin** | Account + role + permissions | Web console → Admin Console | Approving owners and submissions, keeping data clean, running TTS jobs, watching the platform. |
| **A4** | **Super Admin** | Bootstrapped account | Web console → Admin Console | Roles, permissions, system config, audit, billing oversight. |
| **A5** | **Platform workers** | service credentials | — | Background TTS generation, translation warmup, media cleanup, analytics rollups, Stripe webhook processing. |

### 3.1 Why the tourist is anonymous

[ADR 0003](./decisions/0003-anonymous-device-is-the-primary-identity.md)

This is a deliberate product decision, not laziness. The tourist must get value within 60 seconds of landing, with no signup wall — a registration form in front of someone who just cleared customs at Tân Sơn Nhất is the easiest way to lose them. Anonymity also makes analytics privacy-by-design (see §10).

An account is introduced only when it buys the tourist something concrete: a purchase (Stripe needs a customer), cross-device sync, or durable favourites.

**The design consequence you must not miss:** the **anonymous device is the primary identity**, and `userId` is a nullable column hanging off it. Favourites, listen history and cooldown state key on the device ID. When a tourist later creates an account, that device's data is **claimed** by the new user rather than migrated. Getting this backwards — making `userId` primary and bolting anonymity on later — is a schema migration you will not enjoy.

---

## 4. Product surfaces

We ship **three** front-end surfaces from one monorepo.

### 4.1 `apps/mobile` — Tourist app (React Native / Expo) — **primary surface**

The one that matters. Native app because the core feature (background GPS + geofence + background audio) is only reliably possible natively.

Screens: Splash / language picker → Map → Nearby list → Place detail → Now-playing narration → QR scanner → Tours → Offline downloads → Purchases → Settings.

### 4.2 `apps/web` — Tourist web PWA (React + Vite)

Same content, degraded capability. It exists because (a) a tourist should be able to try Wayfare from a QR sticker on a bus stop without installing anything, and (b) it is the cheapest way to demo the product. Browser geolocation only works with the tab open, so the PWA offers **manual "narrate this place"** and **QR activation** instead of true background geofencing.

### 4.3 `apps/console` — Web console (React + Vite)

One React application, two role-gated areas:

- **Owner Portal** (A2): my places, edit content, upload photos, submit for review, notifications, subscription & billing, payouts, my stats.
- **Admin Console** (A3/A4): owner registrations queue, submission review queue, place CRUD, users & roles, TTS job monitor, analytics dashboards, audit log.

These two *could* be separate apps. Keep them as one app with route-level RBAC — half the screens (place editor, media uploader, map picker) are shared, and duplicating them is the single easiest way to fall behind.

---

## 5. Domain glossary

Use these words in code, tickets and commit messages. Consistency here is worth more than it sounds.

| Term | Meaning |
| :---- | :---- |
| **Place** | A physical location with content: restaurant, stall, temple, viewpoint, market, bus stop. Our central entity. (An earlier prototype called this a **POI**; we use **Place** in product language and `Place` in code.) |
| **Editorial Place** | A Place with no commercial owner — a temple, a viewpoint, a public landmark. Authored by staff. Always narrates. |
| **Venue** | A Place that is commercially owned and claimed by an Owner. Only Venues generate revenue, and Venue narration is gated on subscription (§8.3). |
| **Narration** | The audio+text story attached to a Place, per language. |
| **Localization** | One `(place, language)` record: translated title, description, and a generated `audioUrl`. |
| **Trigger radius** | Metres from a Place's coordinates within which its narration may fire. Per-place, default 30 m, **admin-set and capped — never purchasable**. |
| **Narration priority** | Editorial integer deciding which story wins when several Places trigger at once. **Admin-set, never purchasable** (§8.3). |
| **Discovery boost** | Paid ranking weight affecting *visual* surfaces only — nearby list order, marker prominence, recommendations. Always labelled *Sponsored*. |
| **Geofence event** | `ENTER` / `EXIT` produced by the client-side engine after debounce, not raw GPS. |
| **Cooldown** | Minimum time before the same Place may narrate again to the same device. |
| **Narration queue** | Single-slot priority queue on the client. One narration plays at a time; a higher-priority one preempts. |
| **Tour** | An ordered, curated set of Places with a theme ("District 1 landmarks, 2 hours"). Can be free or paid. |
| **Offline pack** | A verified, versioned bundle for one city+language: map tiles + place data + images + audio. |
| **Map pack** | The map-tile half of an offline pack (PMTiles + style + glyphs + sprites). Versioned separately because it is the biggest and changes least. |
| **Submission** | An owner's proposed create/update of a Place, pending admin review. Never visible to tourists until approved. |
| **Registration** | An owner's application to become a verified Owner, pending admin review. |
| **Entitlement** | What an account is allowed to do *right now*, derived from its Stripe subscription state (e.g. `maxPlaces: 10`, `autoNarration: true`, `aiCredits: 10/day`). |
| **Consent** | Explicit tourist opt-in to analytics collection. No consent → no event ingest. Not a cookie-banner formality; it gates the ingest endpoint. |
| **Dataset version** | Monotonic token for the whole public place corpus, used for ETag / delta sync. |
| **Hotset** | The nearest N places pre-translated and pre-cached so a language switch feels instant. |

---

## 6. Feature catalogue

Priority: **P0** = the core product, must exist. **P1** = complete product. **P2** = stretch.

### F1 — Discovery & Map (P0)

- Vector map showing the tourist's live position and all nearby Places.
- Place markers styled by category; the currently nearest Place is highlighted.
- Nearby list sorted by distance, with distance and walking ETA. Ranking may be influenced by **discovery boost**, and any boosted entry is labelled *Sponsored*.
- Place detail: photos, translated description, menu (for food venues), opening hours, price range, "Play narration", "Open in Google Maps", "Get directions".
- Search & filter by category, language availability, price band, open-now. *(P1)*
- Tours browser: themed routes, ordered stops, progress-through-tour. *(P1)*

**Acceptance:** on a cold start with no network, the map renders and shows at least the last synced Places within 3 s.

### F2 — Real-time location & geofence triggering (P0) — *the heart of the product*

- Continuous position acquisition, **foreground and background**, on mobile.
- Battery-conscious: throttled updates, distance filters, reduced accuracy while stationary.
- Client-side geofence engine evaluates the tourist's position against Place trigger radii.
- **Debounce** before confirming an `ENTER` (GPS jitter must not fire narration).
- **Cooldown** per Place per device (no spam when the tourist sits down inside a radius).
- **Priority resolution** when several Places are in range: highest `narrationPriority`, then nearest. This is editorial only — see §8.3.
- **Commercial narration cap:** at most one Venue narration per 10 minutes of walking, counted separately from Editorial Places. Without this, a food street becomes an ad loop even with honest ranking.
- A safety reconcile pass so a missed event self-heals instead of hanging.
- Dynamic geofence re-registration: only the nearest N Places are registered with the OS at any time (see §14 — the OS caps this).
- Visible, honourable permission UX: explain *why* background location is needed, degrade gracefully to foreground-only if refused.

**Acceptance:** walking a 1 km test route with 6 Places, each narration fires once, in the correct order, with the screen off.

### F3 — Multilingual narration (P0)

- Content authored once in **Vietnamese**; served in the tourist's chosen language.
- **Launch languages:** `vi`, `en`, `zh`, `ja`, `ko`. Any other locale falls back to English while being machine-translated in the background.
- **4-tier audio fallback** — the tourist always hears *something*:

  | Tier | Source | Latency | When |
  | :---- | :---- | :---- | :---- |
  | 1 | Pre-generated audio file, cached on device | ~0 ms | Normal case; audio already exists for this `(place, lang)`. |
  | 1.5 | On-demand translate + TTS on the server, result stored | 2–5 s | This `(place, lang)` has no audio yet. |
  | 2 | Server TTS streamed live | 3–8 s | Storage write failed / cold path. |
  | 3 | On-device OS speech synthesis | ~0 ms | **Offline.** Lower quality, always available. |

- **3-tier content (text) fallback:** requested language → English → original Vietnamese. The client is told which tier it got, so the UI can say "shown in English".
- Narration queue: one at a time, no duplicates, auto-pause on incoming phone call or other audio, resume after.
- Player UI: now-playing card, transcript, replay, skip, speed, per-language voice choice.
- Background prefetch: translate+synthesise the nearest un-synthesised Places ahead of the tourist, rate-limited and backoff-aware.
- **Pronunciation dictionary** ([ADR 0006](./decisions/0006-neural-tts-only-no-human-recording.md)) for Vietnamese proper nouns — place names, dish names, street names — applied as SSML overrides before synthesis. "Bánh xèo" and "Bến Thành" mangled by an English neural voice is where perceived quality actually dies; this costs nothing and matters more than voice selection.

**Acceptance:** switching language mid-walk never plays the previous language's audio, and a stale in-flight on-demand result is discarded.

### F4 — QR activation (P0)

- Printed QR codes at bus stops, shop doors, museum plaques.
- Scanning opens the Place directly and starts narration — **no GPS, no permission, no install** (the QR resolves to a web URL that deep-links into the app if installed).
- Rationale: GPS fails indoors, in alleys, and under dense urban canopy. QR is the manual override and the zero-friction acquisition channel.

### F5 — Offline mode (P0)

Four layers of defence, so the tourist never sees a blank screen:

1. **HTTP/asset cache** — service worker (web) / persistent HTTP cache (mobile), per-language sharded so switching language cannot evict the language in use.
2. **Local database** — IndexedDB (web) / SQLite (mobile) holding the synced Place corpus per language.
3. **Explicit offline packs** — user-initiated download of map + places + images + audio for a city+language, installed in that order, each asset **SHA-256 verified before activation**.
4. **Graceful degradation** — content falls back target → en → vi; audio falls back to tier 3 (on-device TTS); map falls back to the packaged pack.

- **Two map modes, not three.** Because we self-host our own PMTiles archive ([ADR 0023](./decisions/0023-self-hosted-pmtiles-no-tile-vendor.md)), "online" is the *same file* read over HTTP range requests, and "offline" is that file downloaded whole. There is no third-party tile API, no key, no quota, and no separate cloud-vs-hybrid code path.
- Delta sync: the client sends its dataset version and `updatedAfter`; the server returns only changes plus a list of removed Place IDs.
- Storage manager UI: what is downloaded, how big, update available, repair, delete.
- Disk-full handling: sacrifice runtime caches to preserve an explicitly downloaded pack.

**Acceptance:** enable airplane mode after installing a pack; map, places, images and audio all still work.

### F6 — Owner Portal (P0)

- Public self-service registration as a venue owner.
- Identity verification: owner submits business/ID details; **national ID numbers are encrypted at rest and auto-redacted after 180 days**; an admin approves or rejects.
- Owner is gated: until `ownerVerified === true`, the portal shows only registration status.
- Manage **only my own** Places: title, Vietnamese description, category, coordinates (map picker), opening hours, price range, up to 8 photos (≤5 MB each), menu items. Trigger radius and narration priority are **admin-controlled and not editable by owners** (§8.3).
- Every create/update becomes a **Submission** requiring admin approval before it is public.
- Notifications: in-app bell + detail page for review outcomes, with the admin's note.
- Subscription & billing: plan comparison, upgrade/downgrade, invoices, payment method, cancel — all via Stripe's hosted surfaces.
- Payouts: connect a payout account, see voucher sales and transfers. *(P1)*
- My stats: how many tourists heard my narration, listen-through rate, peak hours. *(P1)*

### F7 — Admin Console (P0)

- Registrations queue: approve/reject with a note.
- Submissions queue: side-by-side diff of proposed vs live, approve/reject with a note.
- Full Place / Menu / Tour CRUD for Editorial Places (temples, viewpoints — things with no owner).
- Editorial controls that owners never see: `narrationPriority`, `triggerRadius`, category curation.
- **Activation gate:** a Place cannot go public until its English localization and audio are ready. Editing the description invalidates existing audio, flips the Place to `processing`, and remembers that activation was requested.
- Users & dynamic roles: create roles, assign permissions from a fixed permission catalogue.
- TTS job monitor: queued/running/paused/failed jobs with **live progress** and pause/resume/cancel.
- Pronunciation dictionary editor for proper nouns (F3).
- Audit log: who did what to which resource, when.
- Analytics dashboards. *(P1)*
- Runtime location observability: an aggregate, non-consent, coarse "how many devices are active where" window — deliberately kept in a **separate lane** from consented analytics. *(P1)*

### F8 — Monetization & payments (P0) — see §8 for the full model

- Owner subscription tiers, self-service checkout and management (Stripe Billing).
- Entitlement enforcement: plan limits gate place count, **auto-narration**, languages, AI credits, discovery boost and analytics depth.
- Discovery boost: paid ranking weight on visual surfaces, clearly labelled *Sponsored*. *(P1)*
- In-app vouchers sold on behalf of a venue, platform takes a commission, venue gets paid out (Stripe Connect). *(P1)*
- Tourist-side purchases of platform-owned premium content. *(P2 — read the app-store caveat in §14 first.)*

### F9 — Analytics (P1)

**Consent-gated. Anonymous. Aggregate.**

- Anonymous device ID, not a user ID. Ingest endpoint refuses events without consent.
- Events: narration started / completed / abandoned, place opened, QR scanned, language chosen, pack installed, search performed.
- Read models: most-heard Places, average listen duration per Place, completion rate, language distribution, hourly/daily activity.
- Anonymised movement traces → **heatmap** of tourist density. Coordinates snapped to a grid before storage; no raw trace is ever joinable back to a device across sessions.
- Owner-scoped slice: an owner sees only their own Places' numbers.

### F10 — AI assist (P1)

- **Description enhancement** for owners: takes the owner's rough Vietnamese text and returns a polished 200–300 word version. Hard prompt constraint: **may improve tone and add positive adjectives, may not invent facts** (no fake history, no fake awards, no fake prices).
- Quota: owners get a small daily allowance (10/day); admins unlimited.
- *(P2)* Itinerary suggestion: "I have 3 hours near Bến Thành, I like seafood" → a generated mini-tour from existing Places.

### F11 — Identity, roles & privacy (P0)

- Three auth contexts: anonymous tourist, authenticated tourist, staff/owner.
- **Anonymous device is the primary identity** (§3.1); account creation *claims* a device's history rather than migrating it.
- Web console uses **httpOnly cookies** (XSS-safe) with short access tokens and rotating refresh tokens; mobile uses bearer tokens in the OS secure store.
- **Static permission catalogue in code + dynamic roles in the database.** Permissions are a closed set the code knows about; roles are rows an admin can create and edit.
- Default roles: `super_admin`, `admin`, `venue_owner`, `user`.
- Route guards declare the permission they need (`place:delete`), not the role.
- PII (national ID) encrypted at rest, decrypted only when an admin actually views it, auto-redacted after 180 days, never logged.
- Data deletion: an authenticated tourist can delete their account. Their personal data is erased; their purchase records are kept in anonymised form because tax and dispute handling require them ([ADR 0048](./decisions/0048-erasure-anonymises-purchases.md)).

---

## 7. Key user journeys

### J1 — Tourist first run (cold, on hotel Wi-Fi)

1. Install → splash → **language picker** (5 top languages + "other").
2. App asks for location permission with a plain-language reason. Foreground first; background is requested later, in context, the first time a narration fires.
3. In parallel: read whatever is already in the local DB (instant render), request a best-effort position (prefer a recent cached fix), and full-sync the Place corpus.
4. A **startup network probe** with a short timeout decides "offline" vs "slow" before the UI accuses the network of being down.
5. App offers: *"Download Ho Chi Minh City for offline use — 180 MB"*. Strongly suggested while on Wi-Fi.
6. Map appears with the tourist's dot and nearby Places. **Quick-start in English is allowed** while the chosen language's hotset and UI bundle finish warming in the background; the app switches over when both lanes are ready.

### J2 — The core loop: walking and hearing (P0, demo this one)

1. Tourist puts the phone in their pocket and walks. Screen off.
2. Location updates arrive, throttled.
3. Geofence engine finds the tourist is inside the trigger radius of *Cô Ba's noodle stall*.
4. It waits out the **debounce** window. Still inside → confirm `ENTER`.
5. Two other Places are also in range. Priority sort picks the winner by `narrationPriority`, then distance.
6. Narration queue is empty → play. Tier 1: the audio file is already in the device cache → starts in milliseconds.
7. Phone vibrates once, lock screen shows a now-playing card with the Place name.
8. Narration finishes. The Place enters **cooldown**. Analytics (if consented) records a completed listen.
9. Tourist walks on. `EXIT` fires. Meanwhile the app has quietly prefetched narration for the next three un-synthesised Places ahead.

### J3 — QR fallback (indoors, GPS useless)

1. Tourist is inside a market. GPS is 80 m off.
2. They scan the QR sticker on a stall.
3. The URL resolves to that Place; the app opens the detail sheet and starts narration immediately — no GPS involved.
4. If the app is not installed, the same URL opens the web PWA and narration still plays.

### J4 — Language switch mid-walk

1. Tourist switches `en` → `ja`.
2. App requests the **hotset** — the nearest ~10 Places within 1.5 km — to be translated and synthesised with priority.
3. The switch is only reported as complete when **both** lanes are ready: the content hotset (≥3 mandatory Places cached) **and** the UI string bundle for `ja`.
4. Until then, UI and content stay in English rather than showing a half-translated screen.
5. Any on-demand audio that was in flight for `en` when the switch happened is discarded, not played.

### J5 — Owner onboarding → first paid month

1. Owner finds the console, registers with email + business details + ID number.
2. Account is created as `venue_owner`, **unverified**. A registration row goes to the admin queue. ID number is encrypted immediately.
3. Admin reviews, approves. Owner is now verified and gets a notification.
4. Owner logs in, lands on the plan page. Free tier gives 1 place, `vi`+`en` text, **narration on tap only — no auto-narration**.
5. Owner picks **Growth** → Stripe Checkout (hosted) → pays.
6. Stripe webhook arrives → billing service writes the subscription state → **entitlements update** → the Venue's auto-narration switches on, the place limit rises to 10, all 5 languages unlock, and stats appear.
7. Owner clicks "Manage billing" → Stripe Customer Portal for invoices, card changes, cancellation. We build none of that UI.

### J6 — Owner publishes a place

1. Owner fills in the Vietnamese description, drops a pin, uploads 5 photos, adds 8 menu items.
2. Optionally clicks **"Improve with AI"** → polished Vietnamese text returned → owner edits and accepts. One AI credit consumed.
3. Owner submits. Status: `pending review`. Nothing is public yet.
4. Admin sees the submission, compares it with the live version, sets `triggerRadius` and `narrationPriority`, approves with a note.
5. Approval triggers a **TTS job**: translate to the 5 launch languages, apply the pronunciation dictionary, synthesise audio, store, upsert localizations. The admin watches live progress.
6. Only when English text + audio are ready does the **activation gate** open and the Place become publicly visible.
7. Owner gets a notification. The next tourist sync picks the Place up via delta sync.

### J7 — Tourist buys a venue voucher *(P1)*

1. Tourist opens a Venue and sees *"Tasting set — $6 — save 20%"*.
2. Buys in-app. Platform runs the checkout, keeps a 15% commission, and the remaining 85% is destined for the venue's connected payout account.
3. A Stripe webhook — **not** the success screen — is what actually issues the voucher.
4. Tourist gets a QR voucher in "My purchases", valid offline **on the device that bought it, on mobile or web**. It is a bearer voucher: whoever shows it first redeems it.
5. Venue staff scan it on a redeem-only staff login — never the owner's account ([ADR 0047](./decisions/0047-venue-staff-are-memberships-not-roles.md)). Redemption is idempotent — one voucher cannot be burned twice.
6. Owner sees the sale, the commission and the upcoming payout in their portal.

---

## 8. Business model and payments

All money moves through **Stripe**, and **all prices are in USD, always** ([ADR 0004](./decisions/0004-usd-only-with-amounts-in-integer-cents.md)). There are three distinct flows and they are *not* the same integration — conflating them is the most likely architectural mistake in this project.

### 8.1 Revenue streams

| # | Stream | Who pays | Who receives | Stripe product |
| :---- | :---- | :---- | :---- | :---- |
| **R1** | **Owner subscription** — the core business | Venue Owner | Platform (100%) | **Stripe Billing** + Checkout (`mode: 'subscription'`) + Customer Portal |
| **R2** | **Discovery boost** — paid ranking on visual surfaces | Venue Owner | Platform (100%) | Billing add-on price, or a one-off Checkout Session |
| **R3** | **Voucher commission** | Tourist | Venue (85%) + Platform (15%) | **Stripe Connect**, destination charges, `application_fee_amount` |
| **R4** | *(P2)* Premium platform content | Tourist | Platform (100%) | Checkout Session, `mode: 'payment'` |

R1 is the business. R3 is the growth story. Build R1 first and completely; R3 is a P1 feature; R4 is a stretch goal with a real app-store complication (§14).

### 8.2 Owner plans

| | **Free** | **Growth** | **Pro** |
| :---- | :---- | :---- | :---- |
| Price | $0 | $9/mo · $90/yr | $29/mo · $290/yr |
| Places | 1 | 10 | 50 |
| **Auto-narration (GPS-triggered)** | **✗ — on tap only** | **✔** | **✔** |
| Narration languages | `vi`, `en` | all 5 | all 5 + long-tail |
| Photos per place | 3 | 8 | 8 |
| Menu items | 10 | unlimited | unlimited |
| Discovery boost slots | 0 | 1 | 5 |
| AI enhancement credits | 0 | 10/day | 10/day |
| Own analytics | — | basic | full + export |
| Sell vouchers | — | ✔ (15%) | ✔ (10%) |

Each plan is a **separate Stripe Product** with monthly and annual **Prices**. Do not put three tiers' prices on one Product — invoices and Checkout show the Product name, and the customer would not be able to tell tiers apart.

### 8.3 What money can and cannot buy — the ranking firewall

[ADR 0007](./decisions/0007-paid-placement-never-reaches-the-audio-channel.md)

This is the most important product rule in the document, and it is easy to get wrong because the commercially obvious answer is the wrong one.

**Auto-narration is push, interruptive, exclusive and hands-free.** One thing plays at a time, the tourist did not ask for it, and the phone is in their pocket so skipping is expensive. If paid placement could win that slot, a tourist standing in front of Notre-Dame Cathedral would hear a bubble tea ad instead of the cathedral's story. That is not a degraded experience, it is the end of the product — the audio channel is the only thing here that cannot be ignored, and selling it sells the user's attention against their own interest.

So the single `audioPriority` field from the original design splits into three, with different owners and different rules:

| Field | Set by | Purchasable | Affects |
| :---- | :---- | :---- | :---- |
| `narrationPriority` | Admin, editorially | **Never** | Which story wins when several Places are in range |
| `discoveryBoost` | Entitlements (R2) | **Yes** | Nearby-list order, marker prominence, recommendations — all labelled *Sponsored* |
| `triggerRadius` | Admin, capped | **Never** | Geofence size |

`triggerRadius` matters as much as priority. If owners could buy it, a food street becomes venues with 200 m radii hijacking every narration on the block.

**The line that generalises:** paid placement is allowed in **pull** surfaces the tourist chose to open — map, list, search, recommendations, inclusion in a curated tour. It is never allowed in the **push** surface they did not — auto-narration.

**The paywall that does work.** Gate whether a Venue gets auto-narration *at all* on the subscription, per §8.2. Free tier = on the map with text, narration on tap. Growth and above = auto-narration enabled. The owner pays for the channel to exist, not for the right to interrupt louder than the shop next door. Editorial ranking stays clean and the subscription gets something genuinely valuable to sell.

Two guards that make this hold in practice:

- **Editorial Places always narrate**, regardless of subscription — they have no owner and no plan. A temple must never be outranked or silenced by a paying café.
- **At most one Venue narration per 10 minutes of walking**, counted separately from Editorial Places (§9). Honest ranking alone does not stop a commercial street from becoming an ad loop.

### 8.4 Entitlements — the bridge between Stripe and the app

Stripe is the source of truth for *subscription state*; our `billing` service is the source of truth for *what that means*.

```text
Stripe webhook  →  billing service  →  entitlement record  →  every other service reads it
```

- The subscription lifecycle is **webhook-driven**: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`. Renewals, card failures, dunning and cancellations all happen *after* checkout and are invisible to anything that only reads the success page.
- Entitlements are cached (Redis) and read synchronously by `catalog` before allowing a place create, an auto-narration toggle, a discovery boost, or an extra language.
- Downgrade is graceful: exceeding the new limit does not delete data, it **unpublishes** the excess and tells the owner which places to pick. Losing auto-narration does not delete the audio — it stops the trigger.
- Dunning: `invoice.payment_failed` → in-app banner + email; after Stripe exhausts retries, fall back to Free-tier entitlements rather than deleting anything.

### 8.5 Marketplace configuration (R3)

The platform aggregates venues and runs checkout on their behalf, so the **platform is merchant of record**. That fixes the whole configuration:

- **Destination charges** with `application_fee_amount` for our commission.
- Connected accounts created via the **Accounts v2 API** with a **recipient** configuration requesting `stripe_balance.stripe_transfers`. Do *not* request merchant/`card_payments` for a marketplace recipient — it makes onboarding longer for no benefit.
- `dashboard: "express"`, `fees_collector: "application"`, `losses_collector: "application"`. Consequence: **we absorb negative balances and dispute liability.** Budget for it.
- Readiness check before any transfer: `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === 'active'`.
- Onboarding through Stripe's embedded **`account_onboarding`** component, plus the **`notification_banner`** component in the Owner Portal so accounts stay healthy as Stripe's requirements change.
- **Commission: 15%, reduced to 10% on Pro** ([ADR 0005](./decisions/0005-voucher-commission-and-processing-fees.md)). Klook and GetYourGuide take 20–30%, as do delivery apps; 15% reads as generous, clears Stripe's cut comfortably, and leaves real margin. The Pro discount gives the subscription a second reason to exist — it pays for itself past a sales threshold, which is a far easier sell than feature limits.
- **The platform absorbs Stripe's processing fees out of its own 15%; the venue receives a clean 85%.** Simpler to explain to an owner and simpler to reconcile than netting fees off their side.
- Multi-venue carts (one payment split across several venues) would require *separate charges and transfers* instead. **Out of scope** — one venue per transaction.

### 8.6 Non-negotiable payment rules

1. **Never** put a Stripe secret key in the mobile app, the web app, or any client code. Every Stripe call goes through our backend.
2. **Never** pass `payment_method_types`. Omit it and let Stripe pick payment methods dynamically from Dashboard settings — hardcoding `['card']` locks out everything else. Voucher checkout is limited to **instant** methods through a Stripe payment method configuration, never through `payment_method_types`, because a voucher must work the moment it is bought.
3. **Verify every webhook signature** before processing. Treat the signing secret like a secret key.
4. **Fulfil from webhooks, not from the success page.** A tourist can pay and immediately lose connectivity; a success-page-driven voucher silently never gets issued. Also handle `checkout.session.async_payment_succeeded` / `_failed`, and only fulfil when the session's `payment_status` is not `unpaid`.
5. **Idempotency everywhere:** store the Stripe event ID and ignore replays. Stripe retries.
6. Use **restricted API keys** (`rk_`), one per service, least privilege — not a full secret key.
7. Never trust an amount sent by a client. Prices come from our database / Stripe Prices.
8. **Tax is not automatic.** Enabling `automatic_tax` without an active tax registration in the customer's jurisdiction collects **zero** tax and returns **no error** — the worst kind of bug. We sell to Vietnamese businesses and to international tourists, so treat VAT/GST as an explicit open risk (§14), not an afterthought.

---

## 9. Behavioural constants

These are **product** decisions, not implementation details. They must be configurable, and every one of them has a reason. These values are inherited from an earlier prototype of the same idea, where they were tuned against real walking tests — so treat them as informed starting points, not guesses, and re-tune them with evidence.

| Constant | Value | Why |
| :---- | :---- | :---- |
| GPS update throttle | 5 s | Below this, battery and re-sorting cost outweigh accuracy gains while walking. |
| Geofence debounce | 3 s | Urban GPS jitters ±20 m. Firing on the first sample narrates the wrong place. |
| Default trigger radius | 30 m | Roughly "you can see the shopfront". Admin-overridable per place, hard-capped. |
| Narration cooldown | 5 min | Tourist sits down inside a radius; must not loop. |
| Commercial narration cap | 1 Venue narration / 10 min | Stops a commercial street becoming an ad loop. Editorial Places are exempt. |
| Safety reconcile interval | 5 s | Self-heals a dropped event instead of hanging silently. |
| Nearby prefetch | top 3 per batch, ≥30 s between batches | Warms audio ahead of the walker without hammering TTS. |
| Prefetch backoff on 429 | 30 s → 60 s → 120 s → … cap 10 min | Be a good citizen of our own rate limiter. |
| Hotset radius / size | 1500 m / 10 places | The realistic "next 20 minutes of walking". |
| Hotset ready threshold | 3 places cached | Enough to make a language switch feel done. |
| Locate request budget | 15 s, accept cached fix ≤30 s old, accuracy ≤100 m | A first fix can take 30 s+; a slightly stale fix beats a spinner. |
| Startup network probe | 2.5 s timeout, max 2 attempts in an 8 s window | Decide "offline" fast, but do not libel a slow network. |
| Place cache TTL | 15 min | Content changes rarely; delta sync covers the rest. |
| Audio cache cap | 300 files per language, max 3 languages, LRU | Bounded disk with the active language pinned against eviction. |
| Max photos / size | 8 per place / 5 MB each | Owner content quality vs. pack size. |
| Concurrent TTS jobs | 3 | Protects the TTS provider and our own CPU. |
| On-demand rate limit | 30 requests / 10 min / device | Anti-abuse on an endpoint that costs us real work. |
| Access / refresh token TTL | 30 min / 7 days | Short access window, rotating refresh. |
| AI credits | 10/day per owner | Caps LLM spend per account. |
| PII retention | 180 days, then auto-redact | Data minimisation. |
| TTS job retention | 14 days | Enough to debug, not enough to accumulate. |

---

## 10. Non-functional requirements

### Performance

- Cold start to interactive map: **< 3 s** on a mid-range Android with a warm cache.
- Narration start latency: **< 200 ms** tier 1, **< 5 s** tier 1.5.
- Nearby query (server): p95 **< 150 ms**.
- Delta sync payload for a typical daily change set: **< 50 KB**.

**Battery** — a 4-hour walking session must cost **< 15%** battery on top of screen-off baseline. Non-negotiable: if the app eats the battery, the tourist uninstalls it, and the whole product dies. Enforce with throttling, distance filters, reduced accuracy when stationary, and no network chatter while idle.

**Offline** — every P0 tourist feature must work in airplane mode once a pack is installed. Offline is the default assumption, not a fallback.

### Privacy

- Tourists are anonymous by default; analytics require explicit opt-in and are stored against a rotating anonymous device ID, never a person.
- Movement traces are grid-snapped before storage and are never reconstructable into an individual's route.
- Runtime "how many devices are active" observability is a **separate lane** that never mixes with consented analytics data.
- PII encrypted at rest; auto-redacted after 180 days; never written to logs or traces.

### Security

- OWASP Top 10 as a checklist, not a vibe. httpOnly + `SameSite` cookies on web, secure storage on mobile.
- Permission-based authorization on every mutating route.
- Every file path derived from user input must resolve inside its base directory — the map pack and media endpoints serve files by name and are the obvious path-traversal target.
- Rate limits on every public write endpoint and every endpoint that costs money (TTS, translation, AI).
- Full audit trail on admin actions.

**Internationalization** — two independent lanes: **content locale** (place text and audio) and **UI locale** (interface strings). They warm at different speeds and must not block each other. A language switch is complete only when both are ready. Include RTL readiness in the layout even though no launch language needs it.

**Accessibility** — the product is fundamentally an audio product, which makes it unusually valuable to visually impaired travellers. Screen-reader labels on every control, minimum 44×44 pt touch targets, WCAG AA contrast, full transcript for every narration, and no information conveyed by colour alone.

**Availability** — target 99% for the tourist read path. Owner and admin write paths may degrade. The read path must survive a backend outage entirely, via cached data.

---

## 11. Service decomposition

Product capability → owning service. Full technical detail lives in [`architecture-and-tech-stack.md`](./architecture-and-tech-stack.md).

| Service | Owns | Consumed by |
| :---- | :---- | :---- |
| **gateway** | The only public HTTP surface. Auth verification, rate limiting, request shaping, OpenAPI spec. | all clients |
| **identity** | Accounts, devices, sessions, tokens, roles, permissions, PII encryption, owner verification state. | every service |
| **catalog** | Places, menus, tours, media metadata, submissions, moderation workflow, dataset versioning + delta sync, PostGIS nearby/geofence queries, map pack manifests. | gateway, narration, analytics |
| **narration** | TTS jobs, audio assets, voice catalogue, pronunciation dictionary, audio packs, content translation, UI string bundles, hotset & warmup. | gateway, catalog |
| **billing** | Stripe: subscriptions, Connect accounts, checkout sessions, webhook processing, entitlements, vouchers, payouts. | gateway, catalog |
| **analytics** *(P1)* | Consent-gated ingest, event store, rollups, read models, heatmap aggregation. | gateway, console |
| **ai** *(P1)* | Description enhancement, quota accounting, provider fallback. | gateway |

**Inter-service interactions that must exist:**

- `catalog` → `narration`: "this place's description changed, regenerate audio for 5 languages" — **asynchronous event**, fire-and-forget, retryable.
- `narration` → `catalog`: "audio for `(place, ja)` is ready" — **asynchronous event**, which is what eventually opens the activation gate.
- `catalog` → `billing`: "may this owner publish another place / enable auto-narration?" — **synchronous call**, must answer in single-digit milliseconds.
- `billing` → `catalog`: "this subscription lapsed, unpublish places above the free limit and disable auto-narration" — **asynchronous event**.
- `gateway` → `identity`: token and permission verification on protected routes — **synchronous**, and cached.

---

## 12. Scope and phasing

### Phase 1 — the core loop

Goal: **the core loop works end-to-end on real hardware, outdoors, in two languages.**

- `identity`, `catalog`, `narration`, `gateway` running in Docker Compose.
- Mobile app: language picker, map, nearby list, place detail, **background geofence narration**, QR scan.
- Web console: admin login, place CRUD, TTS job trigger + monitor.
- 15–20 seeded Places in the pilot area (§12.1), with real photos and real Vietnamese text.
- `vi` + `en` narration, tiers 1 and 3.
- CI green on every PR: lint, typecheck, unit tests, Docker build.

The Phase 1 demo is one video: someone walking a route with the screen off while the phone narrates. Everything else is negotiable; that is not.

### Phase 2 — the complete product

- `billing` service: owner subscriptions, Checkout, Customer Portal, webhooks, entitlements, auto-narration gating.
- Owner Portal: registration, verification, my places, submissions, notifications, billing.
- Full 5-language narration; audio tiers 1.5 and 2; pronunciation dictionary; hotset + warmup + dual-lane i18n.
- Offline packs: map pack + content + images + audio, with SHA-256 verification.
- Web tourist PWA.
- `analytics` service + admin dashboards.
- `ai` service: description enhancement.
- Staging deployment, mobile build distributed to testers.

### Phase 3 — revenue and polish

- Vouchers + Stripe Connect payouts.
- Discovery boost.
- Tours browser and progress.
- Load test, OpenTelemetry traces, architecture diagrams.

### 12.1 Pilot area

[ADR 0001](./decisions/0001-pilot-area-is-district-1-then-vinh-khanh.md) · [ADR 0002](./decisions/0002-seed-content-is-committed-scripts.md)

Two areas, staged, deliberately ordered so the Phase 1 demo cannot be blocked by owner recruitment.

**Phase 1 — the Đồng Khởi / Nguyễn Huệ / Bến Thành triangle, District 1, HCMC.** Roughly 1.5 km², flat, walkable, and genuinely full of foreign tourists: Bến Thành Market, Nguyễn Huệ walking street, Saigon Opera House, Notre-Dame Cathedral, Central Post Office, Independence Palace, Book Street, Bitexco. Critically, these are **Editorial Places** — staff-authored public landmarks with no owner, so seed content has zero external dependency.

**Phase 2 — Vĩnh Khánh street, District 4.** A ~500 m seafood and street-food strip with dozens of small venues, one bridge from District 1. This is where owner recruitment actually works, and it is the testbed for the whole Venue/subscription half of the product.

Seed content is generated by **seed scripts** committed to the repo, so any developer can bring up a realistic corpus from nothing. In production an admin authors the same content through the Admin Console.

### Explicitly out of scope

Hotel/flight booking · table reservations · food delivery · ride hailing · user-generated reviews & ratings · social feed · chat with owners · live human guides · AR overlays · wallet passes · multi-city expansion beyond the pilot area · multi-venue split carts · offline map *editing*.

---

## 13. Success metrics

| Dimension | Metric | Target |
| :---- | :---- | :---- |
| **Core loop** | Narrations auto-triggered per active session | ≥ 4 |
| | Listen-through rate (finished / started) | ≥ 60% |
| | False trigger rate (narration for a place the tourist never visited) | < 5% |
| | Missed trigger rate (walked through radius, nothing played) | < 10% |
| **Retention** | Day-2 retention of installs that completed onboarding | ≥ 30% |
| **Offline** | Sessions with an installed pack | ≥ 40% |
| **Supply** | Verified owners | ≥ 10 (real, not seeded) |
| | Owner-submitted places approved | ≥ 20 |
| **Revenue** | Paying owners | ≥ 3 |
| | Free → paid conversion | ≥ 10% |
| **Engineering** | p95 nearby query | < 150 ms |
| | CI pipeline duration | < 10 min |
| | Battery cost per 4 h walking session | < 15% |

---

## 14. Risks

| Risk | Impact | Mitigation |
| :---- | :---- | :---- |
| **OS geofence region limits.** iOS allows ~20 monitored regions, Android ~100. A city has hundreds of Places. | Core feature silently stops working past 20 places. | Do not use OS geofencing as the primary mechanism. Run our **own** engine over a background location stream, and use OS geofences only as a coarse wake-up net around the nearest N places, re-registered as the tourist moves. **Spike this first.** |
| **Background location on iOS.** Requires "Always" authorization, background modes, a persuasive App Store justification, and does not work in Expo Go at all. | Cannot demo the core feature; possible App Store rejection. | Move to an Expo **development build** immediately. Write the permission rationale copy early. Have a screen-on fallback path for the demo. |
| **Battery drain.** Continuous GPS is the fastest way to get uninstalled. | Product is unusable in the real world. | Throttling, distance filters, reduced accuracy when stationary, and a measured battery test. |
| **Unofficial TTS / translation endpoints.** The free Microsoft Edge TTS and Google Translate wrappers are undocumented internal endpoints, not products. They can break or rate-limit without notice. | Audio generation stops without warning. | Wrap both behind a provider interface with **two** implementations from day one; keep a paid fallback (Azure Speech / Google Cloud TTS) configured and tested. Pre-generate and store audio so a provider outage never affects tourists, only authoring. |
| **PMTiles offline vector tiles on React Native.** Well-trodden on the web, much less so in RN. | The offline map — a headline feature — may not work on mobile. | Spike in Phase 1. Fallbacks: a small in-app local HTTP server serving the pack, MapLibre Native's own offline region download, or raster tiles for the offline case. |
| **App-store rules on digital goods.** Apple and Google require their own IAP for digital content consumed in the app. Premium content (R4) is digital content. Real-world goods and services (vouchers, R3) are exempt and may use Stripe. | R4 gets the app rejected, or loses 30%. | Keep R4 out of the native app (web-only purchase), or drop R4. R1 (B2B subscription sold on the web console) and R3 (real-world vouchers) are both fine with Stripe. |
| **Stripe availability and tax in Vietnam.** Stripe's support for Vietnamese connected accounts and payouts directly constrains R3, and VAT treatment on R1 is unresolved. | R3 cannot ship; or we under-collect tax silently. | Verify before promising payouts to owners. Do not enable `automatic_tax` without confirming an active registration (§8.6). |
| **Scope.** This document describes more product than a small team ships quickly. | Everything half-done; nothing demonstrable. | Phase 1 is sacred and small. Nothing from Phase 2 starts until the walking demo works. |
