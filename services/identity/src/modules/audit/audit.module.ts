import { Module } from '@nestjs/common';
import { AuditGrpcController } from './audit-grpc.controller';
import { AuditConsumer } from './audit.consumer';
import { AuditService } from './audit.service';

/** The `audit.record` consumer, the service that writes `audit_logs`, and the console's reads. */
@Module({
  controllers: [AuditGrpcController],
  providers: [AuditService, AuditConsumer],
  exports: [AuditConsumer, AuditService],
})
export class AuditModule {}
