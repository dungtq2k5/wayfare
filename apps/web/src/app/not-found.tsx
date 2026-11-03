import { Button } from '@wayfare/ui/button';
import Link from 'next/link';
import { serverTranslator } from '../i18n/server';

export default async function NotFound() {
  const { t } = await serverTranslator();
  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start gap-4 px-4 py-12"
    >
      <h1 className="text-2xl font-semibold text-foreground">{t('notFound.title')}</h1>
      <p className="text-base text-muted-foreground">{t('notFound.body')}</p>
      <Button asChild size="lg">
        <Link href="/map">{t('notFound.map')}</Link>
      </Button>
    </main>
  );
}
