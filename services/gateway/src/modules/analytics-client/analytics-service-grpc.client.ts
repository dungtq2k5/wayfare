import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { analyticsGrpc } from '@wayfare/contracts/grpc';
import { GrpcServiceCaller } from '@wayfare/nest-common';
import type { AnonymousContext } from '@wayfare/nest-common';

/** Injection token for analytics' gRPC connection. */
export const ANALYTICS_GRPC = Symbol('ANALYTICS_GRPC');

/**
 * The caller every tourist write sends: anonymous, with no address and no browser (ADR 0042) — the
 * device id, the network and the user agent never reach analytics.
 */
export const ANALYTICS_CALLER: AnonymousContext = {
  kind: 'anonymous',
  origin: { ip: null, userAgent: null },
};

/**
 * analytics as the gateway calls it: one caller per stub (conventions §6.2). Returns proto types
 * only; the deadline, caller metadata and down-versus-slow mapping live in each caller.
 */
@Injectable()
export class AnalyticsServiceGrpcClient implements OnModuleInit {
  readonly events: GrpcServiceCaller<analyticsGrpc.AnalyticsServiceClient>;
  readonly reads: GrpcServiceCaller<analyticsGrpc.AnalyticsReadServiceClient>;

  constructor(@Inject(ANALYTICS_GRPC) grpc: ClientGrpc) {
    this.events = new GrpcServiceCaller(grpc, analyticsGrpc.ANALYTICS_SERVICE_NAME);
    this.reads = new GrpcServiceCaller(grpc, analyticsGrpc.ANALYTICS_READ_SERVICE_NAME);
  }

  onModuleInit(): void {
    this.events.init();
    this.reads.init();
  }
}
