'use client';

import { Button } from '@wayfare/ui/button';
import { EmptyState, ErrorState } from '@wayfare/ui/states';
import { CircleAlert, SearchX, ShieldX } from 'lucide-react';
import Link from 'next/link';
import type { Failure } from '../client/errors';
import { useConsole } from '../i18n/provider';
import type { PlainKey } from '../i18n/messages';

/** C14: what the page is and *Go to Home* — never a blank page, never one with its data missing. */
export function NoPermission({ page }: { page: PlainKey }) {
  const { t } = useConsole();
  return (
    <EmptyState
      headingLevel={1}
      icon={<ShieldX />}
      title={t('state.noPermissionTitle')}
      body={t('state.noPermissionBody', { page: t(page) })}
      action={
        <Button asChild variant="outline">
          <Link href="/">{t('state.goHome')}</Link>
        </Button>
      }
    />
  );
}

/** C15: a record that is not there names its kind; an unknown address is "This page doesn't exist". */
export function NotFoundView({
  resource,
}: {
  resource?: { name: PlainKey; list: PlainKey; href: string };
}) {
  const { t } = useConsole();
  return resource === undefined ? (
    <EmptyState
      headingLevel={1}
      icon={<SearchX />}
      title={t('state.pageNotFoundTitle')}
      body={t('state.pageNotFoundBody')}
      action={
        <Button asChild variant="outline">
          <Link href="/">{t('state.goHome')}</Link>
        </Button>
      }
    />
  ) : (
    <EmptyState
      headingLevel={1}
      icon={<SearchX />}
      title={t('state.notFoundTitle', { resource: t(resource.name) })}
      body={t('state.notFoundBody')}
      action={
        <Button asChild variant="outline">
          <Link href={resource.href}>{t('state.backTo', { list: t(resource.list) })}</Link>
        </Button>
      }
    />
  );
}

/** C13: a failed request replaces only what it would have filled — its text, its ID, *Try again*. */
export function ErrorView({ failure, onRetry }: { failure: Failure; onRetry?: () => void }) {
  const { t, tDynamic } = useConsole();
  return (
    <ErrorState
      icon={<CircleAlert />}
      title={t('state.errorTitle')}
      message={failure.code === 'INTERNAL' ? t('error.generic') : tDynamic(`error.${failure.code}`)}
      requestId={failure.requestId}
      labels={{
        requestId: t('state.requestId'),
        copy: t('action.copy'),
        copied: t('action.copied'),
        retry: t('action.retry'),
      }}
      onRetry={onRetry ?? (() => window.location.reload())}
    />
  );
}
