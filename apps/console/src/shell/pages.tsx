'use client';

import { PageHeader } from '@wayfare/ui/list';
import { EmptyState } from '@wayfare/ui/states';
import { Construction, House } from 'lucide-react';
import { failureOf } from '../client/errors';
import { useConsole } from '../i18n/provider';
import type { PlainKey } from '../i18n/messages';
import { StuckPlacesCard, useStuck } from '../operations/stuck';
import { OwnerHome } from '../owner/home';
import { RegistrationView } from '../owner/registration';
import { ErrorView } from '../states/states';
import { useMe } from './me';

/** Home (C6, C7): the person's queues and activity will land here; for now, the way in. */
export function HomeView() {
  const { t } = useConsole();
  const me = useMe();
  // An applicant's Home is their registration's status (K1).
  if (me.ownership === 'applicant' && !me.permissions.some((code) => code !== 'owner.access'))
    return <RegistrationView title={t('home.title')} />;
  if (me.ownership === 'verified' && !me.permissions.some((code) => code !== 'owner.access'))
    return <OwnerHome />;
  return <StaffHome />;
}

function StaffHome() {
  const { t } = useConsole();
  const me = useMe();
  const stuckQuery = useStuck();
  const stuck = stuckQuery.data ?? [];
  // Nothing until the stuck read answers: the empty line, then the card, would jump.
  const waiting = stuckQuery.isPending && stuckQuery.fetchStatus !== 'idle';
  return (
    <>
      <PageHeader
        title={t('home.title')}
        description={me.ownership === null ? t('home.leadStaff') : t('home.leadOwner')}
      />
      {/* X1: *Needs a look* first, only when a Place is stuck; no card and no empty line else. */}
      {waiting ? null : stuckQuery.isError ? (
        // Never "nothing needs you" for a read that failed: it would hide stuck Places. Without
        // `place.read` the read never runs (disabled, not failed), and the empty line stays.
        <ErrorView
          failure={failureOf(stuckQuery.error)}
          onRetry={() => void stuckQuery.refetch()}
        />
      ) : stuck.length > 0 ? (
        <StuckPlacesCard stuck={stuck} />
      ) : (
        <EmptyState icon={<House />} title={t('home.emptyTitle')} body={t('home.emptyBody')} />
      )}
    </>
  );
}

/** A section whose pages come in a later round. */
export function SectionView({ label }: { label: PlainKey }) {
  const { t } = useConsole();
  return (
    <>
      <PageHeader title={t(label)} />
      <EmptyState
        icon={<Construction />}
        title={t('section.soonTitle', { page: t(label) })}
        body={t('section.soonBody')}
      />
    </>
  );
}
