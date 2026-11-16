import { zNotificationItem, zUnreadCount } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';

/** One feed row; the client renders its words from `type` and `data` (conventions §11.1). */
export class NotificationResponseDto extends createZodDto(zNotificationItem) {}

/** `{ count }` of unread, unexpired rows. */
export class UnreadCountResponseDto extends createZodDto(zUnreadCount) {}
