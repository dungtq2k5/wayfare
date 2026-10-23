import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { fakeGoogleKeys, publishedGoogleKeys } from '../google/domain/google-keys';
import { GOOGLE_KEYS, GoogleService } from '../google/google.service';
import { AuthGrpcController } from './auth-grpc.controller';
import { AuthService } from './auth.service';

/** Sign-in, refresh rotation and sign-out (api-endpoints-plan §1.2), Continue with Google included. */
@Module({
  controllers: [AuthGrpcController],
  providers: [
    AuthService,
    GoogleService,
    {
      // Google's published keys, or locally the fake issuer's (ADR 0063).
      provide: GOOGLE_KEYS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const fakeKey = config.get('GOOGLE_FAKE_SIGNING_KEY', { infer: true });
        return config.get('GOOGLE_ISSUER', { infer: true }) === 'fake' && fakeKey !== undefined
          ? fakeGoogleKeys(fakeKey)
          : publishedGoogleKeys();
      },
    },
  ],
})
export class AuthModule {}
