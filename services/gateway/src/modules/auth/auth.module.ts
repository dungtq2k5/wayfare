import { Module } from '@nestjs/common';
import { SessionCookieService, SessionResponder } from '@wayfare/nest-common';
import { ConfigService } from '@nestjs/config';
import type { GatewayConfig } from '../../config/env.schema';
import { IdentityModule } from '../identity/identity.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/** `/auth` routes, backed by `identity.AuthService`. */
@Module({
  imports: [IdentityModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: SessionResponder,
      inject: [ConfigService],
      useFactory: (config: GatewayConfig) =>
        new SessionResponder(
          new SessionCookieService(config.get('GLOBAL_PREFIX', { infer: true })),
        ),
    },
  ],
  // The password and address routes clear cookies too.
  exports: [SessionResponder],
})
export class AuthModule {}
