// One valid payload per subject, for round-trip tests here and consumer tests in the services.
import { AuditAction, AuditActorType, AuditResourceType } from '../audit/vocabulary';
import { RefundReason } from '../billing/enums';
import { PlaceInactiveReason, PlaceStatus } from '../catalog/enums';
import { SessionRevokedReason } from '../identity/enums';
import { AnalyticsLevel, NarrationLanguageScope } from '../entitlements/entitlements';
import type { Entitlements } from '../entitlements/entitlements';
import { CurrencyCode } from '../money/money';
import {
  LocalizationTargetType,
  SynthesisStage,
  SynthesisTrigger,
  TranslationSource,
} from '../narration/enums';
import { NotificationType } from '../notifications/types';
import type { EVENT_DEFINITIONS } from '../events/registry';

/** Fixed UUIDv7s, so a fixture's expected aggregate id is readable. */
export const FIXTURE_IDS = {
  event: '01990000-0000-7000-8000-000000000001',
  device: '01990000-0000-7000-8000-000000000002',
  user: '01990000-0000-7000-8000-000000000003',
  place: '01990000-0000-7000-8000-000000000004',
  menuItem: '01990000-0000-7000-8000-000000000005',
  tour: '01990000-0000-7000-8000-000000000006',
  submission: '01990000-0000-7000-8000-000000000007',
  order: '01990000-0000-7000-8000-000000000008',
  offer: '01990000-0000-7000-8000-000000000009',
  voucher: '01990000-0000-7000-8000-00000000000a',
  membership: '01990000-0000-7000-8000-00000000000b',
  billingAccount: '01990000-0000-7000-8000-00000000000c',
  asset: '01990000-0000-7000-8000-00000000000d',
  family: '01990000-0000-7000-8000-00000000000e',
} as const;

const HASH = 'a'.repeat(64);
const OCCURRED_AT = '2026-09-16T12:00:00.000Z';

const growth: Entitlements = {
  maxPlaces: 10,
  autoNarration: true,
  narrationLanguageScope: NarrationLanguageScope.LAUNCH,
  maxPhotosPerPlace: 8,
  maxMenuItemsPerPlace: 200,
  discoveryBoostSlots: 1,
  aiCreditsPerDay: 10,
  analyticsLevel: AnalyticsLevel.BASIC,
  canSellVouchers: true,
  voucherCommissionBps: 1500,
};

/** A subject's fixture: a valid payload, and the aggregate id its definition must derive. */
export interface EventFixture {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly aggregateId: string;
}

type Subject = (typeof EVENT_DEFINITIONS)[number]['subject'];

function fixture(aggregateId: string, fields: Record<string, unknown>): EventFixture {
  return {
    payload: { eventId: FIXTURE_IDS.event, occurredAt: OCCURRED_AT, ...fields },
    aggregateId,
  };
}

const {
  device,
  user,
  place,
  menuItem,
  tour,
  submission,
  order,
  offer,
  voucher,
  membership,
  billingAccount,
} = FIXTURE_IDS;

/** One valid payload per declared subject. */
export const EVENT_FIXTURES: Readonly<Record<Subject, EventFixture>> = {
  'identity.device.claimed': fixture(device, { deviceId: device, userId: user }),
  'identity.device.forgotten': fixture(device, { deviceId: device }),
  'identity.user.erased': fixture(user, { userId: user }),
  'identity.user.deactivated': fixture(user, { userId: user, refundUnredeemedVouchers: true }),
  'identity.owner.verified': fixture(user, { userId: user }),
  'identity.user.locked': fixture(user, { userId: user }),
  'identity.session.revoked': fixture(user, {
    userId: user,
    familyIds: [FIXTURE_IDS.family],
    tokensValidAfter: null,
    reason: SessionRevokedReason.LOGOUT,
  }),
  'catalog.place.content_changed': fixture(place, {
    placeId: place,
    contentHash: HASH,
    langs: ['en', 'zh-Hans'],
    trigger: SynthesisTrigger.APPROVAL,
  }),
  'catalog.menu.content_changed': fixture(place, {
    placeId: place,
    menuItemIds: [menuItem],
    langs: ['en'],
  }),
  'catalog.tour.content_changed': fixture(tour, { tourId: tour, contentHash: HASH, langs: ['ja'] }),
  'catalog.place.status_changed': fixture(place, {
    placeId: place,
    from: PlaceStatus.ACTIVE,
    to: PlaceStatus.INACTIVE,
    reason: PlaceInactiveReason.ENTITLEMENT_LIMIT,
    deleted: false,
    ownerUserId: user,
  }),
  'catalog.submission.reviewed': fixture(submission, {
    submissionId: submission,
    placeId: place,
    ownerUserId: user,
    decision: 'REJECTED',
    decisionNote: 'The photos do not show the venue.',
  }),
  'narration.localization.ready': fixture(place, {
    targetType: LocalizationTargetType.PLACE,
    targetId: place,
    lang: 'en',
    sourceContentHash: HASH,
    translationSource: TranslationSource.HUMAN,
    text: { name: 'Ben Thanh Market', description: 'A market since 1914.' },
    audio: {
      assetId: FIXTURE_IDS.asset,
      objectPath: `audio/${place}/en/${HASH}.mp3`,
      sha256: 'b'.repeat(64),
      bytes: 48_000,
      durationMs: 31_000,
      voiceId: 'en-US-Neural2-F',
      sourceContentHash: HASH,
    },
  }),
  'narration.localization.failed': fixture(menuItem, {
    targetType: LocalizationTargetType.MENU_ITEM,
    targetId: menuItem,
    lang: 'ko',
    stage: SynthesisStage.TRANSLATE,
    reason: 'Provider timeout',
    final: true,
  }),
  'billing.entitlements.changed': fixture(user, {
    ownerUserId: user,
    entitlementsVersion: 2,
    entitlements: growth,
    previous: null,
  }),
  'billing.boosts.changed': fixture(place, { placeId: place, discoveryBoost: 50 }),
  'billing.subscription.payment_failed': fixture(user, {
    ownerUserId: user,
    attemptCount: 1,
    nextAttemptAt: '2026-09-19T12:00:00.000Z',
  }),
  'billing.order.paid': fixture(order, {
    orderId: order,
    ownerUserId: user,
    placeId: place,
    quantity: 3,
    amount: { amountMinor: 330, currency: CurrencyCode.USD },
  }),
  'billing.voucher.refunded': fixture(order, {
    orderId: order,
    buyerUserId: null,
    voucherIds: [voucher],
    reason: RefundReason.VENUE_UNAVAILABLE,
  }),
  'billing.voucher.moved': fixture(voucher, {
    voucherId: voucher,
    buyerUserId: user,
    offerTitle: 'Two coffees',
  }),
  'billing.staff.invited': fixture(membership, {
    membershipId: membership,
    billingAccountId: billingAccount,
    invitedEmail: 'staff@example.com',
    sellerName: 'Cafe Sai Gon',
    inviteToken: 'invite-token',
    expiresAt: '2026-09-23T12:00:00.000Z',
  }),
  'billing.offer.reviewed': fixture(offer, {
    offerId: offer,
    ownerUserId: user,
    decision: 'APPROVED',
  }),
  'billing.payout_account.action_required': fixture(user, {
    ownerUserId: user,
    requirementsDueCount: 2,
  }),
  'audit.record': fixture(device, {
    service: 'identity',
    actor: { type: AuditActorType.DEVICE, deviceId: device },
    action: AuditAction.DEVICE_REGISTERED,
    resource: { type: AuditResourceType.DEVICE, id: device },
    metadata: { after: { platform: 'ANDROID', appVersion: '0.1.0' } },
  }),
  'notification.create': fixture(user, {
    recipientUserId: user,
    notification: {
      type: NotificationType.PLACE_UNPUBLISHED,
      data: { placeId: place, reason: PlaceInactiveReason.ADMIN },
    },
  }),
};
