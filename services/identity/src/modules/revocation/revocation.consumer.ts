import { Inject, Injectable } from '@nestjs/common';
import { IDENTITY_SESSION_REVOKED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import {
  JetStreamConsumer,
  raiseTokenCutoff,
  REVOKED_FAMILY_TTL_MS,
  revokedFamilyKey,
  TOKEN_CUTOFF_TTL_MS,
} from '@wayfare/nest-common';
import type { Redis } from 'ioredis';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { REDIS } from '../redis/redis.module';

/** TTLs, overridable so an integration test can watch a marker expire. */
export const REVOCATION_TTLS = Symbol('REVOCATION_TTLS');

/** How long the consumer's Redis keys live. */
export interface RevocationTtls {
  readonly cutoffMs: number;
  readonly familyMs: number;
}

/** The production TTLs (api-endpoints-plan §0.1). */
export const DEFAULT_REVOCATION_TTLS: RevocationTtls = {
  cutoffMs: TOKEN_CUTOFF_TTL_MS,
  familyMs: REVOKED_FAMILY_TTL_MS,
};

/**
 * Consumes identity's own `identity.session.revoked` into the Redis state the gateway reads
 * (api-endpoints-plan §0.1). **Idempotent by construction, with no `processed_events` row:** the
 * cutoff write only ever raises the stored value, and a family marker is set to a constant — a
 * redelivery, in any order, leaves the same state.
 */
@Injectable()
export class RevocationConsumer extends JetStreamConsumer<typeof IDENTITY_SESSION_REVOKED> {
  readonly event = IDENTITY_SESSION_REVOKED;
  readonly service: string = SERVICE_NAME;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(REVOCATION_TTLS) private readonly ttls: RevocationTtls,
  ) {
    super();
  }

  async handle(payload: EventPayload<typeof IDENTITY_SESSION_REVOKED>): Promise<void> {
    if (payload.tokensValidAfter !== null) {
      await raiseTokenCutoff(
        this.redis,
        payload.userId,
        new Date(payload.tokensValidAfter).getTime(),
        this.ttls.cutoffMs,
      );
    }
    for (const familyId of payload.familyIds ?? []) {
      await this.redis.set(revokedFamilyKey(familyId), '1', 'PX', this.ttls.familyMs);
    }
  }
}
