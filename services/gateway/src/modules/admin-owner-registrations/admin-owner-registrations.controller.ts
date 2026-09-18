import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OwnerRegistrationAdmin, OwnerRegistrationAdminItem } from '@wayfare/contracts';
import {
  ApiEnvelope,
  ApiErrors,
  Ctx,
  NoStore,
  RateLimit,
  RequirePermission,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext, Paged } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminOwnerRegistrationsService } from './admin-owner-registrations.service';
import {
  OwnerRegistrationAdminItemResponseDto,
  OwnerRegistrationAdminResponseDto,
  OwnerRegistrationAdminResultResponseDto,
  RevealedNationalIdResponseDto,
} from './dto/admin-owner-registration-response.dto';
import {
  ApproveRegistrationDto,
  OwnerRegistrationIdParamDto,
  OwnerRegistrationQueueQueryDto,
  RejectRegistrationDto,
} from './dto/admin-owner-registration.dto';

/**
 * `/admin/owner-registrations` — the review queue (api-endpoints-plan §1.5). The permission check
 * is here; identity refuses a reviewer's own application and a deactivated applicant.
 */
@ApiTags('admin-owner-registrations')
@UsesUpstream()
@Controller('admin/owner-registrations')
export class AdminOwnerRegistrationsController {
  constructor(private readonly registrations: AdminOwnerRegistrationsService) {}

  @Get()
  @RequirePermission('owner_registration.read')
  @NoStore()
  @ApiOperation({ summary: 'The queue, a page at a time; oldest `PENDING` first by default.' })
  @ApiEnvelope(OwnerRegistrationAdminItemResponseDto, { list: 'page' })
  @ZodSerializerDto(OwnerRegistrationAdminItemResponseDto)
  list(
    @Ctx() context: AccountContext,
    @Query() query: OwnerRegistrationQueueQueryDto,
  ): Promise<Paged<OwnerRegistrationAdminItem>> {
    return this.registrations.list(context, query);
  }

  @Get(':id')
  @RequirePermission('owner_registration.read')
  @NoStore()
  @ApiOperation({
    summary: 'One application with its applicant and their earlier applications.',
  })
  @ApiEnvelope(OwnerRegistrationAdminResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(OwnerRegistrationAdminResponseDto)
  get(
    @Ctx() context: AccountContext,
    @Param() params: OwnerRegistrationIdParamDto,
  ): Promise<OwnerRegistrationAdmin> {
    return this.registrations.get(context, params.id);
  }

  @Post(':id/national-id/reveal')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('owner_registration.pii.read')
  @RateLimit('PII_REVEAL')
  @NoStore()
  @ApiOperation({
    summary: 'Decrypt the national ID once. Every call writes an audit row; never cached.',
  })
  @ApiEnvelope(RevealedNationalIdResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'NATIONAL_ID_REDACTED')
  @ZodSerializerDto(RevealedNationalIdResponseDto)
  reveal(
    @Ctx() context: AccountContext,
    @Param() params: OwnerRegistrationIdParamDto,
  ): Promise<{ nationalId: string }> {
    return this.registrations.reveal(context, params.id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('owner_registration.review')
  @NoStore()
  @ApiOperation({
    summary: 'Approve: the applicant becomes a verified owner; their tokens are cut off.',
  })
  @ApiEnvelope(OwnerRegistrationAdminResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'INVALID_STATE')
  @ZodSerializerDto(OwnerRegistrationAdminResultResponseDto)
  approve(
    @Ctx() context: AccountContext,
    @Param() params: OwnerRegistrationIdParamDto,
    @Body() body: ApproveRegistrationDto,
  ): Promise<{ registration: OwnerRegistrationAdmin }> {
    return this.registrations.approve(context, params.id, body);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('owner_registration.review')
  @NoStore()
  @ApiOperation({ summary: 'Reject with the note the applicant is shown. They may apply again.' })
  @ApiEnvelope(OwnerRegistrationAdminResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'INVALID_STATE')
  @ZodSerializerDto(OwnerRegistrationAdminResultResponseDto)
  reject(
    @Ctx() context: AccountContext,
    @Param() params: OwnerRegistrationIdParamDto,
    @Body() body: RejectRegistrationDto,
  ): Promise<{ registration: OwnerRegistrationAdmin }> {
    return this.registrations.reject(context, params.id, body);
  }
}
