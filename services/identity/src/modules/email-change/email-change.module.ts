import { Global, Module } from '@nestjs/common';
import { EmailChangeGrpcController } from './email-change-grpc.controller';
import { EmailChangeService } from './email-change.service';

/** Address verification and change (api-endpoints-plan §1.2). Exports verification for register. */
@Global()
@Module({
  controllers: [EmailChangeGrpcController],
  providers: [EmailChangeService],
  exports: [EmailChangeService],
})
export class EmailChangeModule {}
