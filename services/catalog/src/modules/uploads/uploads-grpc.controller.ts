import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { UploadsService } from './uploads.service';

/** `wayfare.catalog.UploadService` — unpack the caller, delegate once. */
@Controller()
@catalogGrpc.UploadServiceControllerMethods()
export class UploadsGrpcController implements catalogGrpc.UploadServiceController {
  constructor(private readonly uploads: UploadsService) {}

  createUpload(
    request: catalogGrpc.CreateUploadRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.CreateUploadResponse> {
    return this.uploads.createUpload(request, unpackCallerContext(metadata));
  }

  confirmUpload(
    request: catalogGrpc.ConfirmUploadRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ConfirmUploadResponse> {
    return this.uploads.confirmUpload(request, unpackCallerContext(metadata));
  }
}
