import { zUuidV7 } from '../common/ids';
import { zNotification } from '../notifications/data';
import { defineEvent, eventSchema } from './event-definition';

/** `notification.create` — any service asks identity to notify a user (rdm-spec I-10). */
export const NOTIFICATION_CREATE = defineEvent({
  subject: 'notification.create',
  publisher: 'any',
  stream: 'NOTIFICATION',
  schema: eventSchema({ recipientUserId: zUuidV7, notification: zNotification }),
  aggregateId: (payload) => payload.recipientUserId,
});
