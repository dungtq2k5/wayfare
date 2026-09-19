import { Global, Module } from '@nestjs/common';
import { EntitlementsGrpcController } from './entitlements-grpc.controller';
import { EntitlementsService } from './entitlements.service';

/** Effective grants: the RPC every limit check asks, and the one writer of grant columns. */
@Global()
@Module({
  controllers: [EntitlementsGrpcController],
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
