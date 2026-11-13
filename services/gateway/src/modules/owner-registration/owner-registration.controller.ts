import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OwnerRegistration } from '@wayfare/contracts';
import { ApiEnvelope, ApiErrors, Auth, Ctx, NoStore, UsesUpstream } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  OwnerRegistrationResponseDto,
  OwnerRegistrationResultResponseDto,
} from './dto/owner-registration-response.dto';
import { RegistrationIdParamDto, SubmitRegistrationDto } from './dto/owner-registration.dto';
import { OwnerRegistrationService } from './owner-registration.service';

/**
 * `/owner/registration` — applying to become a venue owner (api-endpoints-plan §1.4). The body
 * carries a national ID: request bodies are never logged, and `*.nationalId` is redacted besides.
 */
@ApiTags('owner-registration')
@UsesUpstream()
@Controller('owner/registration')
export class OwnerRegistrationController {
  constructor(private readonly registrations: OwnerRegistrationService) {}

  @Post()
  @Auth('USER_EMAIL')
  @NoStore()
  @ApiOperation({
    summary: 'Apply, accepting the current owner agreement. The national ID is never echoed.',
  })
  @ApiEnvelope(OwnerRegistrationResultResponseDto)
  @ApiErrors('REGISTRATION_ALREADY_PENDING', 'LEGAL_VERSION_OUTDATED', 'INVALID_STATE')
  @ZodSerializerDto(OwnerRegistrationResultResponseDto)
  submit(
    @Ctx() context: AccountContext,
    @Body() body: SubmitRegistrationDto,
  ): Promise<{ registration: OwnerRegistration }> {
    return this.registrations.submit(context, body);
  }

  @Get()
  @Auth('USER')
  @NoStore()
  @ApiOperation({ summary: "The caller's applications, newest first." })
  @ApiEnvelope(OwnerRegistrationResponseDto, { array: true })
  @ZodSerializerDto([OwnerRegistrationResponseDto])
  list(@Ctx() context: AccountContext): Promise<OwnerRegistration[]> {
    return this.registrations.listMine(context);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @Auth('USER')
  @NoStore()
  @ApiOperation({ summary: 'Withdraw an open application.' })
  @ApiEnvelope(OwnerRegistrationResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'INVALID_STATE')
  @ZodSerializerDto(OwnerRegistrationResultResponseDto)
  withdraw(
    @Ctx() context: AccountContext,
    @Param() params: RegistrationIdParamDto,
  ): Promise<{ registration: OwnerRegistration }> {
    return this.registrations.withdraw(context, params.id);
  }
}
