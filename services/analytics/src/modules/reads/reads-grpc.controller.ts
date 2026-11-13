import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { analyticsGrpc } from '@wayfare/contracts/grpc';
import { requireAccountContext, unpackCallerContext } from '@wayfare/nest-common';
import { ReadsService } from './reads.service';

/**
 * `wayfare.analytics.AnalyticsReadService` — an account's reads only (the gateway checks the
 * owner's Venues and `analytics.read`); unpack the caller, delegate once.
 */
@Controller()
@analyticsGrpc.AnalyticsReadServiceControllerMethods()
export class ReadsGrpcController implements analyticsGrpc.AnalyticsReadServiceController {
  constructor(private readonly reads: ReadsService) {}

  getPlaceDailyStats(
    request: analyticsGrpc.GetPlaceDailyStatsRequest,
    metadata?: Metadata,
  ): Promise<analyticsGrpc.GetPlaceDailyStatsResponse> {
    requireAccountContext(unpackCallerContext(metadata));
    return this.reads.placeDailyStats(request);
  }

  getOverview(
    request: analyticsGrpc.GetOverviewRequest,
    metadata?: Metadata,
  ): Promise<analyticsGrpc.GetOverviewResponse> {
    requireAccountContext(unpackCallerContext(metadata));
    return this.reads.overview(request);
  }

  getTopPlaces(
    request: analyticsGrpc.GetTopPlacesRequest,
    metadata?: Metadata,
  ): Promise<analyticsGrpc.GetTopPlacesResponse> {
    requireAccountContext(unpackCallerContext(metadata));
    return this.reads.topPlaces(request);
  }

  getHeatmap(
    request: analyticsGrpc.GetHeatmapRequest,
    metadata?: Metadata,
  ): Promise<analyticsGrpc.GetHeatmapResponse> {
    requireAccountContext(unpackCallerContext(metadata));
    return this.reads.heatmap(request);
  }

  getRuntimeActivity(
    request: analyticsGrpc.GetRuntimeActivityRequest,
    metadata?: Metadata,
  ): Promise<analyticsGrpc.GetRuntimeActivityResponse> {
    requireAccountContext(unpackCallerContext(metadata));
    return this.reads.runtimeActivity(request);
  }

  getCurrentActivity(
    request: analyticsGrpc.GetCurrentActivityRequest,
    metadata?: Metadata,
  ): Promise<analyticsGrpc.GetCurrentActivityResponse> {
    requireAccountContext(unpackCallerContext(metadata));
    return this.reads.currentActivity(request);
  }
}
