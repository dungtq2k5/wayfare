import { Directory, File, Paths } from 'expo-file-system';

/** Reached over USB with `adb reverse tcp:13000 tcp:13000`. */
export const GATEWAY_URL = 'http://localhost:13000/api/v1';
/** Reached over USB with `adb reverse tcp:4443 tcp:4443`, for the remote-mode check only. */
export const FAKE_GCS_URL = 'http://localhost:4443';

/** The pilot's District 1 area (`services/catalog/prisma/seed/pilot-d1/area.json`). */
export const AREA_ID = '01a0b373-d3eb-73c0-bd64-001fdcfca699';
export const LANG = 'en';

export const AUDIO_DIR = new Directory(Paths.document, 'audio');
export const MAP_DIR = new Directory(Paths.document, 'map');
export const PLACES_FILE = new File(Paths.document, 'places.json');
export const MANIFEST_FILE = new File(Paths.document, 'manifest.json');
export const DEVICE_FILE = new File(Paths.document, 'device.json');
export const ENGINE_STATE_FILE = new File(Paths.document, 'engine-state.json');
export const LOG_FILE = new File(Paths.document, 'walk-log.jsonl');

/** What `POST /devices` returns, kept for the walk. */
export interface DeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly accessToken: string;
}
