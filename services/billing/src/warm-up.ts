import type { INestApplication } from '@nestjs/common';
import { WARM_UP_ID, warmUpAccount, warmUpAnonymous } from '@wayfare/nest-common';
import type { WarmUpStep } from '@wayfare/nest-common';
import { BoostsGrpcController } from './modules/boosts/boosts-grpc.controller';
import { EntitlementsGrpcController } from './modules/entitlements/entitlements-grpc.controller';
import { PrismaService } from './modules/prisma/prisma.service';

/**
 * Billing's hot reads (`warmUp`): an owner's entitlements, read by catalog and the gateway, and the
 * owner's boosts. As an existing owner when there is one, so the whole path runs.
 */
export async function billingWarmUp(app: INestApplication): Promise<WarmUpStep[]> {
  const entitlements = app.get(EntitlementsGrpcController);
  const boosts = app.get(BoostsGrpcController);
  const owner = await app.get(PrismaService).billingAccount.findFirst({
    select: { ownerUserId: true },
  });
  const ownerUserId = owner?.ownerUserId ?? WARM_UP_ID;
  return [
    {
      name: 'entitlements',
      run: () => entitlements.getEntitlements({ ownerUserId }, warmUpAnonymous()),
    },
    { name: 'boosts', run: () => boosts.getMyBoosts({}, warmUpAccount([], ownerUserId)) },
  ];
}
