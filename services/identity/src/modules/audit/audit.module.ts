import { Module } from '@nestjs/common';
import { AuditConsumer } from './audit.consumer';
import { AuditService } from './audit.service';

/** The `audit.record` consumer and the service that writes `audit_logs`. */
@Module({
  providers: [AuditService, AuditConsumer],
  exports: [AuditConsumer, AuditService],
})
export class AuditModule {}
