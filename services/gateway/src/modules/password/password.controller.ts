import { Body, Controller, HttpCode, HttpStatus, Patch, Post, Res } from '@nestjs/common';
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
import { ZodSerializerDto } from 'nestjs-zod';
import { ResetLinkResponseDto } from './dto/password-response.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LinkTokenDto,
  ResetPasswordDto,
} from './dto/password.dto';
import { PasswordService } from './password.service';

/**
 * `/auth/password` (api-endpoints-plan §1.2). Link tokens travel in bodies only; every emailed
 * link carries its token in the URL fragment, which the page posts here.
 */
@ApiTags('auth')
@UsesUpstream()
@Controller('auth/password')
export class PasswordController {
  constructor(private readonly passwords: PasswordService) {}

  @Post('forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @Auth('PUBLIC')
  @RateLimit('AUTH')
  @NoStore()
  @ApiOperation({ summary: 'Email a reset link when the account exists. Always 202.' })
  @ApiEnvelope(null, { status: HttpStatus.ACCEPTED })
  async forgot(@Ctx() context: RequestContext, @Body() body: ForgotPasswordDto): Promise<void> {
    await this.passwords.forgot(context, body);
  }

  @Post('reset/validate')
  @HttpCode(HttpStatus.OK)
  @Auth('PUBLIC')
  @RateLimit('PUBLIC_READ')
  @NoStore()
  @ApiOperation({ summary: 'Whether a reset or setup link is live, before the form is shown.' })
  @ApiEnvelope(ResetLinkResponseDto)
  @ApiErrors('TOKEN_EXPIRED')
  @ZodSerializerDto(ResetLinkResponseDto)
  validate(
    @Ctx() context: RequestContext,
    @Body() body: LinkTokenDto,
  ): Promise<ResetLinkResponseDto> {
    return this.passwords.validate(context, body);
  }

  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('PUBLIC')
  @RateLimit('PUBLIC_READ')
  @NoStore()
  @ApiOperation({
    summary: 'Set a new password from a reset or setup link. Every session is signed out.',
  })
  @ApiEnvelope(null)
  @ApiErrors('TOKEN_EXPIRED')
  async reset(
    @Ctx() context: RequestContext,
    @Body() body: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.passwords.reset(context, body, res);
  }

  @Patch()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('USER')
  @RateLimit('PASSWORD_CHECK')
  @NoStore()
  @ApiOperation({ summary: 'Change the password. Other sessions are signed out; this one stays.' })
  @ApiEnvelope(null)
  @ApiErrors('CURRENT_PASSWORD_INCORRECT')
  async change(@Ctx() context: AccountContext, @Body() body: ChangePasswordDto): Promise<void> {
    await this.passwords.change(context, body);
  }
}
