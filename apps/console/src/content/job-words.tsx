'use client';

import { useQuery } from '@tanstack/react-query';
import { adminLocalizationsOverview, adminPlacesGet } from '@wayfare/api-client';
import { useCan } from '../shell/can';
import { useConsole } from '../i18n/provider';
import { useMe } from '../shell/me';

/**
 * A job's target as people read it: its Vietnamese name (a Place's or a menu dish's), from the
 * localization overview, or the Place's own page for someone who can't edit localizations.
 */
export function useTargetName(type: string, id: string | null): string {
  const { t } = useConsole();
  const can = useCan();
  const overview = can('localization.edit');
  // ponytail: one read per row, cached for the session; a name on the job's own row if it shows.
  const name = useQuery({
    queryKey: ['target-name', type, id],
    enabled: id !== null && (overview || type === 'PLACE'),
    queryFn: async () =>
      overview
        ? (await adminLocalizationsOverview(type as 'PLACE' | 'MENU_ITEM', id!)).data.nameVi
        : (await adminPlacesGet(id!)).data.nameVi,
    staleTime: Infinity,
  });
  if (name.data !== undefined) return name.data;
  return type === 'PLACE' || overview ? '…' : t('jobs.menuItem');
}

/** The target's name in a row, its kind under it. */
export function TargetName({ type, id }: { type: string; id: string | null }) {
  const { t } = useConsole();
  return (
    <span className="flex flex-col">
      <span lang="vi">{useTargetName(type, id)}</span>
      <span className="text-xs font-normal text-muted-foreground">
        {type === 'PLACE' ? t('jobs.kindPlace') : t('jobs.kindMenuItem')}
      </span>
    </span>
  );
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
