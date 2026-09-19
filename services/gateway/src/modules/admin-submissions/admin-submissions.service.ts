import { Injectable } from '@nestjs/common';
import { Paged } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import type {
  SubmissionResponseDto,
  SubmissionResultResponseDto,
} from '../owner-submissions/dto/owner-submission-response.dto';
import { toSubmissionResponseDto } from '../owner-submissions/owner-submission.mapper';
import {
  toAdminSubmissionResponseDto,
  toApproveSubmissionRequest,
  toListSubmissionsRequest,
  toRejectSubmissionRequest,
} from './admin-submission.mapper';
import type { AdminSubmissionResponseDto } from './dto/admin-submission-response.dto';
import type {
  ApproveSubmissionDto,
  RejectSubmissionDto,
  SubmissionQueueQueryDto,
} from './dto/admin-submission.dto';

/** `/admin/submissions`, backed by `catalog.SubmissionReviewService` (api-endpoints-plan §3.4). */
@Injectable()
export class AdminSubmissionsService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  async list(
    context: AccountContext,
    query: SubmissionQueueQueryDto,
  ): Promise<Paged<SubmissionResponseDto>> {
    const response = await this.catalog.submissionReview.call(
      'listSubmissions',
      toListSubmissionsRequest(query),
      context,
    );
    return Paged.page(
      response.submissions.map(toSubmissionResponseDto),
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
    return toAdminSubmissionResponseDto(response.submission);
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
