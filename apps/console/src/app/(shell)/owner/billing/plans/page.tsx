import { PlansView } from '../../../../../owner/plans';
import { denial } from '../../../../../server/guard';

/** Choose a plan (Y2). */
export default async function Page() {
  const denied = await denial('/owner/billing');
  if (denied !== null) return denied;
  return <PlansView />;
}
