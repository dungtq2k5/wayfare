import {
  zApproveSubmissionInput,
  zRejectSubmissionInput,
  zSubmissionQueueQuery,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';

/** `GET /admin/submissions` query (api-endpoints-plan §3.4). */
export const submissionQueueQuerySchema = zSubmissionQueueQuery;

/** Validated queue query. */
export class SubmissionQueueQueryDto extends createZodDto(submissionQueueQuerySchema) {}

/** `POST /admin/submissions/:id/approve` body: the editorial values come from the reviewer. */
export const approveSubmissionBodySchema = zApproveSubmissionInput;

/** Validated approval. */
export class ApproveSubmissionDto extends createZodDto(approveSubmissionBodySchema) {}

/** `POST /admin/submissions/:id/reject` body. */
export const rejectSubmissionBodySchema = zRejectSubmissionInput;

/** Validated rejection. */
export class RejectSubmissionDto extends createZodDto(rejectSubmissionBodySchema) {}
