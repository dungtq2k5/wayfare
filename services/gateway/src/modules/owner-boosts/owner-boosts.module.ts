import { Module } from '@nestjs/common';
import { OwnerBoostsController } from './owner-boosts.controller';
import { OwnerBoostsService } from './owner-boosts.service';

/** `/owner/boosts`, backed by `billing.BoostService`. */
@Module({
  controllers: [OwnerBoostsController],
  providers: [OwnerBoostsService],
  exports: [OwnerBoostsService],
})
export class OwnerBoostsModule {}
