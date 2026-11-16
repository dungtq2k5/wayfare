'use client';

import type { adminBillingAccount } from '@wayfare/api-client';
import { SponsoredChip } from '../components/sponsored-chip';
import { Section } from '../content/place-sections';
import { formatDate } from '../i18n/format';
import { useConsole } from '../i18n/provider';

type AccountDetail = Awaited<ReturnType<typeof adminBillingAccount>>['data'];

/**
 * W2's *Discovery boosts* (BA1), after *Grants*: used of the slots, the live boosts with since when
 * and their weight, and those ended in the last 90 days with why. Read-only: the owner chooses;
 * an admin changes how many slots with *Change grants…*.
 */
export function AccountBoosts({ account }: { account: AccountDetail }) {
  const { t, tDynamic, locale } = useConsole();
  const slots = account.entitlements.discoveryBoostSlots;
  const live = account.boosts.filter((boost) => boost.endedAt === null);
  const ended = account.boosts.filter((boost) => boost.endedAt !== null);
  const name = (placeName: string | null) => placeName ?? t('boosts.unknownVenue');
  const date = (iso: string) => formatDate(iso, locale);
  const shortDate = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
      day: 'numeric',
      month: 'short',
    }).format(new Date(iso));
  return (
    <Section
      id="boosts"
      title={t('boosts.title')}
      action={
        <span className="rounded-full bg-muted px-2 py-0.5 text-sm font-medium text-foreground">
          {t('boosts.used', { used: live.length, slots })}
        </span>
      }
    >
      <p className="text-xs text-muted-foreground">{t('adminBoosts.lead')}</p>
      {live.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('adminBoosts.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {live.map((boost) => (
            <li
              key={boost.placeId}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-base font-medium text-foreground">
                  {name(boost.placeName)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('adminBoosts.liveSince', { date: date(boost.since), n: boost.weight })}
                </span>
              </span>
              <SponsoredChip />
            </li>
          ))}
        </ul>
      )}
      {ended.length === 0 ? null : (
        <section aria-labelledby="boosts-ended" className="flex flex-col gap-2">
          <h3 id="boosts-ended" className="text-sm font-medium text-muted-foreground">
            {t('boosts.ended')}
          </h3>
          <ul className="flex flex-col gap-2">
            {ended.map((boost) => (
              <li
                key={`${boost.placeId}-${boost.endedAt ?? ''}`}
                className="flex flex-col gap-0.5 rounded-md bg-muted px-4 py-3"
              >
                <span className="text-base font-medium text-foreground">
                  {name(boost.placeName)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {`${shortDate(boost.since)} – ${date(boost.endedAt ?? boost.since)}`}
                  {' · '}
                  {tDynamic(`adminBoosts.why.${boost.endedReason ?? 'OWNER'}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Section>
  );
}
