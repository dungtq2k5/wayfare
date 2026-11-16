'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { FormAlert } from '@wayfare/ui/field';
import { useRef } from 'react';
import { useConsole } from '../i18n/provider';

/**
 * A stats read for the page's range: the last answer stays (dimmed) while the next is read, and a
 * failed read keeps what was shown — a failure never draws zeros. The plan's refusal and the
 * server's range refusal are said apart.
 */
export function useStatsRead<T>(key: readonly unknown[], read: () => Promise<T>, enabled = true) {
  const query = useQuery({
    queryKey: key,
    queryFn: read,
    placeholderData: keepPreviousData,
    enabled,
  });
  const last = useRef<T | undefined>(undefined);
  if (query.data !== undefined && !query.isPlaceholderData) last.current = query.data;
  const error = query.error;
  const code = error instanceof ApiError ? error.code : null;
  return {
    data: query.data ?? last.current,
    /** The old range's numbers, kept while the new arrive. */
    stale: query.isPlaceholderData,
    noLevel: code === 'ANALYTICS_LEVEL_INSUFFICIENT',
    refused: code === 'VALIDATION_FAILED',
    notFound: code === 'RESOURCE_NOT_FOUND',
    failed:
      error !== null &&
      code !== 'ANALYTICS_LEVEL_INSUFFICIENT' &&
      code !== 'VALIDATION_FAILED' &&
      code !== 'RESOURCE_NOT_FOUND',
    retry: () => void query.refetch(),
  };
}

/** A failed read, above the content (round 33's alert): the numbers shown stay, or none at all. */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useConsole();
  return (
    <FormAlert
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('chart.retry')}
        </Button>
      }
    >
      {t('chart.loadFailed')}
    </FormAlert>
  );
}
