import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

/** `/admin/audit-logs`, backed by `identity.AuditService`. */
@Module({
  imports: [IdentityModule],
  controllers: [AuditLogsController],
  providers: [AuditLogsService],
})
export class AuditLogsModule {}
