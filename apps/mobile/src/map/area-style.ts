import { useAreasList } from '@wayfare/api-client';
import { useMapPack } from './use-map-pack';
import { chooseMapStyle } from './map-logic';
import { useNetworkStore } from '../network/network-store';
import { usePackIndex } from '../packs/use-pack-files';
import { useLocalStyle } from '../packs/use-local-style';
import { useTheme } from '../theme/appearance';

/** An area's map style as the Map tab chooses it: the download's, else the pack's, else blank. */
export function useAreaMapStyle(areaId: string | null) {
  const theme = useTheme();
  const offline = useNetworkStore((state) => state.status === 'offline');
  const areas = useAreasList();
  const area = (areas.data?.data ?? []).find((candidate) => candidate.id === areaId);
  const pack = useMapPack(area);
  const local = useLocalStyle(area?.id, theme.mode === 'dark');
  /** The area's download is on this phone: offline, its streets, covers and stories are. */
  const downloaded = usePackIndex((index) => areaId !== null && index.areas.has(areaId));
  /** When that download was installed, for the offline note's "({when})". */
  const downloadedAt = usePackIndex((index) =>
    areaId === null ? null : (index.areas.get(areaId)?.installedAt ?? null),
  );
  return {
    area,
    downloaded,
    downloadedAt,
    style: chooseMapStyle({
      pack: pack.data ?? null,
      local,
      dark: theme.mode === 'dark',
      offline,
      background: theme.colors.background,
    }).style,
  };
}
