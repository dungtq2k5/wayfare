import { Injectable } from '@nestjs/common';
import type { BillingAccountDetail, BillingAccountSummary, BillingEvent } from '@wayfare/contracts';
import { billingEventStatusProto, subscriptionStatusProto } from '@wayfare/contracts/grpc';
import type { AccountContext } from '@wayfare/nest-common';
import { Paged, toPageMetaOrThrow } from '@wayfare/nest-common';
import { toEntitlements } from '../admin-plans/admin-plan.mapper';
import { BillingServiceGrpcClient } from '../billing/billing-service-grpc.client';
import {
  toBillingAccountDetail,
  toBillingAccountSummary,
  toBillingEvent,
} from './admin-billing.mapper';
import type {
  BillingAccountsQueryDto,
  BillingEventsQueryDto,
  OverrideEntitlementsDto,
  UnpinDto,
} from './dto/admin-billing.dto';

/** `/admin/billing` accounts and events, backed by billing's admin services. */
@Injectable()
export class AdminBillingService {
  constructor(private readonly billing: BillingServiceGrpcClient) {}

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
    return Paged.page(
      response.accounts.map(toBillingAccountSummary),
      meta.page,
      meta.pageSize,
      meta.total,
    );
  }

  async account(context: AccountContext, billingAccountId: string): Promise<BillingAccountDetail> {
    const response = await this.billing.accounts.call('getAccount', { billingAccountId }, context);
    return toBillingAccountDetail(response.account);
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
    return { account: toBillingAccountDetail(response.account) };
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
    return { account: toBillingAccountDetail(response.account) };
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
    return Paged.page(response.events.map(toBillingEvent), meta.page, meta.pageSize, meta.total);
  }

  async replay(context: AccountContext, billingEventId: string): Promise<{ event: BillingEvent }> {
    const response = await this.billing.events.call(
      'replayBillingEvent',
      { billingEventId },
      context,
    );
    return { event: toBillingEvent(response.event) };
  }
}
