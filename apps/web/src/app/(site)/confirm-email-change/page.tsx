import type { Metadata } from 'next';
import { LinkAction } from '../../../account/link-action';
import { serverTranslator } from '../../../i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverTranslator()).t('app.name') };
}

/** An emailed link (K8): the token in the fragment, read in the browser. */
export default function Page() {
  return <LinkAction kind="confirm" />;
}
