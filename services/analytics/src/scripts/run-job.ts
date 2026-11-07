// pnpm --filter @wayfare/analytics job <name> [--day YYYY-MM-DD] — runs one scheduled job now, as
// the worker would, recorded in job_runs. Dev and test only: never a route, and nothing the
// production gateway exposes. `--day` rebuilds one business day (daily-rollup only).
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { zBusinessDay } from '@wayfare/contracts';
import { JobRunRecorder } from '@wayfare/nest-common';
import type { ScheduledJob } from '@wayfare/nest-common';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/prisma/prisma.service';
import { DailyRollupJob } from '../modules/scheduled/daily-rollup.job';
import { HeatmapFlushJob } from '../modules/scheduled/heatmap-flush.job';
import { RawPruneJob } from '../modules/scheduled/raw-prune.job';
import { RuntimeFlushJob } from '../modules/scheduled/runtime-flush.job';
import { SCHEDULED_JOBS } from '../modules/scheduled/scheduled.module';

const JOBS = {
  'heatmap-flush': HeatmapFlushJob,
  'runtime-flush': RuntimeFlushJob,
  'daily-rollup': DailyRollupJob,
  'raw-prune': RawPruneJob,
} as const satisfies Record<(typeof SCHEDULED_JOBS)[number], unknown>;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Not in production');
  const [name, flag, value] = process.argv.slice(2);
  if (name === undefined || !(name in JOBS))
    throw new Error(`usage: job <${SCHEDULED_JOBS.join('|')}> [--day YYYY-MM-DD]`);
  const day = flag === '--day' ? zBusinessDay.parse(value) : undefined;
  if (day !== undefined && name !== 'daily-rollup') throw new Error('--day is daily-rollup only');
  const app = await NestFactory.createApplicationContext(AppModule.forRoot({ jobs: false }), {
    logger: ['error', 'warn'],
  });
  try {
    const recorder = new JobRunRecorder(app.get(PrismaService));
    const job: ScheduledJob = app.get(JOBS[name as keyof typeof JOBS]);
    const result = await recorder.track(job.name, () =>
      day === undefined ? job.run(new Date()) : app.get(DailyRollupJob).rebuildDay(day),
    );
    console.log(`✓ ${name}${day === undefined ? '' : ` ${day}`}`, result ?? '');
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
