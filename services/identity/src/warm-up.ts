import type { INestApplication } from '@nestjs/common';
import { WARM_UP_ID, warmUpAccount, warmUpAnonymous } from '@wayfare/nest-common';
import type { WarmUpStep } from '@wayfare/nest-common';
import { AuthGrpcController } from './modules/auth/auth-grpc.controller';
import { UsersGrpcController } from './modules/users/users-grpc.controller';

/** Identity's hot reads (`warmUp`): the gateway's token cutoff on every request, and `/users/me`. */
export function identityWarmUp(app: INestApplication): WarmUpStep[] {
  const auth = app.get(AuthGrpcController);
  const users = app.get(UsersGrpcController);
  return [
    {
      name: 'token cutoff',
      run: () => auth.getTokenCutoff({ userId: WARM_UP_ID }, warmUpAnonymous()),
    },
    { name: 'me', run: () => users.getMe({}, warmUpAccount()) },
  ];
}
