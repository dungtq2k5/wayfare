import type { PlaceSyncRecordStored } from '@wayfare/contracts';
import type { GeofencePlace } from '@wayfare/core';
import { databaseReady } from '../data/boot';
import { allPlaces } from '../data/queries';
import { useAppStore } from '../state/app-store';

/** The synced Places in the tourist's language, read once and kept: no query per fix. */
interface Loaded {
  readonly lang: string;
  readonly at: number;
  readonly records: ReadonlyMap<string, PlaceSyncRecordStored>;
  readonly geofence: readonly GeofencePlace[];
}

let loaded: Loaded | null = null;
const REFRESH_MS = 5 * 60_000;

function geofenceOf(record: PlaceSyncRecordStored): GeofencePlace {
  return {
    id: record.id,
    kind: record.kind,
    location: record.location,
    triggerRadiusM: record.triggerRadiusM,
    narrationPriority: record.narrationPriority,
    autoNarrationEnabled: record.autoNarrationEnabled,
  } as GeofencePlace;
}

/** Reads the Places again when the language changed or the copy is old; otherwise returns it. */
export async function loadWalkPlaces(now: number): Promise<Loaded> {
  const lang = useAppStore.getState().language ?? 'en';
  if (loaded !== null && loaded.lang === lang && now - loaded.at < REFRESH_MS) return loaded;
  const records = await allPlaces(await databaseReady, lang);
  loaded = {
    lang,
    at: now,
    records: new Map(records.map((record) => [record.id, record])),
    geofence: records.map(geofenceOf),
  };
  return loaded;
}

/** The copy last read; empty until the first load. */
export const walkPlaces = (): Loaded =>
  loaded ?? { lang: '', at: 0, records: new Map(), geofence: [] };

/** For a spec or *Forget this install*. */
export function dropWalkPlaces(): void {
  loaded = null;
}
