import type { Metadata } from 'next';
import { SignInForm } from '../../../account/sign-in-form';
import { serverTranslator } from '../../../i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverTranslator()).t('signIn.title') };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return <SignInForm next={(await searchParams).next ?? null} />;
}
