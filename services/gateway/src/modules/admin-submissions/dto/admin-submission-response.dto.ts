import {
  SUBMISSION_EDITABLE_FIELDS,
  zEntitlements,
  zSubmissionDiffEntry,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { adminPlaceResponseSchema } from '../../admin-places/dto/admin-place-response.dto';
import { ownerContactSchema } from '../../identity/dto/owner-contact.dto';
import { submissionResponseSchema } from '../../owner-submissions/dto/owner-submission-response.dto';

/** A conflict's values when the submission was sent, by field. */
export const conflictBaseValuesSchema = z.partialRecord(
  z.enum(SUBMISSION_EDITABLE_FIELDS),
  z.unknown(),
);

/**
 * A submission as a reviewer sees it (api-endpoints-plan §3.4): the payload, the live Venue, the
 * diff from the owner's base, the owner's entitlements (`null` when billing cannot answer), and
 * the owner-editable fields someone else changed since.
 */
export const adminSubmissionResponseSchema = z.object({
  submission: submissionResponseSchema,
  /** The owner, named for a reviewer without `user.read`. */
  owner: ownerContactSchema,
  internalNote: z.string().nullable(),
  reviewedById: z.string().nullable(),
  livePlace: adminPlaceResponseSchema.nullable(),
  diff: z.array(zSubmissionDiffEntry),
  entitlements: zEntitlements.nullable(),
  conflict: z.object({
    changedFields: z.array(z.enum(SUBMISSION_EDITABLE_FIELDS)),
    /** Each changed field's value when the submission was sent: the *When sent* column. */
    baseValues: conflictBaseValuesSchema,
  }),
  /** Each photo the owner uploaded for this submission: its thumbnail's URL, by upload id. */
  uploadPreviews: z.record(z.string(), z.url()),
});

/** A submission for review. */
export class AdminSubmissionResponseDto extends createZodDto(adminSubmissionResponseSchema) {}

/**
 * A row of the review queue: the submission, its owner named, the fields it changes, and those
 * someone else changed since it was sent (*Changed since sent*).
 */
export const adminSubmissionListItemSchema = submissionResponseSchema.extend({
  owner: ownerContactSchema,
  changedFields: z.array(z.enum(SUBMISSION_EDITABLE_FIELDS)),
  conflictChangedFields: z.array(z.enum(SUBMISSION_EDITABLE_FIELDS)),
});

/** A submission in the review queue. */
export class AdminSubmissionListItemResponseDto extends createZodDto(
  adminSubmissionListItemSchema,
) {}
