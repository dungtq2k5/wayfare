'use client';

import { ApiError } from '@wayfare/api-client';
import { ErrorState } from '@wayfare/ui/states';
import { CircleAlert } from 'lucide-react';
import { useWeb } from '../i18n/provider';

/**
 * A failed read on the web (handoff 37 §20): "Couldn't load this", why — offline, or anything
 * else — and *Try again*. The request id row appears when the failure is the API's own answer; a
 * failure that never reached the API, or a server component's, has none.
 */
export function WebErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useWeb();
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  return (
    <ErrorState
      icon={<CircleAlert />}
      title={t('state.errorTitle')}
      message={offline ? t('error.network') : t('error.generic')}
      requestId={error instanceof ApiError ? error.requestId : undefined}
      labels={{
        requestId: t('state.requestId'),
        copy: t('action.copy'),
        copied: t('action.copied'),
        retry: t('common.tryAgain'),
      }}
      onRetry={onRetry}
    />
  );
}
