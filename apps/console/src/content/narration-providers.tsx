'use client';

import { useQuery } from '@tanstack/react-query';
import { adminNarrationProviders } from '@wayfare/api-client';
import { PageHeader } from '@wayfare/ui/list';
import { Card } from '@wayfare/ui/surfaces';
import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { failureOf } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { ErrorView } from '../states/states';

type Provider = Awaited<ReturnType<typeof adminNarrationProviders>>['data'][number];

// ponytail: the API names no cost; Google is the one paid provider today. A `paid` flag on the
// providers' answer when a second one appears.
const PAID = new Set(['google']);

/** Serving is the first in order that answers; an open breaker is not answering. */
export function providerState(row: Provider, rows: readonly Provider[]) {
  if (row.breaker === 'open') return 'notAnswering' as const;
  const serving = rows
    .filter((other) => other.role === row.role && other.breaker === 'closed')
    .sort((a, b) => a.position - b.position)[0];
  return serving?.name === row.name ? ('serving' as const) : ('standingBy' as const);
}

/**
 * Providers (J5): each translation and speech provider in order, free or paid, serving, standing
 * by or not answering — with when it is tried again — as the one narration process that answered
 * sees them (K15). A line at the top says why a role is off its first provider.
 */
export function NarrationProviders() {
  const translator = useConsole();
  const { t, locale } = translator;
  const providers = useQuery({
    queryKey: ['narration-providers'],
    queryFn: async () => (await adminNarrationProviders()).data,
  });
  const rows = providers.data ?? [];
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const roleName = (role: string) =>
    role === 'speech' ? t('providers.speech') : t('providers.translation');
  const down = rows.filter((row) => row.position === 0 && row.breaker === 'open');

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/narration/jobs" className="text-sm text-muted-foreground hover:underline">
            {t('jobs.title')}
          </Link>
        }
        title={t('providers.title')}
        description={t('providers.lead')}
      />
      {providers.isError ? (
        <ErrorView failure={failureOf(providers.error)} onRetry={() => void providers.refetch()} />
      ) : (
        <>
          {down.map((row) => (
            <div
              key={row.name}
              role="status"
              className="flex items-start gap-2 rounded-md bg-warning px-4 py-3 text-sm text-warning-foreground"
            >
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong className="block">{t('providers.whyTitle')}</strong>
                {t('providers.whyBody', { role: roleName(row.role), name: row.name })}
              </span>
            </div>
          ))}
          {(['translation', 'speech'] as const).map((role) => (
            <Card key={role} className="flex flex-col gap-3" aria-labelledby={`role-${role}`}>
              <h2 id={`role-${role}`} className="text-lg font-semibold text-foreground">
                {roleName(role)}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      {[
                        t('providers.provider'),
                        t('providers.cost'),
                        t('providers.state'),
                        t('providers.health'),
                        t('providers.order'),
                      ].map((heading) => (
                        <th key={heading} scope="col" className="px-2 py-2 font-medium">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .filter((row) => row.role === role)
                      .sort((a, b) => a.position - b.position)
                      .map((row) => {
                        const state = providerState(row, rows);
                        return (
                          <tr key={row.name} className="border-t border-border align-top">
                            <th scope="row" className="px-2 py-3 font-medium text-foreground">
                              {row.name}
                            </th>
                            <td className="px-2 py-3">
                              {PAID.has(row.name) ? t('providers.paid') : t('providers.free')}
                            </td>
                            <td className="px-2 py-3">
                              <span className="flex flex-col">
                                <span
                                  className={
                                    state === 'notAnswering'
                                      ? 'font-medium text-destructive'
                                      : state === 'serving'
                                        ? 'font-medium text-success-foreground'
                                        : 'text-foreground'
                                  }
                                >
                                  {t(`providers.${state}`)}
                                </span>
                                {row.coolingUntil === null ? null : (
                                  <span className="text-xs text-muted-foreground">
                                    {t('providers.resting', { time: clock(row.coolingUntil) })}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-2 py-3 text-muted-foreground">
                              {row.recentCalls === 0 || row.errorRate === 0
                                ? t('providers.answering')
                                : t('providers.errors', { n: Math.round(row.errorRate * 100) })}
                            </td>
                            <td className="px-2 py-3 text-muted-foreground">
                              {row.position === 0 ? t('providers.first') : t('providers.fallback')}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
          <p className="text-xs text-muted-foreground">{t('providers.process')}</p>
        </>
      )}
    </>
  );
}
