import {
  LocalizationTargetType,
  MAX_LANGS_PER_EVENT,
  SynthesisJobStatus,
  SynthesisTrigger,
  zLanguage,
  zPageQuery,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `GET /admin/narration/jobs` query (api-endpoints-plan §4.3): newest first. */
export const listJobsQuerySchema = zPageQuery({
  sort: ['createdAt'],
  defaultSort: '-createdAt',
}).extend({
  status: z.enum(SynthesisJobStatus).optional(),
  targetType: z.enum(LocalizationTargetType).optional(),
  targetId: zUuidV7.optional(),
  trigger: z.enum(SynthesisTrigger).optional(),
});

/** Validated `GET /admin/narration/jobs` query. */
export class ListJobsQueryDto extends createZodDto(listJobsQuerySchema) {}

/** `/admin/narration/jobs/:id`. */
export const jobIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated job path parameter. */
export class JobIdParamDto extends createZodDto(jobIdParamSchema) {}

/** `POST /admin/narration/jobs` body: a manual regenerate. Audio is for a Place only. */
export const createJobBodySchema = z
  .object({
    targetType: z.enum([LocalizationTargetType.PLACE, LocalizationTargetType.MENU_ITEM]),
    targetId: zUuidV7,
    langs: z.array(zLanguage).min(1).max(MAX_LANGS_PER_EVENT),
    includeAudio: z.boolean(),
  })
  .strict()
  .refine((body) => !body.includeAudio || body.targetType === LocalizationTargetType.PLACE, {
    message: 'Only a Place has audio',
    path: ['includeAudio'],
  });

/** Validated manual-job body. */
export class CreateJobDto extends createZodDto(createJobBodySchema) {}
