import { Inject, Injectable } from '@nestjs/common';
import { HEATMAP_KEY_PATTERN, HEATMAP_MIN_DEVICES, parseCounterKey } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Re-counts every cell-hour counter still held — up to 8 days back — into A-3 (rdm-spec A-3):
 * a late event lands in its own hour, and a cell that reaches 5 late appears then. A cell under 5 is
 * never written; an estimate never falls (`GREATEST`), so a written row never needs removing. The
 * counters expire by themselves.
 */
@Injectable()
export class HeatmapFlushJob implements ScheduledJob {
  readonly name = 'heatmap-flush';
  readonly everyMs = HOUR_MS;
  readonly cron = '5 * * * *';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async run(now: Date = new Date()): Promise<{ counters: number; written: number }> {
    let counters = 0;
    let written = 0;
    for await (const keys of this.redis.scanStream({ match: HEATMAP_KEY_PATTERN, count: 500 })) {
      for (const key of keys as string[]) {
        const parsed = parseCounterKey(key);
        if (parsed === null) continue;
        counters += 1;
        const estimate = await this.redis.pfcount(key);
        if (estimate < HEATMAP_MIN_DEVICES) continue;
        await this.prisma.$executeRaw`
          INSERT INTO location_cell_hourly (cell, bucket_start, device_estimate, computed_at)
          VALUES (${parsed.subject}, ${parsed.hour}, ${estimate}, ${now})
          ON CONFLICT (cell, bucket_start) DO UPDATE
          SET device_estimate = GREATEST(location_cell_hourly.device_estimate, EXCLUDED.device_estimate),
              computed_at = EXCLUDED.computed_at`;
        written += 1;
      }
    }
    return { counters, written };
  }
}
