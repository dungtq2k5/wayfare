import { NotificationsView } from '../../../../owner/notifications';
import { denial } from '../../../../server/guard';

/** Notifications (I1). */
export default async function Page() {
  const denied = await denial('/owner/notifications');
  if (denied !== null) return denied;
  return <NotificationsView />;
}
