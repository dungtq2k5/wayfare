import type { Metadata } from 'next';
import { SignUpForm } from '../../../account/sign-up-form';
import { serverTranslator } from '../../../i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverTranslator()).t('signUp.title') };
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return <SignUpForm next={(await searchParams).next ?? null} />;
}
