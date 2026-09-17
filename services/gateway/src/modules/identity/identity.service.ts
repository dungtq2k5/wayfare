import { Injectable } from '@nestjs/common';
import { isGrpcServiceError, readGrpcErrorInfo, SYSTEM_ORIGIN } from '@wayfare/nest-common';
import type { TokenCutoffSource } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from './identity-service-grpc.client';

/** How long the revocation check waits for identity on a cache miss (api-endpoints-plan §12.2). */
export const CUTOFF_DEADLINE_MS = 500;

/**
 * The gateway's side of identity's internal RPCs. As a `TokenCutoffSource` it answers the
 * request-context middleware's cache misses; an unknown or erased user is `not-found`, which
 * rejects every token.
 */
@Injectable()
export class IdentityService implements TokenCutoffSource {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async getCutoff(userId: string): Promise<number | 'not-found'> {
    try {
      const response = await this.identity.auth.call(
        'getTokenCutoff',
        { userId },
        { kind: 'anonymous', origin: SYSTEM_ORIGIN },
        { deadlineMs: CUTOFF_DEADLINE_MS },
      );
      return response.tokensValidAfterMs === undefined ? 0 : Number(response.tokensValidAfterMs);
    } catch (error) {
      if (isGrpcServiceError(error) && readGrpcErrorInfo(error)?.code === 'RESOURCE_NOT_FOUND')
        return 'not-found';
      throw error;
    }
  }
}
