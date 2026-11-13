import type { Metadata } from 'next';
import { serverTranslator } from '../../../i18n/server';
import { LegalPageView } from '../../../legal/legal-page';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverTranslator()).t('legal.privacy') };
}

/** A legal page (WG1, K12); `?v=` opens an earlier version. */
export default async function Page({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  return <LegalPageView page="privacy" version={(await searchParams).v ?? null} />;
}
