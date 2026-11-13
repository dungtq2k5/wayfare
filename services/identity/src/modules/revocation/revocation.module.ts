import { Module } from '@nestjs/common';
import {
  DEFAULT_REVOCATION_TTLS,
  REVOCATION_TTLS,
  RevocationConsumer,
} from './revocation.consumer';

/** Writes revocations to Redis for the gateway (api-endpoints-plan §0.1). */
@Module({
  providers: [RevocationConsumer, { provide: REVOCATION_TTLS, useValue: DEFAULT_REVOCATION_TTLS }],
  exports: [RevocationConsumer],
})
export class RevocationModule {}
