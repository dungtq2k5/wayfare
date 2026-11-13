// pnpm seed:dev — four weeks of consented events for the pilot's Places, so the dashboards
// have numbers on a fresh stack: consents, raw events with cells, the runtime lane's last two days,
// then the jobs for those days. Never in production; idempotent (fixed ids, fixed numbers).
// `ANALYTICS_SEED_END_DAY` (a business day) fixes the last day, for the screen baselines; else it
// is yesterday. The runtime lane always follows the real clock: its live keys are "now".
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import {
  AnalyticsEventType,
  AnalyticsTrigger,
  AudioTier,
  businessDay,
  businessDayStart,
  ConsentState,
  geohashOf,
  HEATMAP_KEY_TTL_SECONDS,
  heatmapKey,
  hourStart,
  LEGAL_DOCUMENT_VERSIONS,
  LegalDocument,
  Platform,
  RUNTIME_KEY_TTL_SECONDS,
  runtimeKey,
} from '@wayfare/contracts';
import type { Redis } from 'ioredis';
import type { Prisma } from '../../generated/prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { REDIS } from '../../src/modules/redis/redis.module';
import { DailyRollupJob } from '../../src/modules/scheduled/daily-rollup.job';
import { daysBefore, morningAfter } from '../../src/modules/scheduled/domain/rollup-window';
import { HeatmapFlushJob } from '../../src/modules/scheduled/heatmap-flush.job';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const CATALOG_SEED = resolve(REPO_ROOT, 'services/catalog/prisma/seed');
const HOUR_MS = 60 * 60 * 1000;

/** How many days of events, ending on the end day. */
const DAYS = 28;
/** How many consenting phones. */
const DEVICES = 150;

/**
 * Owner-2's little-data Venue: no narration but three in the last five days, so *My stats* shows
 * too little to count. Catalog's seed makes it live five days before the end day (`pinLiveDates`).
 */
const LITTLE_DATA_VENUE_ID = '01a0b998-8eca-750d-9430-a9806a5c061e';

interface SeedPlace {
  readonly id: string;
  readonly location: { lat: number; lng: number };
}

/** The pilot's Places and Venues, and their Areas, as catalog's seed commits them. */
function pilot(): { places: SeedPlace[]; venues: SeedPlace[]; areaIds: string[] } {
  const read = (file: string): unknown =>
    JSON.parse(readFileSync(resolve(CATALOG_SEED, file), 'utf8'));
  const d1 = read('pilot-d1/places.json') as SeedPlace[];
  const d4 = (read('pilot-d4/venues.json') as { venues: SeedPlace[] }).venues;
  const areaIds = ['pilot-d1/area.json', 'pilot-d4/area.json'].map(
    (file) => (read(file) as { id: string }).id,
  );
  return { places: [...d1, ...d4], venues: d4, areaIds };
}

/** A fixed UUID from a name: the same event every run, so the seed is idempotent. */
function seedId(name: string): string {
  const hex = createHash('sha256').update(`wayfare-analytics-seed:${name}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A small seeded generator (mulberry32): fixed numbers on every machine. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(next: () => number, items: readonly T[]): T =>
  items[Math.floor(next() * items.length)]!;

const LANGS = ['en', 'en', 'en', 'vi', 'vi', 'ko', 'ja', 'zh-Hans'];
const TRIGGERS = [
  AnalyticsTrigger.GEOFENCE,
  AnalyticsTrigger.GEOFENCE,
  AnalyticsTrigger.GEOFENCE,
  AnalyticsTrigger.TAP,
  AnalyticsTrigger.TAP,
  AnalyticsTrigger.QR,
];
const TIERS = [
  AudioTier.T1,
  AudioTier.T1,
  AudioTier.T1,
  AudioTier.T1,
  AudioTier.T1_5,
  AudioTier.T2,
  AudioTier.T3,
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Not in production');
  const pilotPlaces = pilot();
  const { areaIds } = pilotPlaces;
  const quiet = (place: SeedPlace) => place.id !== LITTLE_DATA_VENUE_ID;
  const places = pilotPlaces.places.filter(quiet);
  const venues = pilotPlaces.venues.filter(quiet);
  const littleData = pilotPlaces.venues.find((venue) => !quiet(venue));
  const app = await NestFactory.createApplicationContext(AppModule.forRoot({ jobs: false }), {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const redis = app.get<Redis>(REDIS);
    const now = new Date();
    const next = random(40);
    const endDay = process.env.ANALYTICS_SEED_END_DAY ?? daysBefore(businessDay(now), 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDay)) throw new Error('ANALYTICS_SEED_END_DAY: YYYY-MM-DD');
    const days = Array.from({ length: DAYS }, (_, index) => daysBefore(endDay, DAYS - 1 - index));
    const devices = Array.from({ length: DEVICES }, (_, index) => seedId(`device:${index}`));
    const policy = LEGAL_DOCUMENT_VERSIONS[LegalDocument.PRIVACY_POLICY];

    await prisma.consent.createMany({
      data: devices.map((analyticsDeviceId, index) => ({
        id: seedId(`consent:${index}`),
        analyticsDeviceId,
        state: ConsentState.GRANTED,
        policyVersion: policy,
        recordedAt: businessDayStart(days[0]!),
      })),
      skipDuplicates: true,
    });

    const events: Prisma.EventCreateManyInput[] = [];
    const cells = new Map<string, Set<string>>();
    days.forEach((day, dayIndex) => {
      // The first weeks are quieter: the pilot grows.
      const active = devices.slice(0, Math.round(DEVICES * (0.4 + (0.6 * dayIndex) / DAYS)));
      for (const device of active) {
        if (next() < 0.35) continue;
        const session = seedId(`session:${day}:${device}`);
        const platform = next() < 0.8 ? Platform.ANDROID : Platform.WEB;
        const appVersion = platform === Platform.WEB ? '0.0.0' : '0.1.0';
        // Most evenings on Vĩnh Khánh's food street at 19:00, the rest any time 08:00–22:00 in
        // Vietnam: a crowd dense enough that some squares pass the heatmap's floor of 5.
        const evening = next() < 0.6;
        const stopsAt = evening ? venues : places;
        const hour = evening ? 19 + next() * 0.5 : 8 + next() * 14;
        const at = (offsetMinutes: number) =>
          new Date(businessDayStart(day).getTime() + hour * HOUR_MS + offsetMinutes * 60_000);
        const base = { analyticsDeviceId: device, sessionId: session, platform, appVersion };
        let serial = 0;
        const id = () => seedId(`event:${day}:${device}:${serial++}`);
        const opened = at(0);
        events.push({
          ...base,
          id: id(),
          eventType: AnalyticsEventType.APP_OPENED,
          occurredAt: opened,
        });
        if (next() < 0.1)
          events.push({
            ...base,
            id: id(),
            eventType: AnalyticsEventType.PACK_INSTALLED,
            props: { areaId: pick(next, areaIds) },
            occurredAt: opened,
          });
        const lang = pick(next, LANGS);
        const stops = 1 + Math.floor(next() * 4);
        for (let stop = 0; stop < stops; stop++) {
          const place = pick(next, stopsAt);
          const started = new Date(opened.getTime() + stop * 6 * 60_000);
          const cell = geohashOf(place.location.lat, place.location.lng);
          const hourKey = heatmapKey(cell, started);
          if (!cells.has(hourKey)) cells.set(hourKey, new Set());
          cells.get(hourKey)!.add(device);
          const narration = {
            ...base,
            placeId: place.id,
            lang,
            occurredAt: started,
          };
          if (next() < 0.3)
            events.push({ ...narration, id: id(), eventType: AnalyticsEventType.PLACE_OPENED });
          events.push({
            ...narration,
            id: id(),
            eventType: AnalyticsEventType.NARRATION_STARTED,
            trigger: pick(next, TRIGGERS),
            audioTier: pick(next, TIERS),
          });
          const finished = next() < 0.72;
          events.push({
            ...narration,
            id: id(),
            eventType: finished
              ? AnalyticsEventType.NARRATION_COMPLETED
              : AnalyticsEventType.NARRATION_ABANDONED,
            listenMs: finished ? 90_000 + Math.floor(next() * 60_000) : Math.floor(next() * 60_000),
            occurredAt: new Date(started.getTime() + 2 * 60_000),
          });
        }
      }
    });
    // The little-data Venue's three narrations, one a day in its last three: two finished, one stopped.
    if (littleData !== undefined)
      days.slice(-3).forEach((day, index) => {
        const device = devices[index]!;
        const base = {
          analyticsDeviceId: device,
          sessionId: seedId(`session:${day}:${device}`),
          platform: Platform.ANDROID,
          appVersion: '0.1.0',
          placeId: littleData.id,
          lang: 'en',
        };
        const started = new Date(businessDayStart(day).getTime() + 20 * HOUR_MS);
        events.push(
          {
            ...base,
            id: seedId(`little:${day}:started`),
            eventType: AnalyticsEventType.NARRATION_STARTED,
            trigger: AnalyticsTrigger.TAP,
            audioTier: AudioTier.T1,
            occurredAt: started,
          },
          {
            ...base,
            id: seedId(`little:${day}:ended`),
            eventType:
              index < 2
                ? AnalyticsEventType.NARRATION_COMPLETED
                : AnalyticsEventType.NARRATION_ABANDONED,
            listenMs: index < 2 ? 100_000 : 20_000,
            occurredAt: new Date(started.getTime() + 2 * 60_000),
          },
        );
      });
    for (let start = 0; start < events.length; start += 2_000) {
      await prisma.event.createMany({
        data: events.slice(start, start + 2_000),
        skipDuplicates: true,
      });
    }

    // The heatmap's counters, as ingest adds them; the flush writes the squares that pass 5.
    const pipeline = redis.multi();
    for (const [key, ids] of cells) {
      pipeline.pfadd(key, ...ids);
      pipeline.expire(key, HEATMAP_KEY_TTL_SECONDS);
    }
    await pipeline.exec();
    await app.get(HeatmapFlushJob).run(now);

    // The runtime lane's last 48 finished hours, and this hour so far.
    const thisHour = hourStart(now).getTime();
    const runtime = areaIds.flatMap((areaId, areaIndex) =>
      Array.from({ length: 48 }, (_, index) => {
        const bucketStart = new Date(thisHour - (48 - index) * HOUR_MS);
        const hourOfDay = (bucketStart.getUTCHours() + 7) % 24;
        const busy = hourOfDay >= 8 && hourOfDay < 23 ? 1 : 0.15;
        return {
          areaId,
          bucketStart,
          activeEstimate: Math.round((areaIndex === 0 ? 40 : 25) * busy * (0.7 + next() * 0.6)),
          computedAt: now,
        };
      }),
    );
    await prisma.runtimeActivityHourly.createMany({ data: runtime, skipDuplicates: true });
    const live = redis.multi();
    areaIds.forEach((areaId, areaIndex) => {
      const key = runtimeKey(areaId, now);
      live.pfadd(key, ...Array.from({ length: areaIndex === 0 ? 18 : 9 }, (_, i) => `seed-${i}`));
      live.expire(key, RUNTIME_KEY_TTL_SECONDS);
    });
    await live.exec();

    const rollup = app.get(DailyRollupJob);
    // The rebuild's clock is the seed's own — the morning after its end day — so a fixed end day
    // stays inside the rebuild's 90-day window however long after it the stack is made.
    for (const day of days) await rollup.rebuildDay(day, morningAfter(endDay));
    console.log(
      `✓ analytics: ${devices.length} phones, ${events.length} events over ${days.length} days (${days[0]} … ${endDay})`,
    );
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
