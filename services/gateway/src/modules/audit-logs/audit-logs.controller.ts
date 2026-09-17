import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, Ctx, NoStore, RequirePermission, UsesUpstream } from '@wayfare/nest-common';
import type { AccountContext, Paged } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { AuditLogsService } from './audit-logs.service';
import { AuditActionResponseDto, AuditLogResponseDto } from './dto/audit-log-response.dto';
import { ListAuditLogsQueryDto } from './dto/audit-log.dto';

/** `/admin/audit-logs` (api-endpoints-plan §1.8). */
@ApiTags('admin-audit-logs')
@UsesUpstream()
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly audit: AuditLogsService) {}

  @Get()
  @RequirePermission('audit.read')
  @NoStore()
  @ApiOperation({
    summary: 'The audit log inside a window of at most 93 days, newest first.',
  })
  @ApiEnvelope(AuditLogResponseDto, { list: 'cursor' })
  @ZodSerializerDto(AuditLogResponseDto)
  list(
    @Ctx() context: AccountContext,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<Paged<AuditLogResponseDto>> {
    return this.audit.list(context, query);
  }

  @Get('actions')
  @RequirePermission('audit.read')
  @NoStore()
  @ApiOperation({ summary: "The build's action vocabulary, sorted, for the filter." })
  @ApiEnvelope(AuditActionResponseDto, { array: true })
  @ZodSerializerDto([AuditActionResponseDto])
  actions(@Ctx() context: AccountContext): Promise<string[]> {
    return this.audit.actions(context);
  }
}
