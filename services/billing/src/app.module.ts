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
import type { BillingConfig } from './config/env.schema';
import { AccountsModule } from './modules/accounts/accounts.module';
import { BillingEventsModule } from './modules/billing-events/billing-events.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { CONSUMERS, EventSpine, OutboxModule, SERVICE_NAME } from './modules/outbox/outbox.module';
import { OwnerVerifiedConsumer } from './modules/owner-verified/owner-verified.consumer';
import { OwnerVerifiedModule } from './modules/owner-verified/owner-verified.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PlansModule } from './modules/plans/plans.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PrismaService } from './modules/prisma/prisma.service';
import { RedisLifecycle, RedisModule } from './modules/redis/redis.module';
import { BillingEventsPruneJob } from './modules/scheduled/billing-events-prune.job';
import { BillingWebhooksRecoverJob } from './modules/scheduled/billing-webhooks-recover.job';
import { ScheduledModule } from './modules/scheduled/scheduled.module';
import { SellerModule } from './modules/seller/seller.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { SystemPlansModule } from './modules/system-plans/system-plans.module';
import { WebhookQueueModule } from './modules/webhook-queue/webhook-queue.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

const ROOT = packageRoot(__dirname);

/** billing's root module — a hybrid app: gRPC plus HTTP ops routes (api-endpoints-plan §13). */
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
        createConfigModule('billing', envSchema, { source: options.env }),
        createLoggerModuleAsync(),
        PrismaModule,
        OutboxModule,
        RedisModule,
        PaymentsModule,
        CatalogModule,
        SystemPlansModule,
        EntitlementsModule,
        WebhookQueueModule.forRoot({ worker: jobs }),
        WebhooksModule,
        SubscriptionsModule,
        PlansModule,
        AccountsModule,
        BillingEventsModule,
        SellerModule,
        OwnerVerifiedModule,
        SchedulerModule.forRootAsync({
          imports: [ScheduledModule],
          inject: [ConfigService, PrismaService, BillingWebhooksRecoverJob, BillingEventsPruneJob],
          useFactory: (
            config: BillingConfig,
            prisma: PrismaService,
            recover: BillingWebhooksRecoverJob,
            prune: BillingEventsPruneJob,
          ) => ({
            service: SERVICE_NAME,
            redisUrl: config.get('REDIS_URL', { infer: true }),
            db: prisma,
            jobs: [recover, prune],
            enabled: jobs,
          }),
        }),
        OpsModule.forRootAsync({
          grpcHealth: true,
          // Readiness: this service's own dependencies — database, NATS, Redis. Stripe is not one:
          // without it the Stripe-backed routes answer 503 and everything else works.
          inject: [ConfigService, PrismaService, NatsClient, RedisLifecycle, JobScheduler],
          useFactory: (
            config: BillingConfig,
            prisma: PrismaService,
            nats: NatsClient,
            redis: RedisLifecycle,
            scheduler: JobScheduler,
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
          inject: [OwnerVerifiedConsumer],
          useFactory: (ownerVerified: OwnerVerifiedConsumer) => [ownerVerified],
        },
      ],
    };
  }
}
