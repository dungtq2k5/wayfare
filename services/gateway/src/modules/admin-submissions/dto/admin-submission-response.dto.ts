import {
  SUBMISSION_EDITABLE_FIELDS,
  zEntitlements,
  zSubmissionDiffEntry,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { adminPlaceResponseSchema } from '../../admin-places/dto/admin-place-response.dto';
import { submissionResponseSchema } from '../../owner-submissions/dto/owner-submission-response.dto';

/**
 * A submission as a reviewer sees it (api-endpoints-plan §3.4): the payload, the live Venue, the
 * diff from the owner's base, the owner's entitlements (`null` when billing cannot answer), and
 * the owner-editable fields someone else changed since.
 */
export const adminSubmissionResponseSchema = z.object({
  submission: submissionResponseSchema,
  internalNote: z.string().nullable(),
  reviewedById: z.string().nullable(),
  livePlace: adminPlaceResponseSchema.nullable(),
  diff: z.array(zSubmissionDiffEntry),
  entitlements: zEntitlements.nullable(),
  conflict: z.object({ changedFields: z.array(z.enum(SUBMISSION_EDITABLE_FIELDS)) }),
});

/** A submission for review. */
export class AdminSubmissionResponseDto extends createZodDto(adminSubmissionResponseSchema) {}
