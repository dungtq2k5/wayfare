import { Injectable } from '@nestjs/common';
import type {
  BillingAccountDetail,
  BillingAccountSummary,
  BillingEvent,
  UnpinPreview,
} from '@wayfare/contracts';
import { billingEventStatusProto, subscriptionStatusProto } from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import type { AccountContext } from '@wayfare/nest-common';
import { Paged, toPageMetaOrThrow } from '@wayfare/nest-common';
import { toEntitlements } from '../admin-plans/admin-plan.mapper';
import { BillingServiceGrpcClient } from '../billing/billing-service-grpc.client';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { PeopleNamesService } from '../people-names/people-names.service';
import type { OwnerOf } from '../people-names/people-names.service';
import {
  toBillingAccountDetail,
  toBillingAccountSummary,
  toBillingEvent,
  toUnpinPreview,
} from './admin-billing.mapper';
import type {
  BillingAccountsQueryDto,
  BillingEventsQueryDto,
  OverrideEntitlementsDto,
  UnpinDto,
} from './dto/admin-billing.dto';

/**
 * `/admin/billing` accounts and events, backed by billing's admin services, each owner named from
 * identity in one call per page (K5: always shown, the account being theirs).
 */
@Injectable()
export class AdminBillingService {
  constructor(
    private readonly billing: BillingServiceGrpcClient,
    private readonly people: PeopleNamesService,
    private readonly catalog: CatalogServiceGrpcClient,
  ) {}

  /**
   * The boosted Venues' names, from catalog: billing knows ids only. A billing admin may hold no
   * `place.read`, so the page can't look them up itself. Empty when catalog doesn't answer.
   */
  private async placeNames(
    context: AccountContext,
    account: billingGrpc.BillingAccountDetail | undefined,
  ): Promise<Map<string, string>> {
    const placeIds = [...new Set((account?.boosts ?? []).map((boost) => boost.placeId))];
    if (placeIds.length === 0) return new Map();
    try {
      const { places } = await this.catalog.places.call(
        'batchGetPlaceSummaries',
        { placeIds },
        context,
      );
      return new Map(places.map((place) => [place.id, place.nameVi]));
    } catch {
      return new Map();
    }
  }

  async accounts(
    context: AccountContext,
    query: BillingAccountsQueryDto,
  ): Promise<Paged<BillingAccountSummary>> {
    const response = await this.billing.accounts.call(
      'listAccounts',
      {
        page: { page: query.page, pageSize: query.pageSize, sort: query.sort },
        ...(query.planCode === undefined ? {} : { planCode: query.planCode }),
        status: subscriptionStatusProto.toProto(query.status),
        ...(query.pinned === undefined ? {} : { pinned: query.pinned }),
        ...(query.dunning === undefined ? {} : { dunning: query.dunning }),
      },
      context,
    );
    const meta = toPageMetaOrThrow(response.page);
    const ownerOf = await this.people.owners(
      context,
      response.accounts.map((account) => account.ownerUserId),
    );
    return Paged.page(
      response.accounts.map((account) => toBillingAccountSummary(account, ownerOf)),
      meta.page,
      meta.pageSize,
      meta.total,
    );
  }

  async account(context: AccountContext, billingAccountId: string): Promise<BillingAccountDetail> {
    const response = await this.billing.accounts.call('getAccount', { billingAccountId }, context);
    return toBillingAccountDetail(
      response.account,
      await this.ownerOfDetail(context, response),
      await this.placeNames(context, response.account),
    );
  }

  async unpinPreview(context: AccountContext, billingAccountId: string): Promise<UnpinPreview> {
    return toUnpinPreview(
      await this.billing.accounts.call('previewUnpin', { billingAccountId }, context),
    );
  }

  async override(
    context: AccountContext,
    billingAccountId: string,
    body: OverrideEntitlementsDto,
  ): Promise<{ account: BillingAccountDetail }> {
    const response = await this.billing.accounts.call(
      'overrideEntitlements',
      { billingAccountId, grants: toEntitlements(body.grants), reason: body.reason },
      context,
    );
    return {
      account: toBillingAccountDetail(
        response.account,
        await this.ownerOfDetail(context, response),
        await this.placeNames(context, response.account),
      ),
    };
  }

  async unpin(
    context: AccountContext,
    billingAccountId: string,
    body: UnpinDto,
  ): Promise<{ account: BillingAccountDetail }> {
    const response = await this.billing.accounts.call(
      'unpinEntitlements',
      { billingAccountId, reason: body.reason },
      context,
    );
    return {
      account: toBillingAccountDetail(
        response.account,
        await this.ownerOfDetail(context, response),
        await this.placeNames(context, response.account),
      ),
    };
  }

  async events(
    context: AccountContext,
    query: BillingEventsQueryDto,
  ): Promise<Paged<BillingEvent>> {
    const response = await this.billing.events.call(
      'listBillingEvents',
      {
        page: { page: query.page, pageSize: query.pageSize, sort: query.sort },
        status: billingEventStatusProto.toProto(query.status),
        ...(query.eventType === undefined ? {} : { eventType: query.eventType }),
        ...(query.billingAccountId === undefined
          ? {}
          : { billingAccountId: query.billingAccountId }),
      },
      context,
    );
    const meta = toPageMetaOrThrow(response.page);
    const ownerOf = await this.people.owners(
      context,
      response.events.map((event) => event.ownerUserId),
    );
    return Paged.page(
      response.events.map((event) => toBillingEvent(event, ownerOf)),
      meta.page,
      meta.pageSize,
      meta.total,
    );
  }

  async event(context: AccountContext, billingEventId: string): Promise<BillingEvent> {
    const response = await this.billing.events.call('getBillingEvent', { billingEventId }, context);
    return toBillingEvent(
      response.event,
      await this.people.owners(context, [response.event?.ownerUserId]),
    );
  }

  async replay(context: AccountContext, billingEventId: string): Promise<{ event: BillingEvent }> {
    const response = await this.billing.events.call(
      'replayBillingEvent',
      { billingEventId },
      context,
    );
    return {
      event: toBillingEvent(
        response.event,
        await this.people.owners(context, [response.event?.ownerUserId]),
      ),
    };
  }

  /** The owner of an account read. */
  private ownerOfDetail(
    context: AccountContext,
    response: { account?: { summary?: { ownerUserId: string } } },
  ): Promise<OwnerOf> {
    return this.people.owners(context, [response.account?.summary?.ownerUserId]);
  }
}
