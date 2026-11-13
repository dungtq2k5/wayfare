import { Injectable, Logger } from '@nestjs/common';
import { rpcError, SYSTEM_ORIGIN } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from './identity-service-grpc.client';

/** What identity says of an owner now (api-endpoints-plan §12.2). */
export interface OwnerVerification {
  readonly verified: boolean;
  /** Neither deactivated nor erased. */
  readonly live: boolean;
}

/**
 * identity, as catalog sees it (api-endpoints-plan §12.2). Read at the moment of deciding, and fail
 * closed: an unreachable identity refuses the approval rather than writing an owner unchecked.
 */
@Injectable()
export class IdentityPortService {
  private readonly logger = new Logger(IdentityPortService.name);

  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  /** Whether an owner is still verified and live. Throws `UPSTREAM_UNAVAILABLE` when identity cannot say. */
  async getOwnerVerification(userId: string): Promise<OwnerVerification> {
    try {
      const answer = await this.identity.owners.call(
        'getOwnerVerification',
        { userId },
        { kind: 'anonymous', origin: SYSTEM_ORIGIN },
      );
      return { verified: answer.verified, live: answer.live };
    } catch (error) {
      this.logger.warn(
        { userId, kind: error instanceof Error ? error.name : 'unknown' },
        'identity did not answer the owner verification',
      );
      throw rpcError('UPSTREAM_UNAVAILABLE');
    }
  }
}
