import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { OwnerReviewService } from './owner-review.service';

/** `wayfare.identity.OwnerReviewService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.OwnerReviewServiceControllerMethods()
export class OwnerReviewGrpcController implements identityGrpc.OwnerReviewServiceController {
  constructor(private readonly review: OwnerReviewService) {}

  listRegistrations(
    request: identityGrpc.ListRegistrationsRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ListRegistrationsResponse> {
    return this.review.listRegistrations(request, unpackCallerContext(metadata));
  }

  getRegistration(
    request: identityGrpc.GetRegistrationRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.GetRegistrationResponse> {
    return this.review.getRegistration(request, unpackCallerContext(metadata));
  }

  revealNationalId(
    request: identityGrpc.RevealNationalIdRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RevealNationalIdResponse> {
    return this.review.revealNationalId(request, unpackCallerContext(metadata));
  }

  approveRegistration(
    request: identityGrpc.ApproveRegistrationRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ApproveRegistrationResponse> {
    return this.review.approveRegistration(request, unpackCallerContext(metadata));
  }

  rejectRegistration(
    request: identityGrpc.RejectRegistrationRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RejectRegistrationResponse> {
    return this.review.rejectRegistration(request, unpackCallerContext(metadata));
  }
}
