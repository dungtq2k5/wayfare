import type { Metadata } from 'next';
import { CodeEntry } from '../../../codes/code-entry';
import { serverTranslator } from '../../../i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverTranslator()).t('code.title') };
}

export default function CodePage() {
  return <CodeEntry />;
}
