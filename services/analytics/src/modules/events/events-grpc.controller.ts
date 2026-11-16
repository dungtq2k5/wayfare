import { Controller } from '@nestjs/common';
import { analyticsGrpc, consentStateProto } from '@wayfare/contracts/grpc';
import { requireProtoEnum } from '@wayfare/nest-common';
import { EventsService } from './events.service';

/**
 * `wayfare.analytics.AnalyticsService` — the tourist's two writes. The caller is anonymous on
 * purpose (ADR 0042): nothing here reads the caller's metadata.
 */
@Controller()
@analyticsGrpc.AnalyticsServiceControllerMethods()
export class EventsGrpcController implements analyticsGrpc.AnalyticsServiceController {
  constructor(private readonly events: EventsService) {}

  async recordConsent(
    request: analyticsGrpc.RecordConsentRequest,
  ): Promise<analyticsGrpc.RecordConsentResponse> {
    await this.events.recordConsent({
      analyticsDeviceId: request.analyticsDeviceId,
      state: requireProtoEnum(consentStateProto, request.state, '/state'),
      policyVersion: request.policyVersion,
    });
    return {};
  }

  ingestEvents(
    request: analyticsGrpc.IngestEventsRequest,
  ): Promise<analyticsGrpc.IngestEventsResponse> {
    return this.events.ingest(request);
  }
}
