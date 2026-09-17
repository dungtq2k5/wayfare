import { Injectable } from '@nestjs/common';
import type { AccountContext } from '@wayfare/nest-common';
import { Paged } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import { toAuditLogResponseDto, toListAuditLogsRequest } from './audit-log.mapper';
import type { AuditLogResponseDto } from './dto/audit-log-response.dto';
import type { ListAuditLogsQueryDto } from './dto/audit-log.dto';

/** `/admin/audit-logs`, backed by `identity.AuditService`. */
@Injectable()
export class AuditLogsService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async list(
    context: AccountContext,
    query: ListAuditLogsQueryDto,
  ): Promise<Paged<AuditLogResponseDto>> {
    const response = await this.identity.audit.call(
      'listAuditLogs',
      toListAuditLogsRequest(query),
      context,
    );
    return Paged.cursor(
      response.entries.map(toAuditLogResponseDto),
      response.page?.nextCursor ?? null,
    );
  }

  async actions(context: AccountContext): Promise<string[]> {
    const response = await this.identity.audit.call('listAuditActions', {}, context);
    return [...response.actions];
  }
}
