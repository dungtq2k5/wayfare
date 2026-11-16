import { Global, Module } from '@nestjs/common';
import { TokensService } from './tokens.service';

/** Token signing and password hashing, for every use case that opens a session. */
@Global()
@Module({
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
