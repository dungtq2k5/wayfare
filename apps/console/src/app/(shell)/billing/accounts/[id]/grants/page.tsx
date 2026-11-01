import { GrantForm } from '../../../../../../billing/grant-form';
import { accountOnServer } from '../../../../../../billing/account-route';
import { denial } from '../../../../../../server/guard';
import { NotFoundView } from '../../../../../../states/states';

/** An off-catalogue grant (W3). */
export default async function GrantsPage({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/billing/accounts', 'billing.entitlement.override');
  if (denied !== null) return denied;
  const account = await accountOnServer((await params).id);
  return account === null ? (
    <NotFoundView
      resource={{
        name: 'resource.billingAccount',
        list: 'nav.billingAccounts',
        href: '/billing/accounts',
      }}
    />
  ) : (
    <GrantForm account={account} />
  );
}
