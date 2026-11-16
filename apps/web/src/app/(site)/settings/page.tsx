import type { Metadata } from 'next';
import { serverTranslator } from '../../../i18n/server';
import { SettingsView } from '../../../settings-view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverTranslator()).t('settings.title') };
}

export default function SettingsPage() {
  return <SettingsView />;
}
