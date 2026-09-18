import { Module } from '@nestjs/common';
import { AudioAssetsGcJob } from './audio-assets-gc.job';
import { SynthesisJobsPruneJob } from './synthesis-jobs-prune.job';
import { SynthesisRecoverJob } from './synthesis-recover.job';
import { TranslationCachePruneJob } from './translation-cache-prune.job';

/** narration's scheduled jobs — the list health is judged against (conventions §7.3). */
export const SCHEDULED_JOBS = [
  'synthesis-recover',
  'synthesis-jobs-prune',
  'audio-assets-gc',
  'translation-cache-prune',
] as const;

/** The job classes; nest-common's `JobsModule` schedules and runs them. */
@Module({
  providers: [
    SynthesisRecoverJob,
    SynthesisJobsPruneJob,
    AudioAssetsGcJob,
    TranslationCachePruneJob,
  ],
  exports: [SynthesisRecoverJob, SynthesisJobsPruneJob, AudioAssetsGcJob, TranslationCachePruneJob],
})
export class ScheduledModule {}
