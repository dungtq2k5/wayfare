import { Module } from '@nestjs/common';
import { UserErasedConsumer } from './user-erased.consumer';

/** The `identity.user.erased` consumer. */
@Module({ providers: [UserErasedConsumer], exports: [UserErasedConsumer] })
export class UserErasedModule {}
