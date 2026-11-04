import { Global, Module } from '@nestjs/common';
import { BoostsLedgerService } from './boosts-ledger.service';

/** The boost rows' one writer (rdm-spec B-5), shared by the grants, the owner's set and the consumer. */
@Global()
@Module({ providers: [BoostsLedgerService], exports: [BoostsLedgerService] })
export class BoostsLedgerModule {}
