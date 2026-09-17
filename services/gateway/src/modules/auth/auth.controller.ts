import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { WayfareClient } from '@wayfare/contracts';
import {
  ApiEnvelope,
  ApiErrors,
  Auth,
  ClientKind,
  Ctx,
  NoStore,
  RateLimit,
  RefreshCookie,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import type { Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { AuthService } from './auth.service';
import type { SessionBody } from './auth.service';
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
import { SessionResponseDto } from './dto/session-response.dto';

/** `/auth` (api-endpoints-plan §1.2). Session responses are never cached. */
@ApiTags('auth')
@UsesUpstream()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Auth('PUBLIC')
  @RateLimit('AUTH')
  @NoStore()
  @ApiOperation({
    summary: 'Create an account and sign in. A device bearer, when present, is claimed.',
  })
  @ApiEnvelope(SessionResponseDto)
  @ApiErrors('EMAIL_TAKEN', 'LEGAL_VERSION_OUTDATED')
  @ZodSerializerDto(SessionResponseDto)
  register(
    @Ctx() context: RequestContext,
    @ClientKind() client: WayfareClient,
    @Body() body: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionBody> {
    return this.auth.register(context, client, body, res);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Auth('PUBLIC')
  @RateLimit('AUTH')
  @NoStore()
  @ApiOperation({ summary: 'Sign in. Wrong email and wrong password are indistinguishable.' })
  @ApiEnvelope(SessionResponseDto)
  @ApiErrors('INVALID_CREDENTIALS', 'ACCOUNT_LOCKED')
  @ZodSerializerDto(SessionResponseDto)
  login(
    @Ctx() context: RequestContext,
    @ClientKind() client: WayfareClient,
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionBody> {
    return this.auth.login(context, client, body, res);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Auth('PUBLIC', { refreshCookie: true })
  @RateLimit('PUBLIC_READ')
  @NoStore()
  @ApiOperation({
    summary: 'Rotate the refresh token. A tab that lost a race gets 409 and keeps its cookies.',
  })
  @ApiEnvelope(SessionResponseDto)
  @ApiErrors('UNAUTHENTICATED', 'INVALID_STATE')
  @ZodSerializerDto(SessionResponseDto)
  refresh(
    @Ctx() context: RequestContext,
    @ClientKind() client: WayfareClient,
    @Body() body: RefreshDto,
    @RefreshCookie() cookie: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionBody> {
    return this.auth.refresh(context, client, body, cookie, res);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('PUBLIC', { refreshCookie: true })
  @RateLimit('PUBLIC_READ')
  @ApiOperation({
    summary:
      'Sign this session out — by the access token, or by the refresh token once it has expired.',
  })
  @ApiEnvelope(null)
  async logout(
    @Ctx() context: RequestContext,
    @ClientKind() client: WayfareClient,
    @Body() body: RefreshDto,
    @RefreshCookie() cookie: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(context, client, body, cookie, res);
  }

  @Post('logout/all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('USER')
  @ApiOperation({ summary: 'Sign every session out; every access token dies within seconds.' })
  @ApiEnvelope(null)
  async logoutAll(
    @Ctx() context: AccountContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(context, res);
  }

  @Post('devices/claim')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('USER', { alsoDevice: true })
  @ApiOperation({ summary: 'Claim the calling device for the signed-in account.' })
  @ApiEnvelope(null)
  @ApiErrors('DEVICE_REVOKED')
  async claimDevice(@Ctx() context: AccountContext): Promise<void> {
    await this.auth.claimDevice(context);
  }
}
