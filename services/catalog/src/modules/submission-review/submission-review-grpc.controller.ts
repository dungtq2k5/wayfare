import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { SubmissionReviewService } from './submission-review.service';

/** `wayfare.catalog.SubmissionReviewService` — unpack the caller, delegate once. */
@Controller()
@catalogGrpc.SubmissionReviewServiceControllerMethods()
export class SubmissionReviewGrpcController
  implements catalogGrpc.SubmissionReviewServiceController
{
  constructor(private readonly review: SubmissionReviewService) {}

  listSubmissions(
    request: catalogGrpc.ListSubmissionsRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ListSubmissionsResponse> {
    return this.review.listSubmissions(request, unpackCallerContext(metadata));
  }

  getSubmission(
    request: catalogGrpc.GetSubmissionRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.GetSubmissionResponse> {
    return this.review.getSubmission(request, unpackCallerContext(metadata));
  }

  approveSubmission(
    request: catalogGrpc.ApproveSubmissionRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ApproveSubmissionResponse> {
    return this.review.approveSubmission(request, unpackCallerContext(metadata));
  }

  rejectSubmission(
    request: catalogGrpc.RejectSubmissionRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.RejectSubmissionResponse> {
    return this.review.rejectSubmission(request, unpackCallerContext(metadata));
  }
}
