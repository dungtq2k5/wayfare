import { File, Paths } from 'expo-file-system';
import { NOTIFICATION_ARTWORK_BASE64 } from './generated/notification-artwork';

/**
 * The app icon as a file the media notification can read. The notification shows the Place's photo;
 * a Place without one shows this — never a blank card whose controls are the colour of its
 * background, and never the previous Place's picture. Written once, on first use.
 */
let url: string | undefined;

export function fallbackArtworkUrl(): string | undefined {
  if (url !== undefined) return url;
  try {
    const file = new File(Paths.cache, 'notification-artwork.png');
    if (!file.exists) {
      file.create();
      file.write(Uint8Array.from(atob(NOTIFICATION_ARTWORK_BASE64), (char) => char.charCodeAt(0)));
    }
    url = file.uri;
  } catch {
    url = undefined;
  }
  return url;
}
