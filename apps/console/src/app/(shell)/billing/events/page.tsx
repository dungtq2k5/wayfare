import { EventsList } from '../../../../billing/events';
import { denial } from '../../../../server/guard';

/** The Stripe events (E1). */
export default async function EventsPage() {
  return (await denial('/billing/events')) ?? <EventsList />;
}
