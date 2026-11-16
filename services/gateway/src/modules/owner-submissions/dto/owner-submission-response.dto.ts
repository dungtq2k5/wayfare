import {
  SubmissionKind,
  SubmissionStatus,
  zCategoryCode,
  zPlaceSubmissionPayload,
  zSubmissionDiffEntry,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const zInstant = z.iso.datetime({ offset: true });

/** A submission as its owner sees it: never the internal note (api-endpoints-plan §3.3). */
export const submissionResponseSchema = z.object({
  id: zUuidV7,
  kind: z.enum(SubmissionKind),
  status: z.enum(SubmissionStatus),
  placeId: zUuidV7.nullable(),
  ownerUserId: zUuidV7,
  payload: zPlaceSubmissionPayload,
  payloadSchemaVersion: z.number().int().min(1),
  /** The category the reviewer applied instead of the payload's, when they did. */
  categoryCodeOverride: zCategoryCode.nullable(),
  decisionNote: z.string().nullable(),
  submittedAt: zInstant,
  reviewedAt: zInstant.nullable(),
  /**
   * Field by field, the submission's base against what it asks for — the admin review's diff — on
   * the single reads (a submission, a Venue's pending one); `null` on the list's rows.
   */
  diff: z.array(zSubmissionDiffEntry).nullable(),
});

/** A submission. */
export class SubmissionResponseDto extends createZodDto(submissionResponseSchema) {}

/** `{ submission }` — what the submission writes return. */
export const submissionResultResponseSchema = z.object({ submission: submissionResponseSchema });

/** `{ submission }`. */
export class SubmissionResultResponseDto extends createZodDto(submissionResultResponseSchema) {}
