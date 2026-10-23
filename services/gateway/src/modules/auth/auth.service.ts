import { Injectable } from '@nestjs/common';
import type { GoogleOutcome, WayfareClient } from '@wayfare/contracts';
import { googleOutcomeProto } from '@wayfare/contracts/grpc';
import {
  AppHttpException,
  httpStatusOf,
  SessionResponder,
  usesSessionCookies,
} from '@wayfare/nest-common';
import type {
  AccountContext,
  BearerSessionBody,
  CookieSessionBody,
  RequestContext,
  SessionTokens,
} from '@wayfare/nest-common';
import type { Response } from 'express';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import type {
  GoogleConfirmDto,
  GoogleLinkDto,
  GoogleSignInDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
} from './dto/auth.dto';
import { toGatewaySession, toSessionClient } from './session.mapper';

/** A session as the gateway holds it, before deciding what travels where. */
export interface GatewaySession extends SessionTokens {
  readonly user: UserResponseDto;
}

/** A session response body, per client. */
export type SessionBody = CookieSessionBody<UserResponseDto> | BearerSessionBody<UserResponseDto>;

/**
 * Sign-in routes, backed by `identity.AuthService`. identity mints the tokens; the gateway only
 * decides where they travel (api-endpoints-plan §0.3).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly identity: IdentityServiceGrpcClient,
    private readonly responder: SessionResponder,
  ) {}

  async register(
    context: RequestContext,
    client: WayfareClient,
    body: RegisterDto,
    res: Response,
  ): Promise<SessionBody> {
    const response = await this.identity.auth.call(
      'register',
      {
        email: body.email,
        password: body.password,
        ...(body.fullName === undefined ? {} : { fullName: body.fullName }),
        preferredLocale: body.preferredLocale,
        termsVersion: body.termsVersion,
        client: toSessionClient(client),
      },
      context,
    );
    return this.respond(client, toGatewaySession(response.session), res);
  }

  async login(
    context: RequestContext,
    client: WayfareClient,
    body: LoginDto,
    res: Response,
  ): Promise<SessionBody> {
    const response = await this.identity.auth.call(
      'login',
      { email: body.email, password: body.password, client: toSessionClient(client) },
      context,
    );
    return this.respond(client, toGatewaySession(response.session), res);
  }

  /**
   * Rotates the session. The token comes from the cookie for `console` and `web` and from the body
   * for `mobile`. A `401` clears the cookies; a lost race's `409` leaves them alone.
   */
  async refresh(
    context: RequestContext,
    client: WayfareClient,
    body: RefreshDto,
    cookie: string | null,
    res: Response,
  ): Promise<SessionBody> {
    const refreshToken = usesSessionCookies(client) ? cookie : (body.refreshToken ?? null);
    try {
      if (refreshToken === null || refreshToken === '')
        throw new AppHttpException('UNAUTHENTICATED');
      const response = await this.identity.auth.call(
        'refresh',
        { refreshToken, client: toSessionClient(client) },
        context,
      );
      return this.respond(client, toGatewaySession(response.session), res);
    } catch (error) {
      this.responder.onRefreshFailure(client, httpStatusOf(error), res);
      throw error;
    }
  }

  /** Signs the family out, and clears the cookies whatever identity answers (api-endpoints-plan §1.2). */
  async logout(
    context: RequestContext,
    client: WayfareClient,
    body: RefreshDto,
    cookie: string | null,
    res: Response,
  ): Promise<void> {
    const refreshToken = usesSessionCookies(client) ? cookie : (body.refreshToken ?? null);
    try {
      await this.identity.auth.call(
        'logout',
        refreshToken === null ? {} : { refreshToken },
        context,
      );
    } finally {
      this.responder.clear(res);
    }
  }

  /** Signs every session out, and clears this client's cookies whatever identity answers. */
  async logoutAll(context: AccountContext, res: Response): Promise<void> {
    try {
      await this.identity.auth.call('logoutAll', {}, context);
    } finally {
      this.responder.clear(res);
    }
  }

  async claimDevice(context: AccountContext): Promise<void> {
    await this.identity.auth.call('claimDevice', {}, context);
  }

  /** A nonce for this device's next Google ID token (ADR 0062). */
  async googleNonce(context: RequestContext): Promise<{ nonce: string }> {
    return this.identity.auth.call('googleNonce', {}, context);
  }

  /** Continue with Google: a session and its outcome, or K6's refusals (api-endpoints-plan §1.2). */
  async googleSignIn(
    context: RequestContext,
    client: WayfareClient,
    body: GoogleSignInDto,
    res: Response,
  ): Promise<SessionBody & { outcome: GoogleOutcome }> {
    const response = await this.identity.auth.call(
      'googleSignIn',
      {
        idToken: body.idToken,
        preferredLocale: body.preferredLocale,
        client: toSessionClient(client),
      },
      context,
    );
    const outcome = googleOutcomeProto.fromProto(response.outcome);
    if (outcome === null) throw new AppHttpException('UPSTREAM_UNAVAILABLE');
    return { ...this.respond(client, toGatewaySession(response.session), res), outcome };
  }

  /** A Google confirmation in place of the current password. */
  async googleConfirm(
    context: AccountContext,
    body: GoogleConfirmDto,
  ): Promise<{ confirmation: string }> {
    return this.identity.auth.call('googleConfirm', { idToken: body.idToken }, context);
  }

  /** Links the ticket's Google account after the password sign-in (ADR 0064). */
  async googleLink(context: AccountContext, body: GoogleLinkDto): Promise<void> {
    await this.identity.auth.call('googleLink', { linkTicket: body.linkTicket }, context);
  }

  private respond(client: WayfareClient, session: GatewaySession, res: Response): SessionBody {
    return this.responder.respond(client, session, res, new Date());
  }
}
