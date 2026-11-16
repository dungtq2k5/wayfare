import { Module } from '@nestjs/common';
import { ReadsGrpcController } from './reads-grpc.controller';
import { ReadsService } from './reads.service';

/** The dashboards' reads (api-endpoints-plan §7). */
@Module({ controllers: [ReadsGrpcController], providers: [ReadsService] })
export class ReadsModule {}
