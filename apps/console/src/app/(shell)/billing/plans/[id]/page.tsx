import { PlanPage } from '../../../../../billing/plans';
import { planOnServer } from '../../../../../billing/plan-route';
import { denial } from '../../../../../server/guard';
import { NotFoundView } from '../../../../../states/states';

/** A plan's page (B2), read on the server; a retired plan has none. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/billing/plans');
  if (denied !== null) return denied;
  const plan = await planOnServer((await params).id);
  return plan === null ? (
    <NotFoundView resource={{ name: 'resource.plan', list: 'nav.plans', href: '/billing/plans' }} />
  ) : (
    <PlanPage initial={plan} />
  );
}
