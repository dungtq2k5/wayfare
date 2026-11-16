import { EmailDeliveries } from '../../../../../operations/email-deliveries';
import { withUser } from '../../../../../operations/user-route';

/** A user's email deliveries (U8). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return withUser(params, (user) => <EmailDeliveries user={user} />);
}
