import { Module } from '@nestjs/common';
import { DailyRollupJob } from './daily-rollup.job';
import { HeatmapFlushJob } from './heatmap-flush.job';
import { RawPruneJob } from './raw-prune.job';
import { RuntimeFlushJob } from './runtime-flush.job';

/** analytics' scheduled jobs — the list health is judged against (conventions §7.3). */
export const SCHEDULED_JOBS = [
  'heatmap-flush',
  'runtime-flush',
  'daily-rollup',
  'raw-prune',
] as const;

const JOBS = [HeatmapFlushJob, RuntimeFlushJob, DailyRollupJob, RawPruneJob];

/** The job classes; nest-common's `JobsModule` schedules and runs them. */
@Module({ providers: JOBS, exports: JOBS })
export class ScheduledModule {}
