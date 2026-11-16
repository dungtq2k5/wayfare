import { Injectable } from '@nestjs/common';
import {
  BILLING_BOOST_ENDED,
  BILLING_BOOSTS_CHANGED,
  BoostEndedReason,
  DISCOVERY_BOOST_WEIGHT,
} from '@wayfare/contracts';
import type { PlaceInactiveReason } from '@wayfare/contracts';
import { OutboxService } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import { boostsOverSlots } from './domain/boosts';
import type { LiveBoostRow } from './domain/boosts';

/** Why a Venue stopped being live, for a `PLACE_UNAVAILABLE` end. */
export interface PlaceGone {
  readonly placeInactiveReason: PlaceInactiveReason | null;
  readonly deleted: boolean;
}

/**
 * An account's boost rows (rdm-spec B-5), written only here: each start or end writes the narrow
 * `billing.boosts.changed` catalog applies, and a system end also `billing.boost.ended`, whom
 * identity tells. Every method runs in the caller's transaction, on an account it has locked.
 */
@Injectable()
export class BoostsLedgerService {
  constructor(private readonly outbox: OutboxService) {}

  /** The account's live boosts. */
  live(tx: Prisma.TransactionClient, billingAccountId: string): Promise<LiveBoostRow[]> {
    return tx.discoveryBoost.findMany({
      where: { billingAccountId, endsAt: null },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: { id: true, placeId: true, startsAt: true },
    });
  }

  /** Starts a boost on each Place, at `DISCOVERY_BOOST_WEIGHT`. */
  async start(
    tx: Prisma.TransactionClient,
    billingAccountId: string,
    placeIds: readonly string[],
    now: Date,
  ): Promise<void> {
    for (const placeId of placeIds) {
      await tx.discoveryBoost.create({
        data: { billingAccountId, placeId, weight: DISCOVERY_BOOST_WEIGHT, startsAt: now },
        select: { id: true },
      });
      await this.outbox.add(tx, BILLING_BOOSTS_CHANGED, {
        occurredAt: now.toISOString(),
        placeId,
        discoveryBoost: DISCOVERY_BOOST_WEIGHT,
        changedAt: now.toISOString(),
      });
    }
  }

  /**
   * Ends boosts. The owner's own ending writes only the weight's change; a system end also says
   * why, to the owner (`billing.boost.ended`).
   */
  async end(
    tx: Prisma.TransactionClient,
    rows: readonly LiveBoostRow[],
    reason: BoostEndedReason,
    now: Date,
    told: {
      readonly ownerUserId: string;
      readonly planName: string | null;
      readonly slots: number;
      readonly place?: PlaceGone;
    },
  ): Promise<number> {
    let ended = 0;
    for (const row of rows) {
      const { count } = await tx.discoveryBoost.updateMany({
        where: { id: row.id, endsAt: null },
        data: { endsAt: now, endedReason: reason },
      });
      if (count === 0) continue;
      ended += 1;
      await this.outbox.add(tx, BILLING_BOOSTS_CHANGED, {
        occurredAt: now.toISOString(),
        placeId: row.placeId,
        discoveryBoost: 0,
        changedAt: now.toISOString(),
      });
      if (reason === BoostEndedReason.OWNER) continue;
      await this.outbox.add(tx, BILLING_BOOST_ENDED, {
        occurredAt: now.toISOString(),
        ownerUserId: told.ownerUserId,
        placeId: row.placeId,
        reason,
        placeInactiveReason: told.place?.placeInactiveReason ?? null,
        deleted: told.place?.deleted ?? false,
        planName: reason === BoostEndedReason.ENTITLEMENT_LIMIT ? told.planName : null,
        slots: told.slots,
        endedAt: now.toISOString(),
      });
    }
    return ended;
  }

  /**
   * K3's one rule: when an account's slots fall below its live boosts, the newest end
   * (`ENTITLEMENT_LIMIT`). Called wherever grants are written; returns how many ended.
   */
  async endOverSlots(
    tx: Prisma.TransactionClient,
    account: { readonly id: string; readonly ownerUserId: string },
    slots: number,
    now: Date,
  ): Promise<number> {
    const over = boostsOverSlots(await this.live(tx, account.id), slots);
    if (over.length === 0) return 0;
    // The plan as this transaction left it: a re-derive moves `plan_id` before writing the grants.
    const { plan } = await tx.billingAccount.findUniqueOrThrow({
      where: { id: account.id },
      select: { plan: { select: { name: true } } },
    });
    return this.end(tx, over, BoostEndedReason.ENTITLEMENT_LIMIT, now, {
      ownerUserId: account.ownerUserId,
      planName: plan.name,
      slots,
    });
  }

  /** How many boosts would end at `slots` — the apply dry run's count, by the same rule. */
  async wouldEnd(
    db: Prisma.TransactionClient,
    billingAccountId: string,
    slots: number,
  ): Promise<number> {
    return boostsOverSlots(await this.live(db, billingAccountId), slots).length;
  }
}
