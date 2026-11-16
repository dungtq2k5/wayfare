import { Module } from '@nestjs/common';
import { FakeCheckoutService } from './fake-checkout.service';

/** A stack's fake Checkout, paid from the console's dev page; production refuses it. */
@Module({
  providers: [FakeCheckoutService],
  exports: [FakeCheckoutService],
})
export class FakeCheckoutModule {}
