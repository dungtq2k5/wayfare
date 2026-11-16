import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { GoogleService } from '../google/google.service';
import { AuthService } from './auth.service';

/** `wayfare.identity.AuthService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.AuthServiceControllerMethods()
export class AuthGrpcController implements identityGrpc.AuthServiceController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleService,
  ) {}

  register(
    request: identityGrpc.RegisterRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RegisterResponse> {
    return this.auth.register(request, unpackCallerContext(metadata));
  }

  login(
    request: identityGrpc.LoginRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.LoginResponse> {
    return this.auth.login(request, unpackCallerContext(metadata));
  }

  refresh(
    request: identityGrpc.RefreshRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RefreshResponse> {
    return this.auth.refresh(request, unpackCallerContext(metadata));
  }

  logout(
    request: identityGrpc.LogoutRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.LogoutResponse> {
    return this.auth.logout(request, unpackCallerContext(metadata));
  }

  logoutAll(
    _request: identityGrpc.LogoutAllRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.LogoutAllResponse> {
    return this.auth.logoutAll(unpackCallerContext(metadata));
  }

  claimDevice(
    _request: identityGrpc.ClaimDeviceRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ClaimDeviceResponse> {
    return this.auth.claimDevice(unpackCallerContext(metadata));
  }

  getTokenCutoff(
    request: identityGrpc.GetTokenCutoffRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.GetTokenCutoffResponse> {
    unpackCallerContext(metadata); // internal, but still called with caller metadata
    return this.auth.getTokenCutoff(request);
  }

  googleNonce(
    request: identityGrpc.GoogleNonceRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.GoogleNonceResponse> {
    return this.google.nonce(request, unpackCallerContext(metadata));
  }

  googleSignIn(
    request: identityGrpc.GoogleSignInRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.GoogleSignInResponse> {
    return this.google.signIn(request, unpackCallerContext(metadata));
  }

  googleConfirm(
    request: identityGrpc.GoogleConfirmRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.GoogleConfirmResponse> {
    return this.google.confirm(request, unpackCallerContext(metadata));
  }

  googleLink(
    request: identityGrpc.GoogleLinkRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.GoogleLinkResponse> {
    return this.google.link(request, unpackCallerContext(metadata));
  }

  unlinkGoogle(
    request: identityGrpc.UnlinkGoogleRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.UnlinkGoogleResponse> {
    return this.google.unlink(request, unpackCallerContext(metadata));
  }

  mintFakeGoogleToken(
    request: identityGrpc.MintFakeGoogleTokenRequest,
    metadata?: Metadata,
  ): identityGrpc.MintFakeGoogleTokenResponse {
    unpackCallerContext(metadata); // development only, but still called with caller metadata
    return this.google.mintFake(request);
  }
}
