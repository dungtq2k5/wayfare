'use client';

import { Card } from '@wayfare/ui/surfaces';
import Link from 'next/link';
import { useConsole } from '../../../../i18n/provider';

/** Where *Register it* lands until owner self-registration is built (round 36). */
export default function RegisterPage() {
  const { t } = useConsole();
  return (
    <Card className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold text-foreground">
        {t('section.soonTitle', { page: t('signIn.register') })}
      </h1>
      <p className="text-sm text-muted-foreground">{t('section.soonBody')}</p>
      <Link
        href="/sign-in"
        className="self-start rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('forgot.back')}
      </Link>
    </Card>
  );
}
