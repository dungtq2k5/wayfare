import { Injectable } from '@nestjs/common';
import { Paged } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import type {
  SubmissionResponseDto,
  SubmissionResultResponseDto,
} from './dto/owner-submission-response.dto';
import type { CreateSubmissionDto, OwnerSubmissionsQueryDto } from './dto/owner-submission.dto';
import {
  toCreateSubmissionRequest,
  toListMySubmissionsRequest,
  toSubmissionResponseDto,
} from './owner-submission.mapper';

/** `/owner/submissions`, backed by `catalog.SubmissionService` (api-endpoints-plan §3.3). */
@Injectable()
export class OwnerSubmissionsService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  async create(
    context: AccountContext,
    body: CreateSubmissionDto,
  ): Promise<SubmissionResultResponseDto> {
    const response = await this.catalog.submissions.call(
      'createSubmission',
      toCreateSubmissionRequest(body),
      context,
    );
    return { submission: toSubmissionResponseDto(response.submission) };
  }

  async list(
    context: AccountContext,
    query: OwnerSubmissionsQueryDto,
  ): Promise<Paged<SubmissionResponseDto>> {
    const response = await this.catalog.submissions.call(
      'listMySubmissions',
      toListMySubmissionsRequest(query),
      context,
    );
    return Paged.cursor(
      response.submissions.map(toSubmissionResponseDto),
      response.page?.nextCursor ?? null,
    );
  }

  async get(context: AccountContext, submissionId: string): Promise<SubmissionResponseDto> {
    const response = await this.catalog.submissions.call(
      'getMySubmission',
      { submissionId },
      context,
    );
    return toSubmissionResponseDto(response.submission);
  }

  async withdraw(
    context: AccountContext,
    submissionId: string,
  ): Promise<SubmissionResultResponseDto> {
    const response = await this.catalog.submissions.call(
      'withdrawSubmission',
      { submissionId },
      context,
    );
    return { submission: toSubmissionResponseDto(response.submission) };
  }
}
