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
import { envSchema } from './config/env.schema';
import type { CatalogConfig } from './config/env.schema';
import { AreasModule } from './modules/areas/areas.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { PendingUploadsReapJob } from './modules/jobs/pending-uploads-reap.job';
import { PhotoObjectsCleanupJob } from './modules/jobs/photo-objects-cleanup.job';
import { LocalizationFailedConsumer } from './modules/localization-failed/localization-failed.consumer';
import { LocalizationFailedModule } from './modules/localization-failed/localization-failed.module';
import { LocalizationReadyConsumer } from './modules/localization-ready/localization-ready.consumer';
import { LocalizationReadyModule } from './modules/localization-ready/localization-ready.module';
import { LocalizationSourcesModule } from './modules/localization-sources/localization-sources.module';
import { EntitlementsChangedConsumer } from './modules/entitlements-changed/entitlements-changed.consumer';
import { EntitlementsChangedModule } from './modules/entitlements-changed/entitlements-changed.module';
import { FramesModule } from './modules/frames/frames.module';
import { OwnerPlacesModule } from './modules/owner-places/owner-places.module';
import { SubmissionReviewModule } from './modules/submission-review/submission-review.module';
import { SubmissionsModule } from './modules/submissions/submissions.module';
import { CONSUMERS, EventSpine, OutboxModule, SERVICE_NAME } from './modules/outbox/outbox.module';
import { PlaceQueriesModule } from './modules/place-queries/place-queries.module';
import { PlacesModule } from './modules/places/places.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PrismaService } from './modules/prisma/prisma.service';
import { SystemCatalogModule } from './modules/system-catalog/system-catalog.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UserErasedConsumer } from './modules/user-erased/user-erased.consumer';
import { UserErasedModule } from './modules/user-erased/user-erased.module';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { StorageProvider } from '@wayfare/nest-common/storage';

const ROOT = packageRoot(__dirname);

/** catalog's root module — a hybrid app: gRPC plus HTTP ops routes (api-endpoints-plan §13). */
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
    return {
      module: AppModule,
      imports: [
        createConfigModule('catalog', envSchema, { source: options.env }),
        createLoggerModuleAsync(),
        PrismaModule,
        OutboxModule,
        FramesModule,
        SystemCatalogModule,
        AreasModule,
        UploadsModule,
        PlacesModule,
        SubmissionsModule,
        SubmissionReviewModule,
        OwnerPlacesModule,
        PlaceQueriesModule,
        LocalizationReadyModule,
        LocalizationFailedModule,
        EntitlementsChangedModule,
        UserErasedModule,
        LocalizationSourcesModule,
        SchedulerModule.forRootAsync({
          imports: [JobsModule],
          inject: [ConfigService, PrismaService, PendingUploadsReapJob, PhotoObjectsCleanupJob],
          useFactory: (
            config: CatalogConfig,
            prisma: PrismaService,
            reap: PendingUploadsReapJob,
            cleanup: PhotoObjectsCleanupJob,
          ) => ({
            service: SERVICE_NAME,
            redisUrl: config.get('REDIS_URL', { infer: true }),
            db: prisma,
            jobs: [reap, cleanup],
            enabled: options.jobs ?? true,
          }),
        }),
        OpsModule.forRootAsync({
          grpcHealth: true,
          // Readiness: this service's own dependencies — database, NATS, Redis, storage.
          imports: [UploadsModule],
          inject: [ConfigService, PrismaService, NatsClient, JobScheduler, STORAGE_PROVIDER],
          useFactory: (
            config: CatalogConfig,
            prisma: PrismaService,
            nats: NatsClient,
            jobs: JobScheduler,
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
              jobs.readinessCheck(),
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
          inject: [
            LocalizationReadyConsumer,
            LocalizationFailedConsumer,
            EntitlementsChangedConsumer,
            UserErasedConsumer,
          ],
          useFactory: (
            ready: LocalizationReadyConsumer,
            failed: LocalizationFailedConsumer,
            entitlements: EntitlementsChangedConsumer,
            erased: UserErasedConsumer,
          ) => [ready, failed, entitlements, erased],
        },
      ],
    };
  }
}
