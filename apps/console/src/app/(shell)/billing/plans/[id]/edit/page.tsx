import { PlanForm } from '../../../../../../billing/plan-form';
import { planOnServer } from '../../../../../../billing/plan-route';
import { denial } from '../../../../../../server/guard';
import { NotFoundView } from '../../../../../../states/states';

/** A plan's edit (B3c). */
export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/billing/plans');
  if (denied !== null) return denied;
  const plan = await planOnServer((await params).id);
  return plan === null ? (
    <NotFoundView resource={{ name: 'resource.plan', list: 'nav.plans', href: '/billing/plans' }} />
  ) : (
    <PlanForm plan={plan} />
  );
}
