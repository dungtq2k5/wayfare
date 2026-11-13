import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PeopleNamesService } from './people-names.service';

/** The names rule's one helper, for the reads that name people from other services (K1's rule). */
@Module({
  imports: [IdentityModule],
  providers: [PeopleNamesService],
  exports: [PeopleNamesService],
})
export class PeopleNamesModule {}
