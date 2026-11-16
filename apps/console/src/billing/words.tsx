'use client';

import { useQuery } from '@tanstack/react-query';
import { adminPlansList } from '@wayfare/api-client';
import { StatusBadge } from '@wayfare/ui/surfaces';
import type { StatusTone } from '@wayfare/ui/surfaces';
import { Info } from 'lucide-react';
import { formatDate, formatTime } from '../i18n/format';
import type { ConsoleLocale } from '../i18n/messages';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';

/** A subscription's status, as Stripe reports it (the handoff's component map). */
const SUBSCRIPTION_TONES: Record<string, StatusTone> = {
  ACTIVE: 'active',
  TRIALING: 'active',
  PAST_DUE: 'pending',
  INCOMPLETE: 'pending',
  UNPAID: 'rejected',
  CANCELED: 'inactive',
  PAUSED: 'inactive',
  INCOMPLETE_EXPIRED: 'inactive',
  NONE: 'draft',
};

/** The subscription's status in words, with its tone. */
export function SubscriptionBadge({ status }: { status: string }) {
  const { tDynamic } = useConsole();
  return (
    <StatusBadge tone={SUBSCRIPTION_TONES[status] ?? 'draft'}>
      {tDynamic(`subscription.${status}`)}
    </StatusBadge>
  );
}

const EVENT_TONES: Record<string, StatusTone> = {
  RECEIVED: 'processing',
  PROCESSED: 'active',
  IGNORED: 'inactive',
  FAILED: 'rejected',
};

/**
 * An event's status in words (E1). *Skipped as stale* — and as a duplicate — is an info chip, never
 * red: a newer event got there first, which is normal.
 */
export function EventBadge({ status }: { status: string }) {
  const { tDynamic } = useConsole();
  const label = tDynamic(`eventStatus.${status}`);
  if (status === 'SKIPPED_STALE' || status === 'SKIPPED_DUPLICATE')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-info px-2 py-0.5 text-xs font-medium whitespace-nowrap text-info-foreground [&_svg]:size-3">
        <Info aria-hidden />
        {label}
      </span>
    );
  return <StatusBadge tone={EVENT_TONES[status] ?? 'draft'}>{label}</StatusBadge>;
}

/** A moment as the billing pages give it: "2 Oct 2026, 08:14". */
export const formatMoment = (iso: string, locale: ConsoleLocale) =>
  `${formatDate(iso, locale)}, ${formatTime(iso, locale)}`;

/**
 * The live plans, for a reader holding `billing.plan.manage` or `billing.account.read`: a plan's name
 * by its code, and every plan for a filter. A code not in the catalogue is its own name.
 */
export function usePlans(): {
  name: (code: string) => string;
  plans: readonly { code: string; name: string }[];
} {
  const can = useCan();
  const plans = useQuery({
    queryKey: ['admin-plans', false],
    queryFn: async () =>
      (await adminPlansList()).data.toSorted((a, b) => a.sortOrder - b.sortOrder),
    enabled: can('billing.plan.manage') || can('billing.account.read'),
  });
  return {
    name: (code) => plans.data?.find((plan) => plan.code === code)?.name ?? code,
    plans: plans.data ?? [],
  };
}

/** The owner as a line can name them: their name, else their email, else "An owner". */
export const ownerName = (
  owner: { name: string | null; email: string | null } | null,
  fallback: string,
): string => owner?.name ?? owner?.email ?? fallback;
