import { AccountPage } from '../../../../../billing/accounts';
import { accountOnServer } from '../../../../../billing/account-route';
import { denial } from '../../../../../server/guard';
import { NotFoundView } from '../../../../../states/states';

/** An account's page (W2–W2e, W5), read on the server. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/billing/accounts');
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
    <AccountPage initial={account} />
  );
}
