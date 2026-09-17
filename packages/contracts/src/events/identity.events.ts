import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { SessionRevokedReason } from '../identity/enums';
import { MAX_FAMILIES_PER_EVENT } from '../identity/limits';
import { defineEvent, eventSchema, zEventInstant } from './event-definition';

/** `identity.device.claimed` — a signed-in user claimed an anonymous device. */
export const IDENTITY_DEVICE_CLAIMED = defineEvent({
  subject: 'identity.device.claimed',
  publisher: 'identity',
  stream: 'IDENTITY',
  schema: eventSchema({ deviceId: zUuidV7, userId: zUuidV7 }),
  aggregateId: (payload) => payload.deviceId,
});

/** `identity.device.forgotten` — a device and its data were forgotten. */
export const IDENTITY_DEVICE_FORGOTTEN = defineEvent({
  subject: 'identity.device.forgotten',
  publisher: 'identity',
  stream: 'IDENTITY',
  schema: eventSchema({ deviceId: zUuidV7 }),
  aggregateId: (payload) => payload.deviceId,
});

/** `identity.user.erased` — an account was erased (ADR 0048). */
export const IDENTITY_USER_ERASED = defineEvent({
  subject: 'identity.user.erased',
  publisher: 'identity',
  stream: 'IDENTITY',
  schema: eventSchema({ userId: zUuidV7 }),
  aggregateId: (payload) => payload.userId,
});

/** `identity.user.deactivated` — an admin deactivated an account; a seller is wound down. */
export const IDENTITY_USER_DEACTIVATED = defineEvent({
  subject: 'identity.user.deactivated',
  publisher: 'identity',
  stream: 'IDENTITY',
  schema: eventSchema({ userId: zUuidV7, refundUnredeemedVouchers: z.boolean() }),
  aggregateId: (payload) => payload.userId,
});

/** `identity.user.locked` — an account was locked; its sockets are dropped. */
export const IDENTITY_USER_LOCKED = defineEvent({
  subject: 'identity.user.locked',
  publisher: 'identity',
  stream: 'IDENTITY',
  schema: eventSchema({ userId: zUuidV7 }),
  aggregateId: (payload) => payload.userId,
});

/** `identity.owner.verified` — an owner registration was approved. */
export const IDENTITY_OWNER_VERIFIED = defineEvent({
  subject: 'identity.owner.verified',
  publisher: 'identity',
  stream: 'IDENTITY',
  schema: eventSchema({ userId: zUuidV7 }),
  aggregateId: (payload) => payload.userId,
});

/**
 * `identity.session.revoked` — sessions ended or the account's token cutoff moved (rdm-spec I-1,
 * I-3). `familyIds: null` means every family; a larger set is published as several events.
 * identity's own consumer writes it to Redis for the gateway.
 */
export const IDENTITY_SESSION_REVOKED = defineEvent({
  subject: 'identity.session.revoked',
  publisher: 'identity',
  stream: 'IDENTITY',
  schema: eventSchema({
    userId: zUuidV7,
    familyIds: z.array(zUuidV7).min(1).max(MAX_FAMILIES_PER_EVENT).nullable(),
    tokensValidAfter: zEventInstant.nullable(),
    reason: z.enum(SessionRevokedReason),
  }),
  aggregateId: (payload) => payload.userId,
});
