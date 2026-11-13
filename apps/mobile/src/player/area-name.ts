import { getAreasListQueryKey } from '@wayfare/api-client';
import type { AreasList200 } from '@wayfare/api-client';
import { tourist } from '../i18n';
import { queryClient } from '../state/query-client';

/** The area's name, through the app's strings, from the persisted areas list; "Wayfare" without it. */
export function areaNameOf(areaId: string | null): string {
  const { t, tFamily } = tourist();
  const areas = queryClient.getQueryData<AreasList200>(getAreasListQueryKey());
  const area = areas?.data.find((candidate) => candidate.id === areaId);
  return area === undefined ? t('player.appName') : tFamily('area', area.code, t('player.appName'));
}
