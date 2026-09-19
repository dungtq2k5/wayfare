import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { SubmissionsService } from './submissions.service';

/** `wayfare.catalog.SubmissionService` — unpack the caller, delegate once. */
@Controller()
@catalogGrpc.SubmissionServiceControllerMethods()
export class SubmissionsGrpcController implements catalogGrpc.SubmissionServiceController {
  constructor(private readonly submissions: SubmissionsService) {}

  createSubmission(
    request: catalogGrpc.CreateSubmissionRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.CreateSubmissionResponse> {
    return this.submissions.createSubmission(request, unpackCallerContext(metadata));
  }

  listMySubmissions(
    request: catalogGrpc.ListMySubmissionsRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ListMySubmissionsResponse> {
    return this.submissions.listMySubmissions(request, unpackCallerContext(metadata));
  }

  getMySubmission(
    request: catalogGrpc.GetMySubmissionRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.GetMySubmissionResponse> {
    return this.submissions.getMySubmission(request, unpackCallerContext(metadata));
  }

  withdrawSubmission(
    request: catalogGrpc.WithdrawSubmissionRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.WithdrawSubmissionResponse> {
    return this.submissions.withdrawSubmission(request, unpackCallerContext(metadata));
  }
}
