import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  Auth,
  Ctx,
  NoStore,
  RateLimit,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext, WithMeta } from '@wayfare/nest-common';
import type { Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { LegalAcceptanceResponseDto } from '../devices/dto/device-response.dto';
import { RecordLegalAcceptanceDto } from '../devices/dto/device.dto';
import { LegalAcceptanceStatusResponseDto } from './dto/legal-acceptance-response.dto';
import { MeResponseDto, UpdateMeResponseDto } from './dto/user-response.dto';
import { EraseMeDto, UpdateMeDto } from './dto/user.dto';
import { UsersService } from './users.service';

/** `/users/me` (api-endpoints-plan §1.3). Every response is account-specific: never cached. */
@ApiTags('users')
@UsesUpstream()
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Auth('USER')
  @NoStore()
  @ApiOperation({
    summary: "The console's bootstrap read: the account, its roles and permissions.",
  })
  @ApiEnvelope(MeResponseDto)
  @ZodSerializerDto(MeResponseDto)
  me(@Ctx() context: AccountContext): Promise<MeResponseDto | WithMeta<MeResponseDto>> {
    return this.users.me(context);
  }

  @Patch()
  @Auth('USER')
  @NoStore()
  @ApiOperation({ summary: 'Change the display name or the UI language.' })
  @ApiEnvelope(UpdateMeResponseDto)
  @ZodSerializerDto(UpdateMeResponseDto)
  update(@Ctx() context: AccountContext, @Body() body: UpdateMeDto): Promise<UpdateMeResponseDto> {
    return this.users.update(context, body);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('USER')
  @RateLimit('PASSWORD_CHECK')
  @NoStore()
  @ApiOperation({
    summary:
      'Erase the account: irreversible. The address is freed, every session ends, and this client is signed out.',
  })
  @ApiEnvelope(null)
  @ApiErrors(
    'INVALID_CREDENTIALS',
    'BUYER_HAS_PENDING_ORDER',
    'EMAIL_CHANGE_REVERT_PENDING',
    'OWNER_HAS_ACTIVE_OBLIGATIONS',
    'LAST_SUPER_ADMIN',
  )
  async erase(
    @Ctx() context: AccountContext,
    @Body() body: EraseMeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.users.erase(context, body, res);
  }

  @Get('legal-acceptances')
  @Auth('USER')
  @NoStore()
  @ApiOperation({
    summary: 'The newest acceptance per party and document, and whether it is current.',
  })
  @ApiEnvelope(LegalAcceptanceStatusResponseDto, { array: true })
  @ZodSerializerDto([LegalAcceptanceStatusResponseDto])
  acceptances(@Ctx() context: AccountContext): Promise<LegalAcceptanceStatusResponseDto[]> {
    return this.users.acceptances(context);
  }

  @Post('legal-acceptances')
  @Auth('USER')
  @NoStore()
  @ApiOperation({ summary: "Record the account's acceptance of a document version." })
  @ApiEnvelope(LegalAcceptanceResponseDto)
  @ApiErrors('LEGAL_VERSION_OUTDATED')
  @ZodSerializerDto(LegalAcceptanceResponseDto)
  accept(
    @Ctx() context: AccountContext,
    @Body() body: RecordLegalAcceptanceDto,
  ): Promise<LegalAcceptanceResponseDto> {
    return this.users.recordAcceptance(context, body);
  }
}
