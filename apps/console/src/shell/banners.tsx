'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@wayfare/ui/button';
import { Banner } from '@wayfare/ui/states';
import { MailWarning, ServerOff, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { useConnection } from '../client/connection';
import { useConsole } from '../i18n/provider';
import { useMe } from './me';

/** While the API is down, asked again this often; the banner leaves by itself (K14). */
const RETRY_MS = 15_000;

/**
 * One banner at a time under the bar (C16, C17), the most serious first: the API down, offline,
 * then a bounced address, which stays until the address is verified again.
 */
export function Banners() {
  const { t } = useConsole();
  const me = useMe();
  const connection = useConnection();
  const queries = useQueryClient();

  useEffect(() => {
    if (connection !== 'down') return;
    const timer = setInterval(() => void queries.refetchQueries({ type: 'active' }), RETRY_MS);
    return () => clearInterval(timer);
  }, [connection, queries]);

  if (connection === 'down') {
    return (
      <Banner
        tone="error"
        icon={<ServerOff aria-hidden />}
        message={t('banner.apiDown')}
        action={
          <Button
            size="sm"
            variant="outline"
            className="text-foreground"
            onClick={() => void queries.refetchQueries({ type: 'active' })}
          >
            {t('banner.retry')}
          </Button>
        }
      />
    );
  }
  if (connection === 'offline') {
    return <Banner tone="offline" icon={<WifiOff aria-hidden />} message={t('banner.offline')} />;
  }
  if (me.user.emailBounced) {
    return (
      <Banner
        tone="warning"
        icon={<MailWarning aria-hidden />}
        message={t('banner.bounced', { email: me.user.email })}
        action={
          <Button size="sm" variant="outline" asChild>
            <Link href="/account?change=email">{t('banner.changeEmail')}</Link>
          </Button>
        }
      />
    );
  }
  return null;
}
