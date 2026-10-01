import {
  LEGAL_DOCUMENT_VERSIONS,
  LegalDocument,
  Platform as WayfarePlatform,
} from '@wayfare/contracts';
import type { OfflineManifest, PlaceSyncRecord } from '@wayfare/contracts';
import { Directory, File } from 'expo-file-system';
import {
  AREA_ID,
  AUDIO_DIR,
  DEVICE_FILE,
  GATEWAY_URL,
  LANG,
  MANIFEST_FILE,
  MAP_DIR,
  PLACES_FILE,
} from './config';
import type { DeviceCredentials } from './config';

const CLIENT_HEADER = { 'X-Wayfare-Client': 'mobile' };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...CLIENT_HEADER, ...init.headers },
  });
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path}: HTTP ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { data: T };
  return body.data;
}

/** `POST /devices`: registers this install and returns an access token in the same call. */
async function registerDevice(): Promise<DeviceCredentials> {
  return call<DeviceCredentials>('/devices', {
    method: 'POST',
    body: JSON.stringify({
      platform: WayfarePlatform.ANDROID,
      appVersion: '1.0.0',
      contentLocale: LANG,
      privacyPolicyVersion: LEGAL_DOCUMENT_VERSIONS[LegalDocument.PRIVACY_POLICY],
    }),
  });
}

/** `GET /sync/places`: the D1 area's Places, the shape `evaluateGeofences` reads. */
async function syncPlaces(accessToken: string): Promise<PlaceSyncRecord[]> {
  const { places } = await call<{ places: PlaceSyncRecord[] }>(
    `/sync/places?areaId=${AREA_ID}&lang=${LANG}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  return places;
}

/** `GET /offline/areas/:areaId/manifest`: the audio and map pack files to download. */
async function fetchManifest(accessToken: string): Promise<OfflineManifest> {
  return call<OfflineManifest>(`/offline/areas/${AREA_ID}/manifest?lang=${LANG}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

function ensureDir(dir: Directory): void {
  if (!dir.exists) dir.create({ intermediates: true });
}

export type DownloadProgress = (message: string) => void;

/**
 * The spike's *Download* button: register, read the D1 area's Places and manifest, then pull
 * every audio file and the map pack into the document directory. No export script, no bundled
 * assets — the same contract a real device sync would use.
 */
export async function download(onProgress: DownloadProgress): Promise<void> {
  onProgress('registering device…');
  const device = await registerDevice();
  DEVICE_FILE.write(JSON.stringify(device));

  onProgress('reading Places…');
  const places = await syncPlaces(device.accessToken);
  PLACES_FILE.write(JSON.stringify(places));
  onProgress(`${places.length} Places`);

  onProgress('reading the manifest…');
  const manifest = await fetchManifest(device.accessToken);
  MANIFEST_FILE.write(JSON.stringify(manifest));

  ensureDir(AUDIO_DIR);
  for (const [index, audio] of manifest.audio.entries()) {
    onProgress(`audio ${index + 1}/${manifest.audio.length}`);
    await File.downloadFileAsync(audio.url, new File(AUDIO_DIR, `${audio.placeId}.mp3`), {
      idempotent: true,
    });
  }

  if (manifest.mapPack !== null) {
    ensureDir(MAP_DIR);
    const { pmtiles, style, assets } = manifest.mapPack;
    onProgress('map pack: archive');
    await File.downloadFileAsync(pmtiles.url, new File(MAP_DIR, 'map.pmtiles'), {
      idempotent: true,
    });
    onProgress('map pack: style');
    await File.downloadFileAsync(style.url, new File(MAP_DIR, 'style.json'), { idempotent: true });
    for (const [index, asset] of assets.entries()) {
      onProgress(`map pack: asset ${index + 1}/${assets.length}`);
      const destination = new File(MAP_DIR, asset.path);
      ensureDir(destination.parentDirectory);
      await File.downloadFileAsync(asset.url, destination, { idempotent: true });
    }
  }

  onProgress('done');
}
