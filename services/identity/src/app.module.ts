import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createConfigModule,
  createLoggerModuleAsync,
  NatsClient,
  OpsModule,
} from '@wayfare/nest-common';
import { envSchema } from './config/env.schema';
import type { IdentityConfig } from './config/env.schema';
import { AccessModule } from './modules/access/access.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { AuditConsumer } from './modules/audit/audit.consumer';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { DevicesModule } from './modules/devices/devices.module';
import { LegalModule } from './modules/legal/legal.module';
import { CONSUMERS, EventSpine, OutboxModule } from './modules/outbox/outbox.module';
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

/** identity's root module — a hybrid app: gRPC plus HTTP ops routes (api-endpoints-plan §13). */
@Module({})
export class AppModule {
  /** `env` is for tests only: validate exactly that object, ignoring `.env` and `process.env`. */
  static forRoot(
    options: { env?: Readonly<Record<string, string | undefined>> } = {},
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
        OpsModule.forRootAsync({
          grpcHealth: true,
          // Readiness: this service's own dependencies — database, NATS, Redis (api-endpoints-plan §13).
          inject: [ConfigService, PrismaService, NatsClient, RedisLifecycle],
          useFactory: (
            config: IdentityConfig,
            prisma: PrismaService,
            nats: NatsClient,
            redis: RedisLifecycle,
          ) => ({
            version: {
              service: 'identity',
              version: config.get('APP_VERSION', { infer: true }),
              gitSha: config.get('GIT_SHA', { infer: true }),
              builtAt: config.get('BUILT_AT', { infer: true }),
            },
            checks: [prisma.readinessCheck(), nats.readinessCheck(), redis.readinessCheck()],
          }),
        }),
      ],
      providers: [
        EventSpine,
        {
          provide: CONSUMERS,
          inject: [AuditConsumer, RevocationConsumer],
          useFactory: (audit: AuditConsumer, revocation: RevocationConsumer) => [audit, revocation],
        },
      ],
    };
  }
}
