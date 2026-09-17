import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
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
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import type { Response } from 'express';
import { LinkTokenDto } from '../password/dto/password.dto';
import { ChangeEmailDto } from './dto/email-change.dto';
import { EmailChangeService } from './email-change.service';

/**
 * `/auth/email` (api-endpoints-plan §1.2): verification, and a change with its seven-day revert
 * (ADR 0052). Link tokens travel in bodies only.
 */
@ApiTags('auth')
@UsesUpstream()
@Controller('auth/email')
export class EmailChangeController {
  constructor(private readonly emails: EmailChangeService) {}

  @Post('verify/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Auth('USER')
  @RateLimit('EMAIL_REQUEST')
  @NoStore()
  @ApiOperation({ summary: 'Re-send the verification link. Already verified: nothing is sent.' })
  @ApiEnvelope(null, { status: HttpStatus.ACCEPTED })
  async requestVerification(@Ctx() context: AccountContext): Promise<void> {
    await this.emails.requestVerification(context);
  }

  @Post('verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('PUBLIC')
  @RateLimit('PUBLIC_READ')
  @NoStore()
  @ApiOperation({
    summary: 'Verify the address a link was sent to. Refresh afterwards to carry it in the token.',
  })
  @ApiEnvelope(null)
  @ApiErrors('TOKEN_EXPIRED')
  async verify(@Ctx() context: RequestContext, @Body() body: LinkTokenDto): Promise<void> {
    await this.emails.verify(context, body);
  }

  @Post('change')
  @HttpCode(HttpStatus.ACCEPTED)
  @Auth('USER')
  @RateLimit('PASSWORD_CHECK')
  @NoStore()
  @ApiOperation({ summary: 'Send a confirmation link to a new address.' })
  @ApiEnvelope(null, { status: HttpStatus.ACCEPTED })
  @ApiErrors(
    'CURRENT_PASSWORD_INCORRECT',
    'EMAIL_TAKEN',
    'EMAIL_CHANGE_REVERT_PENDING',
    'INVALID_STATE',
  )
  async requestChange(@Ctx() context: AccountContext, @Body() body: ChangeEmailDto): Promise<void> {
    await this.emails.requestChange(context, body);
  }

  @Post('change/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('PUBLIC')
  @RateLimit('PUBLIC_READ')
  @NoStore()
  @ApiOperation({
    summary: 'Move the account to the confirmed address; the old one gets a revert link.',
  })
  @ApiEnvelope(null)
  @ApiErrors('TOKEN_EXPIRED', 'EMAIL_TAKEN')
  async confirmChange(@Ctx() context: RequestContext, @Body() body: LinkTokenDto): Promise<void> {
    await this.emails.confirmChange(context, body);
  }

  @Post('change/revert')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('PUBLIC')
  @RateLimit('PUBLIC_READ')
  @NoStore()
  @ApiOperation({
    summary: '"This wasn\'t me": restore the old address and sign every session out.',
  })
  @ApiEnvelope(null)
  @ApiErrors('TOKEN_EXPIRED')
  async revertChange(
    @Ctx() context: RequestContext,
    @Body() body: LinkTokenDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.emails.revertChange(context, body, res);
  }
}
