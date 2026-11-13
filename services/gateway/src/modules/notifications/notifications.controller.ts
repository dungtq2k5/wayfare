import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { NotificationItem } from '@wayfare/contracts';
import { ApiEnvelope, ApiErrors, Auth, Ctx, NoStore, UsesUpstream } from '@wayfare/nest-common';
import type { AccountContext, Paged } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { NotificationResponseDto, UnreadCountResponseDto } from './dto/notification-response.dto';
import { NotificationFeedQueryDto, NotificationIdParamDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/** `/notifications` — the caller's own in-app feed (api-endpoints-plan §1.7). */
@ApiTags('notifications')
@UsesUpstream()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Auth('USER')
  @NoStore()
  @ApiOperation({ summary: 'The feed, newest first; `unreadOnly` for the unread rows.' })
  @ApiEnvelope(NotificationResponseDto, { list: 'cursor' })
  @ZodSerializerDto(NotificationResponseDto)
  list(
    @Ctx() context: AccountContext,
    @Query() query: NotificationFeedQueryDto,
  ): Promise<Paged<NotificationItem>> {
    return this.notifications.list(context, query);
  }

  @Get('unread-count')
  @Auth('USER')
  @NoStore()
  @ApiOperation({ summary: 'Unread, unexpired rows — the bell on a cold start.' })
  @ApiEnvelope(UnreadCountResponseDto)
  @ZodSerializerDto(UnreadCountResponseDto)
  unreadCount(@Ctx() context: AccountContext): Promise<{ count: number }> {
    return this.notifications.unreadCount(context);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('USER')
  @NoStore()
  @ApiOperation({ summary: 'Mark everything read; idempotent. Other tabs hear it on the socket.' })
  @ApiEnvelope(null)
  markAllRead(@Ctx() context: AccountContext): Promise<void> {
    return this.notifications.markAllRead(context);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('USER')
  @NoStore()
  @ApiOperation({ summary: 'Mark one read; idempotent. Other tabs hear it on the socket.' })
  @ApiEnvelope(null)
  @ApiErrors('RESOURCE_NOT_FOUND')
  markRead(@Ctx() context: AccountContext, @Param() params: NotificationIdParamDto): Promise<void> {
    return this.notifications.markRead(context, params.id);
  }
}
