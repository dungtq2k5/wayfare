import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { LocalizationSourcesService } from './localization-sources.service';

/** `wayfare.catalog.PlaceService` — internal; unpack the caller, delegate once. */
@Controller()
@catalogGrpc.PlaceServiceControllerMethods()
export class LocalizationSourcesGrpcController implements catalogGrpc.PlaceServiceController {
  constructor(private readonly sources: LocalizationSourcesService) {}

  getLocalizationSource(
    request: catalogGrpc.GetLocalizationSourceRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.GetLocalizationSourceResponse> {
    return this.sources.getLocalizationSource(request, unpackCallerContext(metadata));
  }
}
