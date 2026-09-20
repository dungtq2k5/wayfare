import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { narrationGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { CorrectionsService } from './corrections.service';

/** `wayfare.narration.CorrectionService` — unpack the caller, delegate once. */
@Controller()
@narrationGrpc.CorrectionServiceControllerMethods()
export class CorrectionsGrpcController implements narrationGrpc.CorrectionServiceController {
  constructor(private readonly corrections: CorrectionsService) {}

  getLocalizationOverview(
    request: narrationGrpc.GetLocalizationOverviewRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.GetLocalizationOverviewResponse> {
    return this.corrections.getLocalizationOverview(request, unpackCallerContext(metadata));
  }

  putCorrection(
    request: narrationGrpc.PutCorrectionRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.PutCorrectionResponse> {
    return this.corrections.putCorrection(request, unpackCallerContext(metadata));
  }

  revertCorrection(
    request: narrationGrpc.RevertCorrectionRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.RevertCorrectionResponse> {
    return this.corrections.revertCorrection(request, unpackCallerContext(metadata));
  }
}
