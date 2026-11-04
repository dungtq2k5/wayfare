import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  BOOSTS_ENDED_WINDOW_DAYS,
  BoostEndedReason,
  PlaceKind,
  PlaceStatus,
  zOwnerBoostsInput,
  zUuidV7,
} from '@wayfare/contracts';
import { boostEndedReasonProto, placeKindProto, placeStatusProto } from '@wayfare/contracts/grpc';
import type { billingGrpc, catalogGrpc } from '@wayfare/contracts/grpc';
import {
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
  toProtoTimestamp,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { BoostsLedgerService } from '../boosts-ledger/boosts-ledger.service';
import { billingAuditRecord } from '../entitlements/domain/billing-audit';
import { boostSetChange } from '../boosts-ledger/domain/boosts';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const placeField = z.object({ placeId: zUuidV7 });

/** A boost row as the reads answer it. */
const BOOST_SELECT = {
  placeId: true,
  weight: true,
  startsAt: true,
  endsAt: true,
  endedReason: true,
} as const satisfies Prisma.DiscoveryBoostSelect;
type BoostRow = Prisma.DiscoveryBoostGetPayload<{ select: typeof BOOST_SELECT }>;

/** A boost on the wire: live without an end, ended with when and why. */
export function toAccountBoost(row: BoostRow): billingGrpc.AccountBoost {
  return {
    placeId: row.placeId,
    weight: row.weight,
    since: toProtoTimestamp(row.startsAt),
    endedAt: row.endsAt === null ? undefined : toProtoTimestamp(row.endsAt),
    endedReason:
      row.endedReason === null
        ? boostEndedReasonProto.toProto(undefined)
        : boostEndedReasonProto.toProto(row.endedReason as BoostEndedReason),
  };
}

/**
 * Discovery boosts (api-endpoints-plan §5.2, rdm-spec B-5): an owner's complete set, under the
 * account's lock, each Place checked through catalog; and the reads — the owner's, an account's,
 * one Place's.
 */
@Injectable()
export class BoostsService {
  private readonly logger = new Logger(BoostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly entitlements: EntitlementsService,
    private readonly ledger: BoostsLedgerService,
    private readonly catalog: CatalogServiceGrpcClient,
  ) {}

  /** `GET /owner/boosts`: the slots, the live boosts and those ended in the window. */
  async getMyBoosts(context: RequestContext): Promise<billingGrpc.GetMyBoostsResponse> {
    const caller = requireAccountContext(context);
    const account = await this.prisma.billingAccount.findUnique({
      where: { ownerUserId: caller.userId },
      select: { id: true, discoveryBoostSlots: true },
    });
    if (account === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'BILLING_ACCOUNT' });
    return {
      slots: account.discoveryBoostSlots,
      boosts: await this.boostsOf(this.prisma, account.id, new Date()),
    };
  }

  /**
   * `PUT /owner/boosts`: the complete set. Each Place must be the caller's `ACTIVE` Venue — catalog
   * says, and a write fails closed without it — and the set no larger than the account's slots.
   * Ends what it leaves out (`OWNER`), starts what is new; an equal set changes nothing.
   */
  async setMyBoosts(
    request: billingGrpc.SetMyBoostsRequest,
    context: RequestContext,
  ): Promise<billingGrpc.SetMyBoostsResponse> {
    const caller = requireAccountContext(context);
    const { placeIds } = parseRpcRequest(zOwnerBoostsInput, request);
    // Checked before the lock: a gRPC call never runs inside a transaction (conventions §8.8).
    const places = await this.checked(placeIds);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const account = await this.entitlements.lockAccount(tx, { ownerUserId: caller.userId });
      if (account === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'BILLING_ACCOUNT' });
      for (const place of places) {
        // Not the caller's, or Editorial: as if it didn't exist.
        if (place.ownerUserId !== account.ownerUserId)
          throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
      }
      const live = await this.ledger.live(tx, account.id);
      const change = boostSetChange(live, placeIds);
      if (change.end.length + change.start.length > 0) {
        if (placeIds.length > account.discoveryBoostSlots) {
          throw rpcError('BOOST_SLOTS_EXCEEDED', { limit: account.discoveryBoostSlots });
        }
        await this.ledger.end(tx, change.end, BoostEndedReason.OWNER, now, {
          ownerUserId: account.ownerUserId,
          planName: null,
          slots: account.discoveryBoostSlots,
        });
        await this.ledger.start(tx, account.id, change.start, now);
        await this.audit(tx, caller, account.id, now, {
          before: { placeIds: live.map((row) => row.placeId) },
          after: { placeIds: [...placeIds] },
        });
      }
      return {
        slots: account.discoveryBoostSlots,
        boosts: await this.boostsOf(tx, account.id, now),
      };
    });
  }

  /** Internal: a Place's live boost for an admin's Place page, with its account and plan. */
  async getPlaceBoost(
    request: billingGrpc.GetPlaceBoostRequest,
  ): Promise<billingGrpc.GetPlaceBoostResponse> {
    const { placeId } = parseRpcRequest(placeField, request);
    const boost = await this.prisma.discoveryBoost.findFirst({
      where: { placeId, endsAt: null },
      select: {
        startsAt: true,
        billingAccount: {
          select: { id: true, discoveryBoostSlots: true, plan: { select: { code: true } } },
        },
      },
    });
    if (boost === null) return {};
    return {
      boost: {
        since: toProtoTimestamp(boost.startsAt),
        billingAccountId: boost.billingAccount.id,
        planCode: boost.billingAccount.plan.code,
        slots: boost.billingAccount.discoveryBoostSlots,
      },
    };
  }

  /** An account's boosts: live first, then those ended within the window, newest first. */
  async boostsOf(
    db: Prisma.TransactionClient,
    billingAccountId: string,
    now: Date,
  ): Promise<billingGrpc.AccountBoost[]> {
    const rows = await db.discoveryBoost.findMany({
      where: {
        billingAccountId,
        OR: [
          { endsAt: null },
          { endsAt: { gte: new Date(now.getTime() - BOOSTS_ENDED_WINDOW_DAYS * DAY_MS) } },
        ],
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      select: BOOST_SELECT,
    });
    const live = rows.filter((row) => row.endsAt === null);
    const ended = rows
      .filter((row) => row.endsAt !== null)
      .toSorted((a, b) => b.endsAt!.getTime() - a.endsAt!.getTime());
    return [...live, ...ended].map(toAccountBoost);
  }

  /** The set's Places as catalog holds them, each a live Venue; refused otherwise. */
  private async checked(placeIds: readonly string[]): Promise<catalogGrpc.PlaceSummaryRef[]> {
    let places: catalogGrpc.PlaceSummaryRef[];
    try {
      places = await this.catalog.placeSummaries(placeIds);
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : 'unknown' },
        'catalog could not check the boosted Places',
      );
      throw rpcError('UPSTREAM_UNAVAILABLE');
    }
    const byId = new Map(places.map((place) => [place.id, place]));
    return placeIds.map((placeId) => {
      const place = byId.get(placeId);
      if (place === undefined || placeKindProto.fromProto(place.kind) !== PlaceKind.VENUE) {
        throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
      }
      const status = placeStatusProto.fromProto(place.status);
      if (status !== PlaceStatus.ACTIVE) {
        throw rpcError('INVALID_STATE', { status: status ?? 'UNKNOWN' });
      }
      return place;
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    caller: AccountContext,
    billingAccountId: string,
    now: Date,
    metadata: { before: Record<string, unknown>; after: Record<string, unknown> },
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      billingAuditRecord({
        actor: { type: AuditActorType.USER, userId: caller.userId },
        action: AuditAction.BOOSTS_UPDATED,
        resource: { type: AuditResourceType.BILLING_ACCOUNT, id: billingAccountId },
        metadata,
        origin: caller.origin,
        now,
      }),
    );
  }
}
