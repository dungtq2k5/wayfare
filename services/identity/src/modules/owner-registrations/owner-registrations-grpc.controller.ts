import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { OwnerRegistrationsService } from './owner-registrations.service';

/** `wayfare.identity.OwnerService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.OwnerServiceControllerMethods()
export class OwnerRegistrationsGrpcController implements identityGrpc.OwnerServiceController {
  constructor(private readonly registrations: OwnerRegistrationsService) {}

  submitRegistration(
    request: identityGrpc.SubmitRegistrationRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.SubmitRegistrationResponse> {
    return this.registrations.submitRegistration(request, unpackCallerContext(metadata));
  }

  listMyRegistrations(
    _request: identityGrpc.ListMyRegistrationsRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ListMyRegistrationsResponse> {
    return this.registrations.listMyRegistrations(unpackCallerContext(metadata));
  }

  withdrawRegistration(
    request: identityGrpc.WithdrawRegistrationRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.WithdrawRegistrationResponse> {
    return this.registrations.withdrawRegistration(request, unpackCallerContext(metadata));
  }

  getOwnerVerification(
    request: identityGrpc.GetOwnerVerificationRequest,
  ): Promise<identityGrpc.GetOwnerVerificationResponse> {
    return this.registrations.getOwnerVerification(request);
  }

  listVerifiedOwnerIds(
    request: identityGrpc.ListVerifiedOwnerIdsRequest,
  ): Promise<identityGrpc.ListVerifiedOwnerIdsResponse> {
    return this.registrations.listVerifiedOwnerIds(request);
  }
}
