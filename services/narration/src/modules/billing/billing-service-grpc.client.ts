import { status } from '@grpc/grpc-js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { scopeCoversLanguage } from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';
import { billingGrpc, narrationLanguageScopeProto } from '@wayfare/contracts/grpc';
import { GrpcServiceCaller, isGrpcServiceError, SYSTEM_ORIGIN } from '@wayfare/nest-common';

/** Whether a Venue's owner's plan covers a language — or billing couldn't say. */
export type VenueLanguage = 'ENTITLED' | 'NOT_ENTITLED' | 'UNAVAILABLE';

/** Injection token for billing's gRPC connection. */
export const BILLING_GRPC = Symbol('BILLING_GRPC');

/**
 * billing as narration calls it (api-endpoints-plan §12.2): an owner's entitlements, for a Venue's
 * on-demand language check. Called with a system context; returns proto types only, and the caller
 * decides what a failure means — it fails closed.
 */
@Injectable()
export class BillingServiceGrpcClient implements OnModuleInit {
  private readonly logger = new Logger(BillingServiceGrpcClient.name);
  readonly entitlements: GrpcServiceCaller<billingGrpc.EntitlementServiceClient>;

  constructor(@Inject(BILLING_GRPC) grpc: ClientGrpc) {
    this.entitlements = new GrpcServiceCaller(grpc, billingGrpc.ENTITLEMENT_SERVICE_NAME);
  }

  onModuleInit(): void {
    this.entitlements.init();
  }

  /**
   * A Venue's languages are its owner's plan's (api-endpoints-plan §12.2): an owner with no billing
   * account is not entitled; a billing that cannot answer is `UNAVAILABLE` — a grant is never
   * assumed, so every caller fails closed.
   */
  async venueLanguage(ownerUserId: string | null, lang: Language): Promise<VenueLanguage> {
    if (ownerUserId === null) return 'NOT_ENTITLED';
    let answer: billingGrpc.GetEntitlementsResponse;
    try {
      answer = await this.getEntitlements(ownerUserId);
    } catch (error) {
      if (isGrpcServiceError(error) && error.code === status.NOT_FOUND) return 'NOT_ENTITLED';
      this.logger.warn(
        { ownerUserId, kind: error instanceof Error ? error.name : 'unknown' },
        'billing did not answer the entitlements',
      );
      return 'UNAVAILABLE';
    }
    const scope = narrationLanguageScopeProto.fromProto(
      answer.entitlements?.narrationLanguageScope,
    );
    return scope !== null && scopeCoversLanguage(scope, lang) ? 'ENTITLED' : 'NOT_ENTITLED';
  }

  getEntitlements(ownerUserId: string): Promise<billingGrpc.GetEntitlementsResponse> {
    return this.entitlements.call(
      'getEntitlements',
      { ownerUserId },
      { kind: 'anonymous', origin: SYSTEM_ORIGIN },
    );
  }
}
