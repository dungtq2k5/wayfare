import { Inject, Injectable } from '@nestjs/common';
import { MAP_PACK_RETENTION_DAYS } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { ListedObject, StorageProvider } from '@wayfare/nest-common/storage';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the offline snapshots live: `offline/<areaCode>/<lang>/<areaVersion>-<live>.ndjson.gz`. */
export const SNAPSHOTS_PREFIX = 'offline/';

/**
 * Deletes offline places snapshots older than the map packs' retention window (rdm-spec C-14),
 * except each area and language's newest — the one a manifest names now, however old.
 */
@Injectable()
export class OfflineSnapshotsPruneJob implements ScheduledJob {
  readonly name = 'offline-snapshots-prune';
  readonly everyMs = DAY_MS;

  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  async run(now: Date = new Date()): Promise<{ deleted: number }> {
    const before = now.getTime() - MAP_PACK_RETENTION_DAYS * DAY_MS;
    const folders = new Map<string, ListedObject[]>();
    for (const object of await this.storage.list(SNAPSHOTS_PREFIX)) {
      const folder = object.path.slice(0, object.path.lastIndexOf('/') + 1);
      folders.set(folder, [...(folders.get(folder) ?? []), object]);
    }
    let deleted = 0;
    for (const objects of folders.values()) {
      const newest = objects.reduce((a, b) => (b.createdAt > a.createdAt ? b : a), objects[0]!);
      for (const object of objects) {
        if (object === newest || object.createdAt.getTime() > before) continue;
        await this.storage.delete(object.path);
        deleted++;
      }
    }
    return { deleted };
  }
}
