import type { INestApplication } from '@nestjs/common';
import { warmUpAccount } from '@wayfare/nest-common';
import type { WarmUpStep } from '@wayfare/nest-common';
import { ReadsGrpcController } from './modules/reads/reads-grpc.controller';

/** Analytics' hot read (`warmUp`): the console's overview, its default 30 days. */
export function analyticsWarmUp(app: INestApplication): WarmUpStep[] {
  const reads = app.get(ReadsGrpcController);
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  return [
    {
      name: 'overview',
      run: () =>
        reads.getOverview({ range: { fromDay: day(-30), toDay: day(-1) } }, warmUpAccount()),
    },
  ];
}
