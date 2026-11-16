import type { INestApplication } from '@nestjs/common';
import { WARM_UP_ID, warmUpAnonymous } from '@wayfare/nest-common';
import type { WarmUpStep } from '@wayfare/nest-common';
import { NarrationGrpcController } from './modules/narration/narration-grpc.controller';

/** Narration's hot read (`warmUp`): a Place's story status, read on every Place page. */
export function narrationWarmUp(app: INestApplication): WarmUpStep[] {
  const narration = app.get(NarrationGrpcController);
  return [
    {
      name: 'status',
      run: () =>
        narration.getNarrationStatus({ placeId: WARM_UP_ID, lang: 'en' }, warmUpAnonymous()),
    },
  ];
}
