'use client';

import { useQuery } from '@tanstack/react-query';
import { adminPlacesGet } from '@wayfare/api-client';
import { useConsole } from '../i18n/provider';
import { useMe } from '../shell/me';

/** A job's target as people read it: a Place by name, a menu dish as one. */
export function useTargetName(type: string, id: string | null): string {
  const { t } = useConsole();
  // ponytail: one Place read per row, cached for the session; a name on the job's own row if it shows.
  const place = useQuery({
    queryKey: ['place-name', id],
    enabled: type === 'PLACE' && id !== null,
    queryFn: async () => (await adminPlacesGet(id!)).data.nameVi,
    staleTime: Infinity,
  });
  if (type !== 'PLACE') return t('jobs.menuItem');
  return place.data ?? '…';
}

/** The target's name in a row. */
export function TargetName({ type, id }: { type: string; id: string | null }) {
  return <span lang="vi">{useTargetName(type, id)}</span>;
}

/** The trigger in words: *Manual · You* for a job someone started by hand. */
export function useTriggerText(): (job: {
  trigger: string;
  requestedByUserId: string | null;
}) => string {
  const { t, tDynamic } = useConsole();
  const me = useMe();
  return (job) => {
    const trigger = tDynamic(`trigger.${job.trigger}`, undefined, job.trigger);
    if (job.requestedByUserId === null) return trigger;
    const who = job.requestedByUserId === me.user.id ? t('history.you') : t('history.staff');
    return `${trigger} · ${who}`;
  };
}
