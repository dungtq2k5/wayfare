import { zNotificationFeedQuery, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Validated `GET /notifications` query (api-endpoints-plan §1.7). */
export class NotificationFeedQueryDto extends createZodDto(zNotificationFeedQuery) {}

/** `/notifications/:id`. */
export const notificationIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated notification path parameter. */
export class NotificationIdParamDto extends createZodDto(notificationIdParamSchema) {}
