import { Inject, Injectable } from '@nestjs/common';
import { MAP_PACK_RETENTION_DAYS, MapPackStatus } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { objectsOf } from '../map-packs/domain/map-pack-objects';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What one run did. */
export interface MapPacksPruneResult {
  readonly packs: number;
  readonly objects: number;
}

/**
 * Deletes a retired map pack's objects `MAP_PACK_RETENTION_DAYS` after it was retired (rdm-spec
 * C-14), so a download of the previous version can finish first: the objects, then
 * `objects_deleted_at`, so a failure is retried on the next run. A path another kept pack still
 * names — the same build registered twice — is left alone.
 */
@Injectable()
export class MapPacksPruneJob implements ScheduledJob {
  readonly name = 'map-packs-prune';
  readonly everyMs = DAY_MS;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async run(now: Date = new Date()): Promise<MapPacksPruneResult> {
    const before = new Date(now.getTime() - MAP_PACK_RETENTION_DAYS * DAY_MS);
    const due = await this.prisma.mapPack.findMany({
      where: { status: MapPackStatus.RETIRED, retiredAt: { lte: before }, objectsDeletedAt: null },
      orderBy: { retiredAt: 'asc' },
    });
    if (due.length === 0) return { packs: 0, objects: 0 };
    const kept = await this.prisma.mapPack.findMany({
      where: { id: { notIn: due.map((pack) => pack.id) }, objectsDeletedAt: null },
    });
    const keptPaths = new Set(kept.flatMap((pack) => objectsOf(pack).map((object) => object.path)));
    let objects = 0;
    for (const pack of due) {
      for (const { path } of objectsOf(pack)) {
        if (keptPaths.has(path)) continue;
        await this.storage.delete(path);
        objects++;
      }
      await this.prisma.mapPack.update({
        where: { id: pack.id },
        data: { objectsDeletedAt: now },
        select: { id: true },
      });
    }
    return { packs: due.length, objects };
  }
}
