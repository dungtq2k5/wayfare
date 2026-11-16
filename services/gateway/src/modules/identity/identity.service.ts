import { Injectable } from '@nestjs/common';
import { isGrpcServiceError, readGrpcErrorInfo, SYSTEM_ORIGIN } from '@wayfare/nest-common';
import type { AccountContext, TokenCutoffSource } from '@wayfare/nest-common';
import type { z } from 'zod';
import type { ownerContactSchema } from './dto/owner-contact.dto';
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

  /** A Venue owner's contact; identity not answering leaves a page without the name, never failing it. */
  async ownerContact(
    context: AccountContext,
    userId: string | null,
  ): Promise<z.infer<typeof ownerContactSchema>> {
    if (userId === null) return null;
    try {
      const contact = await this.identity.owner.call('getOwnerContact', { userId }, context);
      return contact.email == null
        ? null
        : { name: contact.fullName ?? null, email: contact.email };
    } catch {
      return null;
    }
  }
}
