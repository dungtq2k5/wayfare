import { Inject, Injectable } from '@nestjs/common';
import { hourStart, parseCounterKey, RUNTIME_KEY_PATTERN } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Each finished hour's Area counters — written by the gateway — into A-5 (rdm-spec A-5). The
 * hour in progress is left to `GetCurrentActivity`; a counter is kept two hours, so the next run
 * writes an hour again, the same.
 */
@Injectable()
export class RuntimeFlushJob implements ScheduledJob {
  readonly name = 'runtime-flush';
  readonly everyMs = HOUR_MS;
  readonly cron = '5 * * * *';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async run(now: Date = new Date()): Promise<{ written: number }> {
    const current = hourStart(now).getTime();
    let written = 0;
    for await (const keys of this.redis.scanStream({ match: RUNTIME_KEY_PATTERN, count: 500 })) {
      for (const key of keys as string[]) {
        const parsed = parseCounterKey(key);
        if (parsed === null || parsed.hour.getTime() >= current) continue;
        const estimate = await this.redis.pfcount(key);
        await this.prisma.$executeRaw`
          INSERT INTO runtime_activity_hourly (area_id, bucket_start, active_estimate, computed_at)
          VALUES (${parsed.subject}::uuid, ${parsed.hour}, ${estimate}, ${now})
          ON CONFLICT (area_id, bucket_start) DO UPDATE
          SET active_estimate = GREATEST(runtime_activity_hourly.active_estimate, EXCLUDED.active_estimate),
              computed_at = EXCLUDED.computed_at`;
        written += 1;
      }
    }
    return { written };
  }
}
