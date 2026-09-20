import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, DiscoveryModule, Reflector } from '@nestjs/core';
import {
  AppVersionGuard,
  AuthGuard,
  ClientHeaderGuard,
  createConfigModule,
  createLoggerModuleAsync,
  OpsModule,
  RateLimiter,
  RateLimitGuard,
  RouteContractCheck,
} from '@wayfare/nest-common';
import type { Redis } from 'ioredis';
import { envSchema } from './config/env.schema';
import type { GatewayConfig } from './config/env.schema';
import { AdminBillingModule } from './modules/admin-billing/admin-billing.module';
import { AdminNarrationModule } from './modules/admin-narration/admin-narration.module';
import { AdminPlansModule } from './modules/admin-plans/admin-plans.module';
import { BillingModule } from './modules/billing/billing.module';
import { OwnerBillingModule } from './modules/owner-billing/owner-billing.module';
import { StripeWebhooksModule } from './modules/stripe-webhooks/stripe-webhooks.module';
import { AdminPlacesModule } from './modules/admin-places/admin-places.module';
import { AdminAreasModule } from './modules/admin-areas/admin-areas.module';
import { AdminLocalizationsModule } from './modules/admin-localizations/admin-localizations.module';
import { I18nModule } from './modules/i18n/i18n.module';
import { AdminMapPacksModule } from './modules/admin-map-packs/admin-map-packs.module';
import { AdminPronunciationsModule } from './modules/admin-pronunciations/admin-pronunciations.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { OfflineModule } from './modules/offline/offline.module';
import { AdminCategoriesModule } from './modules/admin-categories/admin-categories.module';
import { AdminSubmissionsModule } from './modules/admin-submissions/admin-submissions.module';
import { OwnerPlacesModule } from './modules/owner-places/owner-places.module';
import { OwnerSubmissionsModule } from './modules/owner-submissions/owner-submissions.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { AreasModule } from './modules/areas/areas.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { DevicesModule } from './modules/devices/devices.module';
import { EmailChangeModule } from './modules/email-change/email-change.module';
import { EmailWebhooksModule } from './modules/email-webhooks/email-webhooks.module';
import { EventsModule } from './modules/events/events.module';
import { IdentityModule } from './modules/identity/identity.module';
import { NarrationClientModule } from './modules/narration-client/narration-client.module';
import { NarrationModule } from './modules/narration/narration.module';
import { REDIS, RedisLifecycle, RedisModule } from './modules/ops/redis.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OwnerRegistrationModule } from './modules/owner-registration/owner-registration.module';
import { AdminOwnerRegistrationsModule } from './modules/admin-owner-registrations/admin-owner-registrations.module';
import { PasswordModule } from './modules/password/password.module';
import { PlacesModule } from './modules/places/places.module';
import { QrModule } from './modules/qr/qr.module';
import { RolesModule } from './modules/roles/roles.module';
import { SyncModule } from './modules/sync/sync.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';

/** The gateway — the only public HTTP surface. No database, no business logic (conventions §2.2). */
@Module({})
export class AppModule {
  /** `env` is for tests only: validate exactly that object, ignoring `.env` and `process.env`. */
  static forRoot(
    options: { env?: Readonly<Record<string, string | undefined>> } = {},
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        createConfigModule('gateway', envSchema, { source: options.env }),
        createLoggerModuleAsync(),
        DiscoveryModule,
        RedisModule,
        // Ops routes ride the public port here; readiness checks Redis only (api-endpoints-plan §13).
        OpsModule.forRootAsync({
          inject: [ConfigService, RedisLifecycle],
          useFactory: (config: GatewayConfig, redis: RedisLifecycle) => ({
            version: {
              service: 'gateway',
              version: config.get('APP_VERSION', { infer: true }),
              gitSha: config.get('GIT_SHA', { infer: true }),
              builtAt: config.get('BUILT_AT', { infer: true }),
            },
            checks: [redis.readinessCheck()],
          }),
        }),
        IdentityModule,
        DevicesModule,
        AuthModule,
        UsersModule,
        AdminUsersModule,
        RolesModule,
        AuditLogsModule,
        PasswordModule,
        EmailChangeModule,
        EmailWebhooksModule,
        NotificationsModule,
        OwnerRegistrationModule,
        AdminOwnerRegistrationsModule,
        CatalogModule,
        NarrationClientModule,
        NarrationModule,
        AdminNarrationModule,
        EventsModule,
        SyncModule,
        PlacesModule,
        QrModule,
        CategoriesModule,
        AreasModule,
        UploadsModule,
        AdminPlacesModule,
        AdminSubmissionsModule,
        AdminCategoriesModule,
        AdminAreasModule,
        I18nModule,
        AdminMapPacksModule,
        AdminPronunciationsModule,
        AdminLocalizationsModule,
        OfflineModule,
        FavoritesModule,
        OwnerPlacesModule,
        OwnerSubmissionsModule,
        BillingModule,
        OwnerBillingModule,
        AdminPlansModule,
        AdminBillingModule,
        StripeWebhooksModule,
      ],
      providers: [
        {
          provide: RateLimiter,
          inject: [REDIS],
          useFactory: (redis: Redis) => new RateLimiter(redis),
        },
        // Deny-by-default: an HTTP route without an auth rule stops the boot (conventions §5.3).
        RouteContractCheck,
        // The guard chain, in order (conventions §5.3). The caller was resolved by the middleware.
        { provide: APP_GUARD, useClass: ClientHeaderGuard },
        {
          provide: APP_GUARD,
          inject: [Reflector, ConfigService],
          useFactory: (reflector: Reflector, config: GatewayConfig) =>
            new AppVersionGuard(
              reflector,
              config.get('MIN_SUPPORTED_APP_VERSION', { infer: true }),
            ),
        },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
    };
  }
}
