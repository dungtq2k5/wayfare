import { ApiError, adminBillingEvent } from '@wayfare/api-client';
import { EventPage } from '../../../../../billing/events';
import { serverCall } from '../../../../../server/api';
import { denial } from '../../../../../server/guard';
import { NotFoundView } from '../../../../../states/states';

/** An event's page (E2–E3c), read on the server with its payload (K17). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/billing/events');
  if (denied !== null) return denied;
  const { id } = await params;
  try {
    const { data } = await serverCall((options) => adminBillingEvent(id, options));
    return <EventPage initial={data} />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) {
      return (
        <NotFoundView
          resource={{ name: 'resource.event', list: 'nav.stripeEvents', href: '/billing/events' }}
        />
      );
    }
    throw error;
  }
}
