import { Inject, Injectable, Logger } from '@nestjs/common';
import { PENDING_UPLOAD_TTL_DAYS } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { originalPath, variantPath } from '../uploads/uploads.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a `PENDING` submission names upload `u` (rdm-spec C-12). */
const heldBySubmission = Prisma.sql`EXISTS (
  SELECT 1 FROM place_submissions s
  WHERE s.status = 'PENDING'
    AND s.payload->'photos' @> jsonb_build_array(jsonb_build_object('uploadId', u.id::text)))`;

/** Rows one run handles; the next run takes the rest. */
export const REAP_BATCH_SIZE = 500;

/** What one run did. */
export interface ReapResult {
  readonly reaped: number;
  readonly originalsSwept: number;
}

/**
 * Reaps uploads nobody will use (rdm-spec C-12, §7), objects first and the row after: unconfirmed
 * past their URL's expiry, and confirmed but unconsumed after `PENDING_UPLOAD_TTL_DAYS` unless a
 * pending submission names them. It also
 * deletes the original of any upload confirmed in the last day, in case confirm could not.
 */
@Injectable()
export class PendingUploadsReapJob implements ScheduledJob {
  readonly name = 'pending-uploads-reap';
  readonly everyMs = 15 * 60 * 1000;
  private readonly logger = new Logger(PendingUploadsReapJob.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async run(now: Date = new Date()): Promise<ReapResult> {
    const unusedBefore = new Date(now.getTime() - PENDING_UPLOAD_TTL_DAYS * DAY_MS);
    // An upload a pending submission names is kept whatever its age: approval consumes it.
    const due = await this.prisma.$queryRaw<{ id: string; confirmedAt: Date | null }[]>`
      SELECT u.id, u.confirmed_at AS "confirmedAt"
      FROM pending_uploads u
      WHERE u.consumed_at IS NULL
        AND ((u.confirmed_at IS NULL AND u.expires_at < ${now})
          OR (u.confirmed_at < ${unusedBefore} AND NOT ${heldBySubmission}))
      ORDER BY u.id
      LIMIT ${REAP_BATCH_SIZE}`;
    let reaped = 0;
    for (const upload of due) {
      // The row stays locked while its objects go, so a racing consume waits and then finds
      // nothing; a failed delete rolls back and the next run retries.
      reaped += await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT u.id FROM pending_uploads u
          WHERE u.id = ${upload.id}::uuid AND u.consumed_at IS NULL AND NOT ${heldBySubmission}
          FOR UPDATE SKIP LOCKED`;
        if (locked.length === 0) return 0;
        await this.storage.delete(originalPath(upload.id));
        if (upload.confirmedAt !== null) {
          for (const variant of ['thumb', 'card', 'full']) {
            await this.storage.delete(variantPath(upload.id, variant));
          }
        }
        await tx.pendingUpload.delete({ where: { id: upload.id }, select: { id: true } });
        return 1;
      });
    }

    const recent = await this.prisma.pendingUpload.findMany({
      where: { confirmedAt: { gte: new Date(now.getTime() - DAY_MS), lte: now } },
      select: { id: true },
      take: REAP_BATCH_SIZE,
    });
    let originalsSwept = 0;
    for (const upload of recent) {
      if ((await this.storage.stat(originalPath(upload.id))) === null) continue;
      await this.storage.delete(originalPath(upload.id));
      originalsSwept++;
    }
    if (reaped > 0 || originalsSwept > 0) {
      this.logger.log({ reaped, originalsSwept }, 'pending uploads reaped');
    }
    return { reaped, originalsSwept };
  }
}
