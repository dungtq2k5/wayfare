import { Injectable } from '@nestjs/common';
import type { OwnerBoosts } from '@wayfare/contracts';
import type { AccountContext } from '@wayfare/nest-common';
import { toOwnerBoosts } from '../billing/billing.mapper';
import { BillingServiceGrpcClient } from '../billing/billing-service-grpc.client';
import type { SetOwnerBoostsDto } from './dto/owner-boosts.dto';

/** `/owner/boosts`, backed by `billing.BoostService` (api-endpoints-plan §5.2). */
@Injectable()
export class OwnerBoostsService {
  constructor(private readonly billing: BillingServiceGrpcClient) {}

  async read(context: AccountContext): Promise<OwnerBoosts> {
    return toOwnerBoosts(await this.billing.boosts.call('getMyBoosts', {}, context));
  }

  async set(context: AccountContext, body: SetOwnerBoostsDto): Promise<OwnerBoosts> {
    return toOwnerBoosts(
      await this.billing.boosts.call('setMyBoosts', { placeIds: body.placeIds }, context),
    );
  }

  /** The caller's live boosts by Place, for the Venue rows; null when billing doesn't answer. */
  async liveSince(context: AccountContext): Promise<Map<string, string> | null> {
    try {
      const { live } = await this.read(context);
      return new Map(live.map((boost) => [boost.placeId, boost.since]));
    } catch {
      return null;
    }
  }
}
