import { SUBMISSION_EDITABLE_FIELDS } from '@wayfare/contracts';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { Paged } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { IdentityService } from '../identity/identity.service';
import type { SubmissionResultResponseDto } from '../owner-submissions/dto/owner-submission-response.dto';
import { toSubmissionResponseDto } from '../owner-submissions/owner-submission.mapper';
import {
  toAdminSubmissionResponseDto,
  toApproveSubmissionRequest,
  toListSubmissionsRequest,
  toRejectSubmissionRequest,
} from './admin-submission.mapper';
import type {
  AdminSubmissionListItemResponseDto,
  AdminSubmissionResponseDto,
} from './dto/admin-submission-response.dto';
import type {
  ApproveSubmissionDto,
  RejectSubmissionDto,
  SubmissionQueueQueryDto,
} from './dto/admin-submission.dto';

const fieldsOf = (fields: readonly string[]) =>
  z.array(z.enum(SUBMISSION_EDITABLE_FIELDS)).parse(fields);

/** `/admin/submissions`, backed by `catalog.SubmissionReviewService` (api-endpoints-plan §3.4). */
@Injectable()
export class AdminSubmissionsService {
  constructor(
    private readonly catalog: CatalogServiceGrpcClient,
    private readonly identity: IdentityService,
  ) {}

  async list(
    context: AccountContext,
    query: SubmissionQueueQueryDto,
  ): Promise<Paged<AdminSubmissionListItemResponseDto>> {
    const response = await this.catalog.submissionReview.call(
      'listSubmissions',
      toListSubmissionsRequest(query),
      context,
    );
    // ponytail: one identity call per row (a page is ≤ 50); a batched GetOwnerContacts if it shows.
    const rows = await Promise.all(
      response.submissions.map(async (row) => {
        const submission = toSubmissionResponseDto(row.submission);
        return {
          ...submission,
          changedFields: fieldsOf(row.changedFields),
          conflictChangedFields: fieldsOf(row.conflictChangedFields),
          owner: await this.identity.ownerContact(context, submission.ownerUserId),
        };
      }),
    );
    return Paged.page(
      rows,
      response.page?.page ?? query.page,
      response.page?.pageSize ?? query.pageSize,
      response.page?.total ?? 0,
    );
  }

  async get(context: AccountContext, submissionId: string): Promise<AdminSubmissionResponseDto> {
    const response = await this.catalog.submissionReview.call(
      'getSubmission',
      { submissionId },
      context,
    );
    const view = toAdminSubmissionResponseDto(response.submission);
    return {
      ...view,
      owner: await this.identity.ownerContact(context, view.submission.ownerUserId),
    };
  }

  async approve(
    context: AccountContext,
    submissionId: string,
    body: ApproveSubmissionDto,
  ): Promise<SubmissionResultResponseDto> {
    const response = await this.catalog.submissionReview.call(
      'approveSubmission',
      toApproveSubmissionRequest(submissionId, body),
      context,
    );
    return { submission: toSubmissionResponseDto(response.submission) };
  }

  async reject(
    context: AccountContext,
    submissionId: string,
    body: RejectSubmissionDto,
  ): Promise<SubmissionResultResponseDto> {
    const response = await this.catalog.submissionReview.call(
      'rejectSubmission',
      toRejectSubmissionRequest(submissionId, body),
      context,
    );
    return { submission: toSubmissionResponseDto(response.submission) };
  }
}
