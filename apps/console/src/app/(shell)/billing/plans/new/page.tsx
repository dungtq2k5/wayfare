import { PlanForm } from '../../../../../billing/plan-form';
import { denial } from '../../../../../server/guard';

/** A new plan (B3). */
export default async function NewPlanPage() {
  return (await denial('/billing/plans')) ?? <PlanForm plan={null} />;
}
