import { Module } from '@nestjs/common';
import { OwnerVerifiedConsumer } from './owner-verified.consumer';

/** The `identity.owner.verified` consumer. */
@Module({ providers: [OwnerVerifiedConsumer], exports: [OwnerVerifiedConsumer] })
export class OwnerVerifiedModule {}
