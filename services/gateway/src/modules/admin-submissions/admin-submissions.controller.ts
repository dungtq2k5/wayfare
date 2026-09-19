import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  Ctx,
  NoStore,
  RequirePermission,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext, Paged } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  SubmissionResponseDto,
  SubmissionResultResponseDto,
} from '../owner-submissions/dto/owner-submission-response.dto';
import { SubmissionIdParamDto } from '../owner-submissions/dto/owner-submission.dto';
import { AdminSubmissionsService } from './admin-submissions.service';
import { AdminSubmissionResponseDto } from './dto/admin-submission-response.dto';
import {
  ApproveSubmissionDto,
  RejectSubmissionDto,
  SubmissionQueueQueryDto,
} from './dto/admin-submission.dto';

/**
 * `/admin/submissions` (api-endpoints-plan §3.4): the review queue. The permission check is here;
 * catalog re-checks the plan and the owner, and applies an approval in one transaction.
 */
@ApiTags('admin-submissions')
@UsesUpstream()
@Controller('admin/submissions')
export class AdminSubmissionsController {
  constructor(private readonly submissions: AdminSubmissionsService) {}

  @Get()
  @RequirePermission('submission.read')
  @NoStore()
  @ApiOperation({ summary: 'The review queue, oldest first.' })
  @ApiEnvelope(SubmissionResponseDto, { list: 'page' })
  @ZodSerializerDto(SubmissionResponseDto)
  list(
    @Ctx() context: AccountContext,
    @Query() query: SubmissionQueueQueryDto,
  ): Promise<Paged<SubmissionResponseDto>> {
    return this.submissions.list(context, query);
  }

  @Get(':id')
  @RequirePermission('submission.read')
  @NoStore()
  @ApiOperation({
    summary: 'A submission beside the live Venue, the diff, the plan and any conflict.',
  })
  @ApiEnvelope(AdminSubmissionResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(AdminSubmissionResponseDto)
  get(
    @Ctx() context: AccountContext,
    @Param() params: SubmissionIdParamDto,
  ): Promise<AdminSubmissionResponseDto> {
    return this.submissions.get(context, params.id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('submission.review')
  @NoStore()
  @ApiOperation({ summary: 'Approve with the reviewer’s radius and priority.' })
  @ApiEnvelope(SubmissionResultResponseDto)
  @ApiErrors(
    'RESOURCE_NOT_FOUND',
    'INVALID_STATE',
    'SUBMISSION_CONFLICT',
    'PLACE_LIMIT_REACHED',
    'PHOTO_LIMIT_REACHED',
    'MENU_LIMIT_REACHED',
    'CATEGORY_NOT_APPLICABLE',
    'LOCATION_OUTSIDE_AREAS',
    'UPLOAD_NOT_READY',
    'ENTITLEMENTS_UNAVAILABLE',
  )
  @ZodSerializerDto(SubmissionResultResponseDto)
  approve(
    @Ctx() context: AccountContext,
    @Param() params: SubmissionIdParamDto,
    @Body() body: ApproveSubmissionDto,
  ): Promise<SubmissionResultResponseDto> {
    return this.submissions.approve(context, params.id, body);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('submission.review')
  @NoStore()
  @ApiOperation({ summary: 'Reject; the owner is always told why.' })
  @ApiEnvelope(SubmissionResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'INVALID_STATE')
  @ZodSerializerDto(SubmissionResultResponseDto)
  reject(
    @Ctx() context: AccountContext,
    @Param() params: SubmissionIdParamDto,
    @Body() body: RejectSubmissionDto,
  ): Promise<SubmissionResultResponseDto> {
    return this.submissions.reject(context, params.id, body);
  }
}
