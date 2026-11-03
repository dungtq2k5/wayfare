import type { Metadata } from 'next';
import { ForgotForm } from '../../../account/forgot-form';
import { serverTranslator } from '../../../i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverTranslator()).t('forgot.title') };
}

export default function ForgotPage() {
  return <ForgotForm />;
}
