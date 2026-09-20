import { Module } from '@nestjs/common';
import { PronunciationsGrpcController } from './pronunciations-grpc.controller';
import { PronunciationsService } from './pronunciations.service';

/** The pronunciation dictionary's routes (api-endpoints-plan §4.4, rdm-spec N-5). */
@Module({
  controllers: [PronunciationsGrpcController],
  providers: [PronunciationsService],
  exports: [PronunciationsService],
})
export class PronunciationsModule {}
