import type { Metadata } from 'next';
import { AccountView } from '../../../account/account-view';
import { serverTranslator } from '../../../i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverTranslator()).t('acc.title') };
}

export default function AccountPage() {
  return <AccountView />;
}
