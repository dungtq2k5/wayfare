import { z } from 'zod';
import { PlaceInactiveReason, PlaceStatus } from '../catalog/enums';
import { zUuidV7 } from '../common/ids';
import { zLanguage } from '../common/languages';
import { zEntitlements } from '../entitlements/entitlements';
import { ERRORS } from '../errors/registry';
import type { ErrorCode } from '../errors/registry';
import { PAGE_SIZE_MAX } from '../limits/rate-limits';
import {
  LocalizationTargetType,
  SynthesisJobStatus,
  SynthesisStage,
  SynthesisTaskStatus,
} from '../narration/enums';
import { NotificationType } from '../notifications/types';

/** The `/ws` event names (api-endpoints-plan §9). */
export const SOCKET_EVENTS = {
  /** Server → client. Wait for it before emitting anything. */
  connectionReady: 'connection:ready',
  jobSubscribe: 'job:subscribe',
  jobUnsubscribe: 'job:unsubscribe',
  jobSubscribed: 'job:subscribed',
  narrationJobStatus: 'narration:job:status',
  narrationTaskProgress: 'narration:task:progress',
  notificationNew: 'notification:new',
  notificationUnreadCount: 'notification:unread-count',
  notificationRead: 'notification:read',
  ownerPlaceStatus: 'owner:place:status',
  ownerEntitlements: 'owner:entitlements',
  error: 'error',
} as const;

/** A socket event key. */
export type SocketEventKey = keyof typeof SOCKET_EVENTS;

/** A socket event's wire name. */
export type SocketEventName = (typeof SOCKET_EVENTS)[SocketEventKey];

/** Room names, joined by the server only — never named by a client (api-endpoints-plan §9). */
export const SOCKET_ROOMS = {
  user: (userId: string) => `user:${userId}`,
  adminNarration: 'admin:narration',
  job: (jobId: string) => `job:${jobId}`,
  owner: (userId: string) => `owner:${userId}`,
} as const;

const count = z.number().int().min(0);
const jobRef = z.object({ jobId: zUuidV7 }).strict();
const errorCodes = Object.keys(ERRORS) as [ErrorCode, ...ErrorCode[]];

/** Each event's payload (api-endpoints-plan §9). */
export const SOCKET_PAYLOADS = {
  connectionReady: z.object({}).strict(),
  jobSubscribe: jobRef,
  jobUnsubscribe: jobRef,
  jobSubscribed: jobRef,
  narrationJobStatus: z
    .object({
      jobId: zUuidV7,
      targetType: z.enum(LocalizationTargetType),
      targetId: zUuidV7,
      status: z.enum(SynthesisJobStatus),
      completedTasks: count,
      failedTasks: count,
      totalTasks: count,
    })
    .strict(),
  narrationTaskProgress: z
    .object({
      jobId: zUuidV7,
      lang: zLanguage,
      stage: z.enum(SynthesisStage),
      status: z.enum(SynthesisTaskStatus),
    })
    .strict(),
  notificationNew: z
    .object({
      id: zUuidV7,
      type: z.enum(NotificationType),
      data: z.record(z.string(), z.unknown()),
      createdAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
  notificationUnreadCount: z.object({ count }).strict(),
  // One read names its row; a read-all can clear more rows than a frame lists, so it says `all`.
  notificationRead: z.union([
    z.object({ ids: z.array(zUuidV7).min(1).max(PAGE_SIZE_MAX) }).strict(),
    z.object({ all: z.literal(true) }).strict(),
  ]),
  ownerPlaceStatus: z
    .object({
      placeId: zUuidV7,
      status: z.enum(PlaceStatus),
      inactiveReason: z.enum(PlaceInactiveReason).nullable(),
    })
    .strict(),
  ownerEntitlements: z
    .object({ entitlementsVersion: z.number().int().min(1), entitlements: zEntitlements })
    .strict(),
  error: z.object({ code: z.enum(errorCodes) }).strict(),
} as const satisfies Record<SocketEventKey, z.ZodType>;

/** One event's payload. */
export type SocketPayload<K extends SocketEventKey> = z.output<(typeof SOCKET_PAYLOADS)[K]>;
