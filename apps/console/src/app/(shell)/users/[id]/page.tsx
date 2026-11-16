import { withUser } from '../../../../operations/user-route';
import { UserPage } from '../../../../operations/user-page';

/** A user's page (U2). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return withUser(params, (user) => <UserPage initial={user} />);
}
