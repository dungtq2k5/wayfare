/**
 * A pack's style drawn from the phone: every URL under the published pack's prefix — the
 * `pmtiles://` archive, the glyph template, the sprite — pointed at the pack's local map folder,
 * whose files keep their paths relative to that prefix (K1).
 */
export function localStyle(styleJson: string, prefixUrl: string, localFolderUri: string): object {
  const folder = localFolderUri.endsWith('/') ? localFolderUri : `${localFolderUri}/`;
  return JSON.parse(styleJson.split(prefixUrl).join(folder)) as object;
}
