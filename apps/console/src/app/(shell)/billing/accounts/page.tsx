import { AccountsList } from '../../../../billing/accounts';
import { denial } from '../../../../server/guard';

/** The billing accounts (W1). */
export default async function AccountsPage() {
  return (await denial('/billing/accounts')) ?? <AccountsList />;
}
