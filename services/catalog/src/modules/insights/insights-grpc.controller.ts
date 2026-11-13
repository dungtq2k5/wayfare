import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { InsightsService } from './insights.service';

/** `wayfare.catalog.InsightService` — the dashboards' reads of catalog; delegate once. */
@Controller()
@catalogGrpc.InsightServiceControllerMethods()
export class InsightsGrpcController implements catalogGrpc.InsightServiceController {
  constructor(private readonly insights: InsightsService) {}

  getQrScans(request: catalogGrpc.GetQrScansRequest): Promise<catalogGrpc.GetQrScansResponse> {
    return this.insights.getQrScans(request);
  }

  nearestLivePlaces(
    request: catalogGrpc.NearestLivePlacesRequest,
  ): Promise<catalogGrpc.NearestLivePlacesResponse> {
    return this.insights.nearestLivePlaces(request);
  }
}
