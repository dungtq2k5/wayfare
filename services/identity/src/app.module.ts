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
import type { IdentityConfig } from './config/env.schema';
import { AccessModule } from './modules/access/access.module';
import { AccountLinksModule } from './modules/account-links/account-links.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { AuditConsumer } from './modules/audit/audit.consumer';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { DevicesModule } from './modules/devices/devices.module';
import { EmailChangeModule } from './modules/email-change/email-change.module';
import { EmailWebhooksModule } from './modules/email-webhooks/email-webhooks.module';
import { EmailModule } from './modules/email/email.module';
import { EntitlementsChangedConsumer } from './modules/entitlements-changed/entitlements-changed.consumer';
import { EntitlementsChangedModule } from './modules/entitlements-changed/entitlements-changed.module';
import { NotificationCreateConsumer } from './modules/notification-create/notification-create.consumer';
import { NotificationCreateModule } from './modules/notification-create/notification-create.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlaceStatusConsumer } from './modules/place-status/place-status.consumer';
import { PlaceStatusModule } from './modules/place-status/place-status.module';
import { NotificationsPruneJob } from './modules/scheduled/notifications-prune.job';
import { OwnerPiiRedactJob } from './modules/scheduled/owner-pii-redact.job';
import { ScheduledModule } from './modules/scheduled/scheduled.module';
import { LegalModule } from './modules/legal/legal.module';
import { OwnerRegistrationsModule } from './modules/owner-registrations/owner-registrations.module';
import { OwnerReviewModule } from './modules/owner-review/owner-review.module';
import { CONSUMERS, EventSpine, OutboxModule } from './modules/outbox/outbox.module';
import { PasswordModule } from './modules/password/password.module';
import { PaymentFailedConsumer } from './modules/payment-failed/payment-failed.consumer';
import { PaymentFailedModule } from './modules/payment-failed/payment-failed.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PrismaService } from './modules/prisma/prisma.service';
import { RedisLifecycle, RedisModule } from './modules/redis/redis.module';
import { RevocationConsumer } from './modules/revocation/revocation.consumer';
import { RevocationModule } from './modules/revocation/revocation.module';
import { RolesModule } from './modules/roles/roles.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { SystemCatalogModule } from './modules/system-catalog/system-catalog.module';
import { TokensModule } from './modules/tokens/tokens.module';
import { UsersModule } from './modules/users/users.module';

const ROOT = packageRoot(__dirname);

/** identity's root module — a hybrid app: gRPC plus HTTP ops routes (api-endpoints-plan §13). */
@Module({})
export class AppModule {
  /** `env` is for tests only: validate exactly that object, ignoring `.env` and `process.env`. */
  static forRoot(
    options: {
      env?: Readonly<Record<string, string | undefined>>;
      /** `false` in tests: nothing is scheduled and no worker starts. */
      jobs?: boolean;
      /** Tests only: point the boot-time schema check at other expectations. */
      schema?: { migrationsDir?: string; expectedObjectsPath?: string };
    } = {},
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        createConfigModule('identity', envSchema, { source: options.env }),
        createLoggerModuleAsync(),
        PrismaModule,
        RedisModule,
        OutboxModule,
        AuditModule,
        EmailModule,
        AccountLinksModule,
        EmailChangeModule,
        PasswordModule,
        EmailWebhooksModule,
        SystemCatalogModule,
        TokensModule,
        AccessModule,
        LegalModule,
        SessionsModule,
        DevicesModule,
        AuthModule,
        UsersModule,
        AdminUsersModule,
        RolesModule,
        RevocationModule,
        NotificationsModule,
        NotificationCreateModule,
        PlaceStatusModule,
        PaymentFailedModule,
        EntitlementsChangedModule,
        OwnerRegistrationsModule,
        OwnerReviewModule,
        SchedulerModule.forRootAsync({
          imports: [ScheduledModule],
          inject: [ConfigService, PrismaService, NotificationsPruneJob, OwnerPiiRedactJob],
          useFactory: (
            config: IdentityConfig,
            prisma: PrismaService,
            prune: NotificationsPruneJob,
            redact: OwnerPiiRedactJob,
          ) => ({
            service: 'identity',
            redisUrl: config.get('REDIS_URL', { infer: true }),
            db: prisma,
            jobs: [prune, redact],
            enabled: options.jobs ?? true,
          }),
        }),
        OpsModule.forRootAsync({
          grpcHealth: true,
          // Readiness: this service's own dependencies — database, NATS, Redis (api-endpoints-plan §13).
          inject: [ConfigService, PrismaService, NatsClient, RedisLifecycle, JobScheduler],
          useFactory: (
            config: IdentityConfig,
            prisma: PrismaService,
            nats: NatsClient,
            redis: RedisLifecycle,
            scheduler: JobScheduler,
          ) => ({
            version: {
              service: 'identity',
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
          service: 'identity',
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
            AuditConsumer,
            RevocationConsumer,
            NotificationCreateConsumer,
            PlaceStatusConsumer,
            PaymentFailedConsumer,
            EntitlementsChangedConsumer,
          ],
          useFactory: (
            audit: AuditConsumer,
            revocation: RevocationConsumer,
            notifications: NotificationCreateConsumer,
            placeStatus: PlaceStatusConsumer,
            paymentFailed: PaymentFailedConsumer,
            entitlementsChanged: EntitlementsChangedConsumer,
          ) => [audit, revocation, notifications, placeStatus, paymentFailed, entitlementsChanged],
        },
      ],
    };
  }
}
