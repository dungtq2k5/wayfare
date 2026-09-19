import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, Auth, Ctx, NoStore, UsesUpstream } from '@wayfare/nest-common';
import type { AccountContext, Paged } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  SubmissionResponseDto,
  SubmissionResultResponseDto,
} from './dto/owner-submission-response.dto';
import {
  CreateSubmissionDto,
  OwnerSubmissionsQueryDto,
  SubmissionIdParamDto,
} from './dto/owner-submission.dto';
import { OwnerSubmissionsService } from './owner-submissions.service';

/**
 * `/owner/submissions` (api-endpoints-plan §3.3): a verified owner proposes a Venue, or a change to
 * one, as its complete desired state. catalog checks the Place, the uploads and the plan.
 */
@ApiTags('owner-submissions')
@UsesUpstream()
@Controller('owner/submissions')
export class OwnerSubmissionsController {
  constructor(private readonly submissions: OwnerSubmissionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'Propose a Venue or a change to one; it waits for review.' })
  @ApiEnvelope(SubmissionResultResponseDto, { status: 201 })
  @ApiErrors(
    'RESOURCE_NOT_FOUND',
    'LOCATION_OUTSIDE_AREAS',
    'CATEGORY_NOT_APPLICABLE',
    'UPLOAD_NOT_READY',
    'PLACE_LIMIT_REACHED',
    'PHOTO_LIMIT_REACHED',
    'MENU_LIMIT_REACHED',
    'SUBMISSION_CONFLICT',
    'ENTITLEMENTS_UNAVAILABLE',
  )
  @ZodSerializerDto(SubmissionResultResponseDto)
  create(
    @Ctx() context: AccountContext,
    @Body() body: CreateSubmissionDto,
  ): Promise<SubmissionResultResponseDto> {
    return this.submissions.create(context, body);
  }

  @Get()
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'The owner’s submissions, newest first.' })
  @ApiEnvelope(SubmissionResponseDto, { list: 'cursor' })
  @ZodSerializerDto(SubmissionResponseDto)
  list(
    @Ctx() context: AccountContext,
    @Query() query: OwnerSubmissionsQueryDto,
  ): Promise<Paged<SubmissionResponseDto>> {
    return this.submissions.list(context, query);
  }

  @Get(':id')
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'One submission: payload, status and the reviewer’s note.' })
  @ApiEnvelope(SubmissionResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(SubmissionResponseDto)
  get(
    @Ctx() context: AccountContext,
    @Param() params: SubmissionIdParamDto,
  ): Promise<SubmissionResponseDto> {
    return this.submissions.get(context, params.id);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'Withdraw a pending submission, releasing a reserved place slot.' })
  @ApiEnvelope(SubmissionResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'INVALID_STATE')
  @ZodSerializerDto(SubmissionResultResponseDto)
  withdraw(
    @Ctx() context: AccountContext,
    @Param() params: SubmissionIdParamDto,
  ): Promise<SubmissionResultResponseDto> {
    return this.submissions.withdraw(context, params.id);
  }
}
