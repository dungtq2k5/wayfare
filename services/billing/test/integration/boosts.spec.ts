// Discovery boosts (api-endpoints-plan §5.2, rdm-spec B-5): an owner's complete set under the
// account's lock, each Place checked through catalog; a boost ended by fewer slots (newest first)
// or by its Venue leaving; the events catalog and identity read; the account lock's strength.
import {
  AUDIT_RECORD,
  AuditAction,
  BILLING_BOOST_ENDED,
  BILLING_BOOSTS_CHANGED,
  BoostEndedReason,
  CATALOG_PLACE_STATUS_CHANGED,
  compareStrings,
  DISCOVERY_BOOST_WEIGHT,
  EntitlementsChangeCause,
  newId,
  PlaceInactiveReason,
  PlaceKind,
  PlaceStatus,
  SubscriptionStatus,
} from '@wayfare/contracts';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { outboxPayloads, testPrisma, truncateAll } from '../setup/database';
import { errorOf, GROWTH_GRANTS, owner, paidPlan } from '../setup/fixtures';
import { billingServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof billingServices>;
const admin = buildAccountContext();

beforeEach(async () => {
  await truncateAll(prisma);
  services = billingServices(prisma);
});
afterAll(() => prisma.$disconnect());

/** An owner with `slots` boost slots, and `venues` live Venues of theirs. */
async function boostingOwner(slots: number, venues: number) {
  const account = await owner(services, prisma);
  await prisma.billingAccount.update({
    where: { id: account.accountId },
    data: { discoveryBoostSlots: slots },
  });
  const placeIds = Array.from({ length: venues }, () =>
    services.catalog.venue(account.ownerUserId),
  );
  return { ...account, placeIds };
}

const live = (accountId: string) =>
  prisma.discoveryBoost.findMany({
    where: { billingAccountId: accountId, endsAt: null },
    orderBy: { startsAt: 'asc' },
  });

/** Boosts started one after another, so "newest" is well defined. */
async function boostOneByOne(
  account: Awaited<ReturnType<typeof boostingOwner>>,
  placeIds: string[],
): Promise<void> {
  for (let i = 1; i <= placeIds.length; i++) {
    await services.boosts.setMyBoosts({ placeIds: placeIds.slice(0, i) }, account.context);
    await new Promise((done) => setTimeout(done, 5));
  }
}

describe('PUT /owner/boosts', () => {
  it('applies the complete set: ends what it leaves out, starts what is new', async () => {
    const account = await boostingOwner(2, 3);
    const [a, b, c] = account.placeIds as [string, string, string];
    await services.boosts.setMyBoosts({ placeIds: [a, b] }, account.context);
    const answer = await services.boosts.setMyBoosts({ placeIds: [b, c] }, account.context);

    expect(answer.slots).toBe(2);
    expect(
      (await live(account.accountId)).map((row) => row.placeId).toSorted(compareStrings),
    ).toEqual([b, c].toSorted(compareStrings));
    const ended = await prisma.discoveryBoost.findFirstOrThrow({ where: { placeId: a } });
    expect(ended.endedReason).toBe(BoostEndedReason.OWNER);
    // One weight change per start and per end; no ended event for the owner's own ending.
    const changes = await outboxPayloads(prisma, BILLING_BOOSTS_CHANGED.subject);
    expect(changes.map((change) => [change.placeId, change.discoveryBoost])).toEqual([
      [a, DISCOVERY_BOOST_WEIGHT],
      [b, DISCOVERY_BOOST_WEIGHT],
      [a, 0],
      [c, DISCOVERY_BOOST_WEIGHT],
    ]);
    expect(await outboxPayloads(prisma, BILLING_BOOST_ENDED.subject)).toEqual([]);
    const audits = (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter(
      (row) => row.action === AuditAction.BOOSTS_UPDATED,
    );
    expect(audits).toHaveLength(2);
    expect(audits[1]!.metadata).toEqual({
      before: { placeIds: [a, b] },
      after: { placeIds: [b, c] },
    });
  });

  it('changes nothing for the set already live', async () => {
    const account = await boostingOwner(2, 2);
    await services.boosts.setMyBoosts({ placeIds: account.placeIds }, account.context);
    const events = (await outboxPayloads(prisma, BILLING_BOOSTS_CHANGED.subject)).length;
    await services.boosts.setMyBoosts({ placeIds: account.placeIds.toReversed() }, account.context);
    expect((await outboxPayloads(prisma, BILLING_BOOSTS_CHANGED.subject)).length).toBe(events);
  });

  it('refuses more than the slots, with the limit', async () => {
    const account = await boostingOwner(1, 2);
    const error = await errorOf(
      services.boosts.setMyBoosts({ placeIds: account.placeIds }, account.context),
    );
    expect(error).toEqual({ code: 'BOOST_SLOTS_EXCEEDED', details: { limit: 1 } });
    expect(await live(account.accountId)).toEqual([]);
  });

  it("refuses a Venue that isn't the caller's, isn't live, or is Editorial", async () => {
    const account = await boostingOwner(3, 0);
    const someoneElses = services.catalog.venue(newId());
    const closed = services.catalog.venue(account.ownerUserId, { status: PlaceStatus.INACTIVE });
    const editorial = services.catalog.venue(null, { kind: PlaceKind.EDITORIAL });
    const unknown = newId();
    const set = (placeId: string) =>
      errorOf(services.boosts.setMyBoosts({ placeIds: [placeId] }, account.context));
    expect((await set(someoneElses)).code).toBe('RESOURCE_NOT_FOUND');
    expect((await set(editorial)).code).toBe('RESOURCE_NOT_FOUND');
    expect((await set(unknown)).code).toBe('RESOURCE_NOT_FOUND');
    expect(await set(closed)).toEqual({
      code: 'INVALID_STATE',
      details: { status: PlaceStatus.INACTIVE },
    });
  });

  it('fails closed when catalog cannot check the Places', async () => {
    const account = await boostingOwner(1, 1);
    services.catalog.down = true;
    expect(
      (await errorOf(services.boosts.setMyBoosts({ placeIds: account.placeIds }, account.context)))
        .code,
    ).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('two sets at once never exceed the slots', async () => {
    const account = await boostingOwner(1, 2);
    const [a, b] = account.placeIds as [string, string];
    await Promise.allSettled([
      services.boosts.setMyBoosts({ placeIds: [a] }, account.context),
      services.boosts.setMyBoosts({ placeIds: [b] }, account.context),
    ]);
    expect(await live(account.accountId)).toHaveLength(1);
  });

  it('reads the slots, the live boosts and the ended ones', async () => {
    const account = await boostingOwner(2, 2);
    const [a, b] = account.placeIds as [string, string];
    await services.boosts.setMyBoosts({ placeIds: [a] }, account.context);
    await services.boosts.setMyBoosts({ placeIds: [b] }, account.context);
    const read = await services.boosts.getMyBoosts(account.context);
    expect(read.slots).toBe(2);
    expect(read.boosts.map((boost) => [boost.placeId, boost.endedReason])).toEqual([
      [b, billingGrpc.BoostEndedReason.BOOST_ENDED_REASON_UNSPECIFIED],
      [a, billingGrpc.BoostEndedReason.BOOST_ENDED_REASON_OWNER],
    ]);
    // An ended boost past the window is no longer read.
    await prisma.discoveryBoost.updateMany({
      where: { placeId: a },
      data: { endsAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
    });
    expect((await services.boosts.getMyBoosts(account.context)).boosts).toHaveLength(1);
  });
});

describe('a boost ended by itself', () => {
  it('fewer slots end the newest first (ENTITLEMENT_LIMIT), and say so', async () => {
    const account = await boostingOwner(3, 3);
    await boostOneByOne(account, account.placeIds);
    const [a, b, c] = account.placeIds as [string, string, string];

    await prisma.$transaction(async (tx) => {
      const locked = await services.entitlements.lockAccount(tx, { id: account.accountId });
      await services.entitlements.writeGrants(
        tx,
        locked!,
        { ...GROWTH_GRANTS, discoveryBoostSlots: 1 },
        new Date(),
        { cause: EntitlementsChangeCause.OVERRIDE },
      );
    });

    expect((await live(account.accountId)).map((row) => row.placeId)).toEqual([a]);
    const ended = await outboxPayloads(prisma, BILLING_BOOST_ENDED.subject);
    expect(ended.map((event) => event.placeId)).toEqual([c, b]);
    expect(ended[0]).toMatchObject({
      ownerUserId: account.ownerUserId,
      reason: BoostEndedReason.ENTITLEMENT_LIMIT,
      planName: 'Free',
      slots: 1,
      placeInactiveReason: null,
      deleted: false,
    });
  });

  it("apply's dry run counts the boosts it would end, by the same rule", async () => {
    const growth = await paidPlan(prisma, 'GROWTH');
    const account = await boostingOwner(3, 3);
    await prisma.billingAccount.update({
      where: { id: account.accountId },
      data: {
        planId: growth.planId,
        planPriceId: growth.priceId,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      },
    });
    await boostOneByOne(account, account.placeIds);
    await services.plans.updatePlan(
      {
        planId: growth.planId,
        grants: {
          ...GROWTH_GRANTS,
          narrationLanguageScope:
            billingGrpc.NarrationLanguageScope.NARRATION_LANGUAGE_SCOPE_LAUNCH,
          analyticsLevel: billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_BASIC,
          voucherCommissionBps: 1500,
          discoveryBoostSlots: 1,
        },
      },
      admin,
    );
    const dry = await services.plans.applyPlan({ planId: growth.planId, dryRun: true }, admin);
    expect(dry.wouldEndBoosts).toBe(2);
    await services.plans.applyPlan({ planId: growth.planId, dryRun: false }, admin);
    expect(await live(account.accountId)).toHaveLength(1);
  });

  it('a Venue leaving ends its boost (PLACE_UNAVAILABLE), once', async () => {
    const account = await boostingOwner(2, 2);
    const [closed, kept] = account.placeIds as [string, string];
    await services.boosts.setMyBoosts({ placeIds: account.placeIds }, account.context);
    const payload = CATALOG_PLACE_STATUS_CHANGED.schema.parse({
      eventId: newId(),
      occurredAt: new Date().toISOString(),
      placeId: closed,
      from: PlaceStatus.ACTIVE,
      to: PlaceStatus.INACTIVE,
      reason: PlaceInactiveReason.OWNER,
      deleted: false,
      ownerUserId: account.ownerUserId,
      firstPublication: false,
    });
    await services.placeStatus.handle(payload);
    await services.placeStatus.handle({ ...payload, eventId: newId() });

    expect((await live(account.accountId)).map((row) => row.placeId)).toEqual([kept]);
    expect(await outboxPayloads(prisma, BILLING_BOOST_ENDED.subject)).toEqual([
      expect.objectContaining({
        placeId: closed,
        reason: BoostEndedReason.PLACE_UNAVAILABLE,
        placeInactiveReason: PlaceInactiveReason.OWNER,
        deleted: false,
        planName: null,
      }),
    ]);
  });
});

describe("an account's lock", () => {
  it('takes NO KEY UPDATE: a boost row written twice beside another account write commits', async () => {
    const account = await boostingOwner(2, 1);
    await services.boosts.setMyBoosts({ placeIds: account.placeIds }, account.context);
    const boostId = (await live(account.accountId))[0]!.id;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    // One transaction updates a boost twice — `KEY SHARE` on the account — and waits.
    const child = prisma.$transaction(async (tx) => {
      await tx.discoveryBoost.update({ where: { id: boostId }, data: { weight: 49 } });
      await tx.discoveryBoost.update({ where: { id: boostId }, data: { weight: 50 } });
      await held;
    });
    // Another locks the account meanwhile: `FOR UPDATE` would wait for the child; this doesn't.
    await prisma.$transaction(async (tx) => {
      await services.entitlements.lockAccount(tx, { id: account.accountId });
    });
    release();
    await child;
  });
});

describe("an admin's reads", () => {
  it("an account's boosts, and a Place's live boost with its account and plan", async () => {
    const account = await boostingOwner(1, 1);
    const [placeId] = account.placeIds as [string];
    await services.boosts.setMyBoosts({ placeIds: [placeId] }, account.context);
    const detail = await services.accounts.getAccount(
      { billingAccountId: account.accountId },
      admin,
    );
    expect(detail.account!.boosts).toEqual([
      expect.objectContaining({ placeId, weight: DISCOVERY_BOOST_WEIGHT }),
    ]);
    const boost = await services.boosts.getPlaceBoost({ placeId });
    expect(boost.boost).toMatchObject({ billingAccountId: account.accountId, slots: 1 });
    expect((await services.boosts.getPlaceBoost({ placeId: newId() })).boost).toBeUndefined();
  });
});
