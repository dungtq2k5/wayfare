import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { AuthService } from './auth.service';

/** `wayfare.identity.AuthService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.AuthServiceControllerMethods()
export class AuthGrpcController implements identityGrpc.AuthServiceController {
  constructor(private readonly auth: AuthService) {}

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
}
