import { Module } from '@nestjs/common';
import { PlacesModule } from '../places/places.module';
import { UserErasedConsumer } from './user-erased.consumer';

/** The `identity.user.erased` consumer. */
@Module({
  imports: [PlacesModule],
  providers: [UserErasedConsumer],
  exports: [UserErasedConsumer],
})
export class UserErasedModule {}
