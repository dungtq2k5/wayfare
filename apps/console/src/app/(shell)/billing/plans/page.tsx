import { PlansList } from '../../../../billing/plans';
import { denial } from '../../../../server/guard';

/** The plans (B1). */
export default async function PlansPage() {
  return (await denial('/billing/plans')) ?? <PlansList />;
}
