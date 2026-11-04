'use client';

import Link from 'next/link';
import { SponsoredChip } from '../components/sponsored-chip';
import { formatDate } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { Notice } from '../owner/registration';
import { useCan } from '../shell/can';
import { Section } from './place-sections';

interface PlaceBoost {
  readonly since: string;
  readonly billingAccountId: string;
  readonly planCode: string;
  readonly slots: number;
}

/** A plan's name from its code (`GROWTH` → "Growth"), as the notifications read it. */
const planName = (code: string): string =>
  code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * The Place page's *Discovery boost* card (BA2), after *Editorial*: who boosted it and since when,
 * that it touches the list and the map only, and the billing account (with `billing.account.read`).
 * `undefined` boost: billing didn't answer — the card says so and the page stands.
 */
export function PlaceBoostSection({
  boost,
  owner,
}: {
  boost: PlaceBoost | null | undefined;
  owner: string;
}) {
  const { t, locale } = useConsole();
  const can = useCan();
  if (boost === null) return null;
  return (
    <Section
      id="place-boost"
      title={t('boosts.venueTitle')}
      action={boost === undefined ? undefined : <SponsoredChip />}
    >
      {boost === undefined ? (
        <Notice tone="warning">{t('placeBoost.unavailable')}</Notice>
      ) : (
        <>
          <p className="text-sm text-foreground">
            {t('placeBoost.body', {
              date: formatDate(boost.since, locale),
              plan: planName(boost.planCode),
              n: boost.slots,
            })}
          </p>
          {can('billing.account.read') ? (
            <Link
              href={`/billing/accounts/${boost.billingAccountId}`}
              className="self-start rounded-sm text-sm text-primary underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('placeBoost.account', { owner })}
            </Link>
          ) : null}
        </>
      )}
    </Section>
  );
}
