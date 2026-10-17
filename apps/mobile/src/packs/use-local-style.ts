import { useQuery } from '@tanstack/react-query';
import { Directory } from 'expo-file-system';
import { areaFolder, packFile } from './files';
import { localStyle } from './local-style';
import { usePackIndex } from './use-pack-files';

/**
 * The area's map from its downloaded pack (K12): the light style, or the dark one when there is
 * one, read from the phone with its URLs swapped. Null when the area has no pack in use.
 */
export function useLocalStyle(areaId: string | undefined, dark: boolean): object | null {
  const pack = usePackIndex((index) =>
    areaId === undefined ? undefined : index.areas.get(areaId),
  );
  const map = pack?.map ?? null;
  const name = map === null ? null : dark ? (map.styleDark ?? map.style) : map.style;
  const query = useQuery({
    queryKey: ['pack-style', areaId, map?.version ?? 0, name],
    enabled: map !== null && name !== null,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const text = await packFile(areaId!, name!).text();
      const folder = new Directory(areaFolder(areaId!), ...map!.folder.split('/'));
      return localStyle(text, map!.prefixUrl, folder.uri);
    },
  });
  return map === null ? null : (query.data ?? null);
}
