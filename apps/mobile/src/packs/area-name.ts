import { getAreasListQueryKey } from '@wayfare/api-client';
import type { AreasList200 } from '@wayfare/api-client';
import { tourist } from '../i18n';
import { queryClient } from '../state/query-client';

/** The area's name in the app's language, as every pack screen and notification says it. */
export function areaName(areaId: string): string {
  const areas = queryClient.getQueryData<AreasList200>(getAreasListQueryKey())?.data ?? [];
  const code = areas.find((area) => area.id === areaId)?.code ?? areaId.slice(0, 8);
  return tourist().tFamily('area', code, code);
}
