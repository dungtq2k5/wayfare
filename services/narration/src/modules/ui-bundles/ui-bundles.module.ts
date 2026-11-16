import { Module } from '@nestjs/common';
import { UiBundlesGrpcController } from './ui-bundles-grpc.controller';
import { UiBundlesService } from './ui-bundles.service';

/** The UI string bundles both apps read (api-endpoints-plan §4.2, rdm-spec N-6). */
@Module({
  controllers: [UiBundlesGrpcController],
  providers: [UiBundlesService],
  exports: [UiBundlesService],
})
export class UiBundlesModule {}
