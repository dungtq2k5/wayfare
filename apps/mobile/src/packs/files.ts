import { Directory, File, Paths } from 'expo-file-system';

/** Every area's pack folder lives here: the document directory, which Android never clears. */
export const packsRoot = (): Directory => new Directory(Paths.document, 'packs');
export const areaFolder = (areaId: string): Directory => new Directory(packsRoot(), areaId);

/** A file under an area's folder, by its relative name (`map/2/fonts/…`, `photos/<sha>.jpg`). */
export function packFile(areaId: string, name: string): File {
  const parts = name.split('/');
  const folder = new Directory(areaFolder(areaId), ...parts.slice(0, -1));
  return new File(folder, parts.at(-1)!);
}

/** The folder a file goes in, made if missing. */
export function ensureFolderOf(areaId: string, name: string): void {
  const parts = name.split('/');
  const folder = new Directory(areaFolder(areaId), ...parts.slice(0, -1));
  if (!folder.exists) folder.create({ intermediates: true });
}
