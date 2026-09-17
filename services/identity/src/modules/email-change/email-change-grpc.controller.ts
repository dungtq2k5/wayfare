import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { EmailChangeService } from './email-change.service';

/** `wayfare.identity.EmailChangeService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.EmailChangeServiceControllerMethods()
export class EmailChangeGrpcController implements identityGrpc.EmailChangeServiceController {
  constructor(private readonly emails: EmailChangeService) {}

  requestEmailVerification(
    _request: identityGrpc.RequestEmailVerificationRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RequestEmailVerificationResponse> {
    return this.emails.requestEmailVerification(unpackCallerContext(metadata));
  }

  verifyEmail(
    request: identityGrpc.VerifyEmailRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.VerifyEmailResponse> {
    return this.emails.verifyEmail(request, unpackCallerContext(metadata));
  }

  requestEmailChange(
    request: identityGrpc.RequestEmailChangeRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RequestEmailChangeResponse> {
    return this.emails.requestEmailChange(request, unpackCallerContext(metadata));
  }

  confirmEmailChange(
    request: identityGrpc.ConfirmEmailChangeRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ConfirmEmailChangeResponse> {
    return this.emails.confirmEmailChange(request, unpackCallerContext(metadata));
  }

  revertEmailChange(
    request: identityGrpc.RevertEmailChangeRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RevertEmailChangeResponse> {
    return this.emails.revertEmailChange(request, unpackCallerContext(metadata));
  }
}
