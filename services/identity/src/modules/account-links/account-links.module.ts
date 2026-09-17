import { Global, Module } from '@nestjs/common';
import { AccountLinksService } from './account-links.service';

/** Single-use emailed links (rdm-spec I-9), used by every flow that sends one. */
@Global()
@Module({
  providers: [AccountLinksService],
  exports: [AccountLinksService],
})
export class AccountLinksModule {}
