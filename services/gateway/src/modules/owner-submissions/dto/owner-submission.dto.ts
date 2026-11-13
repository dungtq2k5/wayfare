import { zOwnerSubmissionsQuery, zSubmissionCreateInput, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /owner/submissions` body (api-endpoints-plan §3.3). */
export const createSubmissionBodySchema = zSubmissionCreateInput;

/** Validated `POST /owner/submissions` body. */
export class CreateSubmissionDto extends createZodDto(createSubmissionBodySchema) {}

/** `GET /owner/submissions` query. */
export const ownerSubmissionsQuerySchema = zOwnerSubmissionsQuery;

/** Validated `GET /owner/submissions` query. */
export class OwnerSubmissionsQueryDto extends createZodDto(ownerSubmissionsQuerySchema) {}

/** A submission's `:id`. */
export const submissionIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated submission `:id`. */
export class SubmissionIdParamDto extends createZodDto(submissionIdParamSchema) {}
