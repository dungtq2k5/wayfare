import { Inject, Injectable } from '@nestjs/common';
import { BILLING_ENTITLEMENTS_CHANGED, SOCKET_ROOMS } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import type { SocketEmitter } from '@wayfare/nest-common';
import { SERVICE_NAME } from '../outbox/outbox.module';

/** Injection token for billing's socket frames (conventions §7.4). */
export const SOCKET_EMITTER = Symbol('SOCKET_EMITTER');

/**
 * `billing.entitlements.changed` → `owner:entitlements` to the owner's room (api-endpoints-plan §9):
 * one hook after every committed grant change, whichever path wrote it — a webhook, an `apply`, an
 * override, an account opening. A frame is only the fast path; the limits page reads the record.
 * Durable `billing-billing-entitlements-changed`.
 */
@Injectable()
export class EntitlementsChangedConsumer extends JetStreamConsumer<
  typeof BILLING_ENTITLEMENTS_CHANGED
> {
  readonly event = BILLING_ENTITLEMENTS_CHANGED;
  readonly service: string = SERVICE_NAME;

  constructor(@Inject(SOCKET_EMITTER) private readonly frames: Pick<SocketEmitter, 'toRoom'>) {
    super();
  }

  handle(payload: EventPayload<typeof BILLING_ENTITLEMENTS_CHANGED>): Promise<void> {
    this.frames.toRoom(SOCKET_ROOMS.owner(payload.ownerUserId), 'ownerEntitlements', {
      entitlementsVersion: payload.entitlementsVersion,
      entitlements: payload.entitlements,
    });
    return Promise.resolve();
  }
}
