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
  NatsClient,
  OpsModule,
  packageRoot,
} from '@wayfare/nest-common';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { envSchema } from './config/env.schema';
import type { NarrationConfig } from './config/env.schema';
import { BillingModule } from './modules/billing/billing.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CorrectionsModule } from './modules/corrections/corrections.module';
import { DictionaryFanoutModule } from './modules/dictionary-fanout/dictionary-fanout.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { PronunciationsModule } from './modules/pronunciations/pronunciations.module';
import { MenuContentConsumer } from './modules/menu-content/menu-content.consumer';
import { MenuContentModule } from './modules/menu-content/menu-content.module';
import { NarrationModule } from './modules/narration/narration.module';
import { CONSUMERS, EventSpine, OutboxModule, SERVICE_NAME } from './modules/outbox/outbox.module';
import { PlaceContentConsumer } from './modules/place-content/place-content.consumer';
import { PlaceContentModule } from './modules/place-content/place-content.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PrismaService } from './modules/prisma/prisma.service';
import { ProgressModule } from './modules/progress/progress.module';
import { RedisLifecycle, RedisModule } from './modules/redis/redis.module';
import { AudioAssetsGcJob } from './modules/scheduled/audio-assets-gc.job';
import { ScheduledModule } from './modules/scheduled/scheduled.module';
import { SynthesisJobsPruneJob } from './modules/scheduled/synthesis-jobs-prune.job';
import { SynthesisRecoverJob } from './modules/scheduled/synthesis-recover.job';
import { LocalizationOverridesPruneJob } from './modules/scheduled/localization-overrides-prune.job';
import { TranslationCachePruneJob } from './modules/scheduled/translation-cache-prune.job';
import { StorageModule } from './modules/storage/storage.module';
import { TasksModule } from './modules/tasks/tasks.module';

const ROOT = packageRoot(__dirname);

/** narration's root module — a hybrid app: gRPC plus HTTP ops routes (api-endpoints-plan §13). */
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
        createConfigModule('narration', envSchema, { source: options.env }),
        createLoggerModuleAsync(),
        PrismaModule,
        OutboxModule,
        RedisModule,
        StorageModule,
        CatalogModule,
        BillingModule,
        ProgressModule,
        TasksModule.forRoot({ worker: jobs }),
        JobsModule,
        DictionaryFanoutModule.forRoot({ worker: jobs }),
        PronunciationsModule,
        CorrectionsModule,
        NarrationModule,
        PlaceContentModule,
        MenuContentModule,
        SchedulerModule.forRootAsync({
          imports: [ScheduledModule],
          inject: [
            ConfigService,
            PrismaService,
            SynthesisRecoverJob,
            SynthesisJobsPruneJob,
            AudioAssetsGcJob,
            TranslationCachePruneJob,
            LocalizationOverridesPruneJob,
          ],
          useFactory: (
            config: NarrationConfig,
            prisma: PrismaService,
            recover: SynthesisRecoverJob,
            prune: SynthesisJobsPruneJob,
            gc: AudioAssetsGcJob,
            cachePrune: TranslationCachePruneJob,
            overridesPrune: LocalizationOverridesPruneJob,
          ) => ({
            service: SERVICE_NAME,
            redisUrl: config.get('REDIS_URL', { infer: true }),
            db: prisma,
            jobs: [recover, prune, gc, cachePrune, overridesPrune],
            enabled: jobs,
          }),
        }),
        OpsModule.forRootAsync({
          grpcHealth: true,
          // Readiness: this service's own dependencies — database, NATS, Redis, storage.
          inject: [
            ConfigService,
            PrismaService,
            NatsClient,
            RedisLifecycle,
            JobScheduler,
            STORAGE_PROVIDER,
          ],
          useFactory: (
            config: NarrationConfig,
            prisma: PrismaService,
            nats: NatsClient,
            redis: RedisLifecycle,
            scheduler: JobScheduler,
            storage: StorageProvider,
          ) => ({
            version: {
              service: SERVICE_NAME,
              version: config.get('APP_VERSION', { infer: true }),
              gitSha: config.get('GIT_SHA', { infer: true }),
              builtAt: config.get('BUILT_AT', { infer: true }),
            },
            checks: [
              prisma.readinessCheck(),
              nats.readinessCheck(),
              redis.readinessCheck(),
              scheduler.readinessCheck(),
              storage.readinessCheck(),
            ],
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
        EventSpine,
        {
          provide: CONSUMERS,
          inject: [PlaceContentConsumer, MenuContentConsumer],
          useFactory: (place: PlaceContentConsumer, menu: MenuContentConsumer) => [place, menu],
        },
      ],
    };
  }
}
