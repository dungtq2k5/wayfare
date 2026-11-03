import type { Metadata } from 'next';
import { ResetPassword } from '../../../account/reset-password';
import { serverTranslator } from '../../../i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverTranslator()).t('link.resetTitle') };
}

/** WE1b: the reset link (K8), validated before the form shows. */
export default function ResetPasswordPage() {
  return <ResetPassword />;
}
