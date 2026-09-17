import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { PasswordService } from './password.service';

/** `wayfare.identity.PasswordService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.PasswordServiceControllerMethods()
export class PasswordGrpcController implements identityGrpc.PasswordServiceController {
  constructor(private readonly passwords: PasswordService) {}

  requestPasswordReset(
    request: identityGrpc.RequestPasswordResetRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RequestPasswordResetResponse> {
    return this.passwords.requestPasswordReset(request, unpackCallerContext(metadata));
  }

  validateResetToken(
    request: identityGrpc.ValidateResetTokenRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ValidateResetTokenResponse> {
    unpackCallerContext(metadata);
    return this.passwords.validateResetToken(request);
  }

  completePasswordReset(
    request: identityGrpc.CompletePasswordResetRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.CompletePasswordResetResponse> {
    return this.passwords.completePasswordReset(request, unpackCallerContext(metadata));
  }

  changePassword(
    request: identityGrpc.ChangePasswordRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ChangePasswordResponse> {
    return this.passwords.changePassword(request, unpackCallerContext(metadata));
  }
}
