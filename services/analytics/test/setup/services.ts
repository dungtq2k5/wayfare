// analytics' use cases wired by hand over the test database and the test Redis — the same graph
// Nest builds, without the scheduler.
import { buildConfigService } from '@wayfare/nest-common/testing';
import { Redis } from 'ioredis';
import { envSchema } from '../../src/config/env.schema';
import type { AnalyticsConfig } from '../../src/config/env.schema';
import { EventsService } from '../../src/modules/events/events.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { ReadsService } from '../../src/modules/reads/reads.service';
import { DailyRollupJob } from '../../src/modules/scheduled/daily-rollup.job';
import { HeatmapFlushJob } from '../../src/modules/scheduled/heatmap-flush.job';
import { RawPruneJob } from '../../src/modules/scheduled/raw-prune.job';
import { RuntimeFlushJob } from '../../src/modules/scheduled/runtime-flush.job';

/** analytics' environment for tests: the values prepared by setup/env.ts. */
export function testEnv(
  overrides: Record<string, string> = {},
): Record<string, string | undefined> {
  return {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    GRPC_URL: '127.0.0.1:50155',
    OPS_PORT: '3195',
    METRICS_PORT: '9195',
    ...overrides,
  };
}

/** analytics' configuration for services built by hand in tests. */
export function testConfig(): AnalyticsConfig {
  return buildConfigService('analytics', envSchema, testEnv());
}

/** The services, the jobs, and their database and Redis. */
export function analyticsServices() {
  const prisma = new PrismaService(testConfig());
  const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
  return {
    prisma,
    redis,
    events: new EventsService(prisma, redis),
    reads: new ReadsService(prisma, redis),
    heatmapFlush: new HeatmapFlushJob(prisma, redis),
    runtimeFlush: new RuntimeFlushJob(prisma, redis),
    dailyRollup: new DailyRollupJob(prisma),
    rawPrune: new RawPruneJob(prisma),
    /** Empties every table and the test Redis between specs (conventions §17.2). */
    async reset(): Promise<void> {
      await prisma.$executeRawUnsafe(
        'TRUNCATE consents, events, location_cell_hourly, place_daily_stats, runtime_activity_hourly, activity_daily_stats, rollup_days, job_runs',
      );
      await redis.flushdb();
    },
    async close(): Promise<void> {
      await prisma.$disconnect();
      redis.disconnect();
    },
  };
}

/** The services' type. */
export type AnalyticsServices = ReturnType<typeof analyticsServices>;
