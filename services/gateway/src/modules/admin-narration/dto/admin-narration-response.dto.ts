import {
  zProviderHealth,
  zSynthesisJobDetail,
  zSynthesisJobSummary,
  zVoiceCatalogue,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** One job, as the monitor lists it (api-endpoints-plan §4.3). */
export class SynthesisJobResponseDto extends createZodDto(zSynthesisJobSummary) {}

/** A job with every task. */
export class SynthesisJobDetailResponseDto extends createZodDto(zSynthesisJobDetail) {}

/** An action's answer: the job as it now is. */
export const synthesisJobResultResponseSchema = z.object({ job: zSynthesisJobSummary }).strict();

/** `{ job }`. */
export class SynthesisJobResultResponseDto extends createZodDto(synthesisJobResultResponseSchema) {}

/** One provider's health, per process. */
export class ProviderHealthResponseDto extends createZodDto(zProviderHealth) {}

/** One language's pinned voice and its provider's catalogue. */
export class VoiceCatalogueResponseDto extends createZodDto(zVoiceCatalogue) {}
