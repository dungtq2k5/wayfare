import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createConfigModule,
  createLoggerModuleAsync,
  createSchemaCheck,
  JobScheduler,
  JobsModule as SchedulerModule,
  OpsModule,
  packageRoot,
} from '@wayfare/nest-common';
import { envSchema } from './config/env.schema';
import type { AnalyticsConfig } from './config/env.schema';
import { EventsModule } from './modules/events/events.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PrismaService } from './modules/prisma/prisma.service';
import { ReadsModule } from './modules/reads/reads.module';
import { RedisLifecycle, RedisModule } from './modules/redis/redis.module';
import { DailyRollupJob } from './modules/scheduled/daily-rollup.job';
import { HeatmapFlushJob } from './modules/scheduled/heatmap-flush.job';
import { RawPruneJob } from './modules/scheduled/raw-prune.job';
import { RuntimeFlushJob } from './modules/scheduled/runtime-flush.job';
import { ScheduledModule } from './modules/scheduled/scheduled.module';

const ROOT = packageRoot(__dirname);

/** The service's name: its queue, its logs, its `/version`. */
export const SERVICE_NAME = 'analytics';

/**
 * analytics' root module — a hybrid app: gRPC plus HTTP ops routes (api-endpoints-plan §13). It
 * publishes no event and consumes none: the gateway is its only caller.
 */
@Module({})
export class AppModule {
  /**
   * `env` is for tests only: validate exactly that object, ignoring `.env` and `process.env`.
   * `jobs: false` schedules nothing and starts no worker; `schema` points the boot check elsewhere.
   */
  static forRoot(
    options: {
      env?: Readonly<Record<string, string | undefined>>;
      jobs?: boolean;
      schema?: { migrationsDir?: string; expectedObjectsPath?: string };
    } = {},
  ): DynamicModule {
    const jobs = options.jobs ?? true;
    return {
      module: AppModule,
      imports: [
        createConfigModule('analytics', envSchema, { source: options.env }),
        createLoggerModuleAsync(),
        PrismaModule,
        RedisModule,
        EventsModule,
        ReadsModule,
        SchedulerModule.forRootAsync({
          imports: [ScheduledModule],
          inject: [
            ConfigService,
            PrismaService,
            HeatmapFlushJob,
            RuntimeFlushJob,
            DailyRollupJob,
            RawPruneJob,
          ],
          useFactory: (
            config: AnalyticsConfig,
            prisma: PrismaService,
            heatmap: HeatmapFlushJob,
            runtime: RuntimeFlushJob,
            rollup: DailyRollupJob,
            prune: RawPruneJob,
          ) => ({
            service: SERVICE_NAME,
            redisUrl: config.get('REDIS_URL', { infer: true }),
            db: prisma,
            jobs: [heatmap, runtime, rollup, prune],
            enabled: jobs && config.get('JOBS_ENABLED', { infer: true }),
          }),
        }),
        OpsModule.forRootAsync({
          grpcHealth: true,
          // Readiness: this service's own dependencies — its database and Redis.
          inject: [ConfigService, PrismaService, RedisLifecycle, JobScheduler],
          useFactory: (
            config: AnalyticsConfig,
            prisma: PrismaService,
            redis: RedisLifecycle,
            scheduler: JobScheduler,
          ) => ({
            version: {
              service: SERVICE_NAME,
              version: config.get('APP_VERSION', { infer: true }),
              gitSha: config.get('GIT_SHA', { infer: true }),
              builtAt: config.get('BUILT_AT', { infer: true }),
            },
            checks: [prisma.readinessCheck(), redis.readinessCheck(), scheduler.readinessCheck()],
          }),
        }),
      ],
      providers: [
        // Refuses to boot on an undeployed database, before any bootstrap hook (conventions §8.1).
        ...createSchemaCheck({
          service: SERVICE_NAME,
          prismaToken: PrismaService,
          migrationsDir: options.schema?.migrationsDir ?? resolve(ROOT, 'prisma/migrations'),
          expectedObjectsPath:
            options.schema?.expectedObjectsPath ??
            resolve(ROOT, 'prisma/sql/expected-objects.json'),
        }),
      ],
    };
  }
}
