import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { GoogleOutcome, WayfareClient } from '@wayfare/contracts';
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
import {
  GoogleConfirmDto,
  GoogleLinkDto,
  GoogleSignInDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
} from './dto/auth.dto';
import {
  GoogleConfirmResponseDto,
  GoogleNonceResponseDto,
  GoogleSessionResponseDto,
  SessionResponseDto,
} from './dto/session-response.dto';

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
  @RateLimit('AUTH_LOGIN')
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

  @Post('google/nonce')
  @HttpCode(HttpStatus.OK)
  @Auth('DEVICE')
  @RateLimit('AUTH_NONCE')
  @NoStore()
  @ApiOperation({
    summary:
      'A nonce for this device, which the next Google ID token must carry (5 minutes, once).',
  })
  @ApiEnvelope(GoogleNonceResponseDto)
  @ZodSerializerDto(GoogleNonceResponseDto)
  googleNonce(@Ctx() context: RequestContext): Promise<{ nonce: string }> {
    return this.auth.googleNonce(context);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Auth('PUBLIC')
  @RateLimit('AUTH_LOGIN')
  @NoStore()
  @ApiOperation({
    summary:
      'Continue with Google: signs in, creates, links — or, where Google does not own the mailbox, asks for the password first.',
  })
  @ApiEnvelope(GoogleSessionResponseDto)
  @ApiErrors(
    'INVALID_GOOGLE_TOKEN',
    'GOOGLE_UNAVAILABLE',
    'GOOGLE_LINK_NEEDS_PASSWORD',
    'GOOGLE_ACCOUNT_ALREADY_LINKED',
    'GOOGLE_SIGN_IN_NOT_ALLOWED',
    'ACCOUNT_DEACTIVATED',
    'ACCOUNT_LOCKED',
    'EMAIL_TAKEN',
  )
  @ZodSerializerDto(GoogleSessionResponseDto)
  googleSignIn(
    @Ctx() context: RequestContext,
    @ClientKind() client: WayfareClient,
    @Body() body: GoogleSignInDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionBody & { outcome: GoogleOutcome }> {
    return this.auth.googleSignIn(context, client, body, res);
  }

  @Post('google/confirm')
  @HttpCode(HttpStatus.OK)
  @Auth('USER', { alsoDevice: true })
  @RateLimit('PASSWORD_CHECK')
  @NoStore()
  @ApiOperation({
    summary:
      'A fresh Google ID token for the caller’s own Google account → a proof that stands in for the current password.',
  })
  @ApiEnvelope(GoogleConfirmResponseDto)
  @ApiErrors('INVALID_GOOGLE_TOKEN', 'GOOGLE_UNAVAILABLE', 'GOOGLE_ACCOUNT_MISMATCH')
  @ZodSerializerDto(GoogleConfirmResponseDto)
  googleConfirm(
    @Ctx() context: AccountContext,
    @Body() body: GoogleConfirmDto,
  ): Promise<{ confirmation: string }> {
    return this.auth.googleConfirm(context, body);
  }

  @Post('google/link')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('USER', { alsoDevice: true })
  @ApiOperation({
    summary:
      'Link the ticket’s Google account to the caller, signed in with its password (ADR 0064).',
  })
  @ApiEnvelope(null)
  @ApiErrors('CONFIRMATION_EXPIRED', 'GOOGLE_ACCOUNT_MISMATCH', 'GOOGLE_ACCOUNT_ALREADY_LINKED')
  async googleLink(@Ctx() context: AccountContext, @Body() body: GoogleLinkDto): Promise<void> {
    await this.auth.googleLink(context, body);
  }
}
