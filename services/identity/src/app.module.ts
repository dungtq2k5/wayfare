import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { createLoggerModule, NatsClient, OpsModule } from '@wayfare/nest-common';
import { AppConfig } from './config/env.schema';
import { AuditConsumer } from './modules/audit/audit.consumer';
import { AuditModule } from './modules/audit/audit.module';
import { DevicesModule } from './modules/devices/devices.module';
import { CONSUMERS, EventSpine, OutboxModule } from './modules/outbox/outbox.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PrismaService } from './modules/prisma/prisma.service';

/** Makes the parsed configuration injectable everywhere. */
@Module({})
class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: AppConfig, useValue: config }],
      exports: [AppConfig],
    };
  }
}

/** identity's root module — a hybrid app: gRPC plus HTTP ops routes (api-endpoints-plan §13). */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        createLoggerModule({ level: config.LOG_LEVEL }),
        PrismaModule,
        OutboxModule,
        AuditModule,
        DevicesModule,
        OpsModule.forRoot({
          grpcHealth: true,
          version: {
            service: 'identity',
            version: config.APP_VERSION,
            gitSha: config.GIT_SHA,
            builtAt: config.BUILT_AT,
          },
          // Readiness: this service's own dependencies — its database and NATS (api-endpoints-plan §13).
          checks: {
            inject: [PrismaService, NatsClient],
            useFactory: (prisma: PrismaService, nats: NatsClient) => [
              prisma.readinessCheck(),
              nats.readinessCheck(),
            ],
          },
        }),
      ],
      providers: [
        EventSpine,
        {
          provide: CONSUMERS,
          inject: [AuditConsumer],
          useFactory: (audit: AuditConsumer) => [audit],
        },
      ],
    };
  }
}
