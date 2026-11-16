import { Injectable } from '@nestjs/common';
import { businessDayStart, nextBusinessDay } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import { PrismaService } from '../prisma/prisma.service';
import { rebuildable, rebuildWindow } from './domain/rollup-window';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rebuilds whole business days from A-2 into A-4 and A-6 (rdm-spec A-4, A-6) — yesterday and
 * the 7 days before it, since a phone uploads up to a week late. Each day is replaced in one
 * transaction, so a re-run changes nothing and a withdrawn id leaves every day still covered.
 */
@Injectable()
export class DailyRollupJob implements ScheduledJob {
  readonly name = 'daily-rollup';
  readonly everyMs = DAY_MS;
  readonly cron = '0 3 * * *';

  constructor(private readonly prisma: PrismaService) {}

  async run(now: Date = new Date()): Promise<{ days: string[] }> {
    const days = rebuildWindow(now);
    for (const day of days) await this.rebuildDay(day, now);
    return { days };
  }

  /** Replaces one day's rollups with what A-2 holds for it; refuses a day past retention. */
  async rebuildDay(day: string, now: Date = new Date()): Promise<void> {
    if (!rebuildable(day, now))
      throw new Error(
        `${day} can't be rebuilt: raw events are kept 90 days, and today's aren't complete — nothing changed`,
      );
    const start = businessDayStart(day);
    const end = businessDayStart(nextBusinessDay(day));
    const date = new Date(`${day}T00:00:00Z`);
    await this.prisma.$transaction(async (tx) => {
      await tx.placeDailyStats.deleteMany({ where: { day: date } });
      await tx.activityDailyStats.deleteMany({ where: { day: date } });
      await tx.$executeRaw`
        INSERT INTO place_daily_stats (place_id, day, narrations_started, narrations_completed,
          narrations_abandoned, geofence_started, tap_started, qr_started, listen_ms_sum,
          listen_count, opens, computed_at)
        SELECT place_id, ${date}::date,
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED'),
          count(*) FILTER (WHERE event_type = 'NARRATION_COMPLETED'),
          count(*) FILTER (WHERE event_type = 'NARRATION_ABANDONED'),
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED' AND trigger = 'GEOFENCE'),
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED' AND trigger = 'TAP'),
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED' AND trigger = 'QR'),
          COALESCE(sum(listen_ms) FILTER (WHERE event_type IN ('NARRATION_COMPLETED', 'NARRATION_ABANDONED')), 0),
          count(listen_ms) FILTER (WHERE event_type IN ('NARRATION_COMPLETED', 'NARRATION_ABANDONED')),
          count(*) FILTER (WHERE event_type = 'PLACE_OPENED'),
          ${now}
        FROM events
        WHERE place_id IS NOT NULL AND occurred_at >= ${start} AND occurred_at < ${end}
        GROUP BY place_id`;
      // The totals row per platform: lang '*'. Nothing on it is summed over languages.
      await tx.$executeRaw`
        INSERT INTO activity_daily_stats (day, lang, platform, sessions, active_devices_estimate,
          narrations_started, narrations_completed, tier1_narrations, tier1_5_narrations,
          tier2_narrations, tier3_narrations, pack_installs, searches, computed_at)
        SELECT ${date}::date, '*', platform,
          count(*) FILTER (WHERE event_type = 'APP_OPENED'),
          count(DISTINCT analytics_device_id),
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED'),
          count(*) FILTER (WHERE event_type = 'NARRATION_COMPLETED'),
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED' AND audio_tier = 'T1'),
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED' AND audio_tier = 'T1_5'),
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED' AND audio_tier = 'T2'),
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED' AND audio_tier = 'T3'),
          count(*) FILTER (WHERE event_type = 'PACK_INSTALLED'),
          count(*) FILTER (WHERE event_type = 'SEARCH_PERFORMED'),
          ${now}
        FROM events
        WHERE occurred_at >= ${start} AND occurred_at < ${end}
        GROUP BY platform`;
      // Narrations per language: the language each one played in.
      await tx.$executeRaw`
        INSERT INTO activity_daily_stats (day, lang, platform, narrations_started,
          narrations_completed, tier1_narrations, tier1_5_narrations, tier2_narrations,
          tier3_narrations, computed_at)
        SELECT ${date}::date, lang, platform,
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED'),
          count(*) FILTER (WHERE event_type = 'NARRATION_COMPLETED'),
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED' AND audio_tier = 'T1'),
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED' AND audio_tier = 'T1_5'),
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED' AND audio_tier = 'T2'),
          count(*) FILTER (WHERE event_type = 'NARRATION_STARTED' AND audio_tier = 'T3'),
          ${now}
        FROM events
        WHERE lang IS NOT NULL AND lang <> '*'
          AND event_type IN ('NARRATION_STARTED', 'NARRATION_COMPLETED')
          AND occurred_at >= ${start} AND occurred_at < ${end}
        GROUP BY lang, platform`;
      await tx.rollupDay.upsert({
        where: { day: date },
        create: { day: date, computedAt: now },
        update: { computedAt: now },
      });
    });
  }
}
