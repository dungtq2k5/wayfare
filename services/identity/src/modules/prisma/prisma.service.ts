import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { ReadinessCheck } from '@wayfare/nest-common';
import { PrismaClient } from '../../../generated/prisma/client';
import { AppConfig } from '../../config/env.schema';

/**
 * identity's Prisma client over the `pg` driver adapter (ADR 0014). Registered as a class so Nest
 * runs its lifecycle hooks — a `useFactory` value would leak its pool on every restart.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Readiness: the database answers a trivial query. */
  readinessCheck(): ReadinessCheck {
    return {
      name: 'database',
      check: async () => {
        await this.$queryRaw`SELECT 1`;
      },
    };
  }
}
