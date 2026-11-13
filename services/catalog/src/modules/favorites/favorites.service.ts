import { Injectable } from '@nestjs/common';
import {
  IDENTITY_DEVICE_CLAIMED,
  IDENTITY_DEVICE_FORGOTTEN,
  IDENTITY_USER_ERASED,
  PlaceStatus,
  zCursorQuery,
  zRequestedLanguage,
  zUuidV7,
} from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import {
  decodeCursor,
  encodeCursor,
  parseRpcRequest,
  requireDeviceContext,
  rpcError,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client';
import { PlaceQueriesService } from '../place-queries/place-queries.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CatalogTx } from '../sync/sync.service';
import { toFavorite } from './favorite.mapper';

const placeIdField = z.object({ placeId: zUuidV7 });
const listFields = zCursorQuery.extend({ lang: zRequestedLanguage });

/** Whose favourites a caller sees: its device's, and a signed-in account's every device's. */
interface Owner {
  readonly deviceId: string;
  readonly userId: string | null;
}

const ownerOf = (context: RequestContext): Owner => ({
  deviceId: requireDeviceContext(context),
  userId: context.kind === 'account' ? context.userId : null,
});

/** The rows a caller owns: its device's, and the account's when signed in (rdm-spec C-13). */
const owned = (owner: Owner) =>
  owner.userId === null
    ? Prisma.sql`device_id = ${owner.deviceId}::uuid`
    : Prisma.sql`(device_id = ${owner.deviceId}::uuid OR user_id = ${owner.userId}::uuid)`;

/**
 * A device's saved Places (api-endpoints-plan §2.3, rdm-spec C-13). A signed-in device reads and
 * removes across every device of its account, and a favourite it saves is the account's at once;
 * an anonymous device sees only its own. Adding and removing are idempotent.
 */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: PlaceQueriesService,
  ) {}

  async listFavorites(
    request: catalogGrpc.ListFavoritesRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.ListFavoritesResponse> {
    const owner = ownerOf(context);
    const query = parseRpcRequest(listFields, {
      cursor: request.page?.cursor,
      limit: request.page?.limit === 0 ? undefined : request.page?.limit,
      lang: request.lang,
    });
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
    if (query.cursor !== undefined && (after === null || after.key === undefined)) {
      throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/cursor', code: 'invalid_value' }] });
    }
    const live: string = PlaceStatus.ACTIVE;
    // One row per Place, saved when first saved; newest first. Deleted or unpublished Places are
    // kept and filtered here, so a restored Place comes back.
    const rows = await this.prisma.$queryRaw<{ placeId: string; savedAt: Date }[]>`
      WITH saved AS (
        SELECT place_id, MIN(created_at) AS saved_at FROM favorites
        WHERE ${owned(owner)}
        GROUP BY place_id
      )
      SELECT s.place_id AS "placeId", s.saved_at AS "savedAt"
      FROM saved s JOIN places p ON p.id = s.place_id
      WHERE p.status = ${live} AND p.deleted_at IS NULL
        ${
          after === null
            ? Prisma.empty
            : Prisma.sql`AND (s.saved_at, s.place_id) < (${new Date(after.key!)}::timestamptz, ${after.id}::uuid)`
        }
      ORDER BY s.saved_at DESC, s.place_id DESC
      LIMIT ${query.limit + 1}`;
    const page = rows.slice(0, query.limit);
    const summaries = await this.queries.summaries(
      page.map((row) => row.placeId),
      query.lang.lang,
    );
    const last = page.at(-1);
    return {
      favorites: page.flatMap((row) => {
        const summary = summaries.get(row.placeId);
        return summary === undefined ? [] : [toFavorite(row, summary)];
      }),
      page: {
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeCursor({ id: last.placeId, key: last.savedAt.toISOString() })
            : undefined,
      },
    };
  }

  /** Saves a live Place; saving it again changes nothing but ties it to the account. */
  async addFavorite(
    request: catalogGrpc.AddFavoriteRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.AddFavoriteResponse> {
    const owner = ownerOf(context);
    const { placeId } = parseRpcRequest(placeIdField, request);
    const place = await this.prisma.place.findUnique({
      where: { id: placeId },
      select: { status: true, deletedAt: true },
    });
    if (place === null || place.deletedAt !== null || place.status !== String(PlaceStatus.ACTIVE)) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
    }
    await this.prisma.$executeRaw`
      INSERT INTO favorites (device_id, place_id, user_id)
      VALUES (${owner.deviceId}::uuid, ${placeId}::uuid, ${owner.userId}::uuid)
      ON CONFLICT (device_id, place_id)
      DO UPDATE SET user_id = COALESCE(EXCLUDED.user_id, favorites.user_id)`;
    return {};
  }

  /** Removes a Place: from this device, and from every device of a signed-in account. */
  async removeFavorite(
    request: catalogGrpc.RemoveFavoriteRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.RemoveFavoriteResponse> {
    const owner = ownerOf(context);
    const { placeId } = parseRpcRequest(placeIdField, request);
    await this.prisma.$executeRaw`
      DELETE FROM favorites WHERE place_id = ${placeId}::uuid AND ${owned(owner)}`;
    return {};
  }

  /** `identity.device.claimed`: the device's saved Places become the account's. */
  async claimDevice(
    event: EventPayload<typeof IDENTITY_DEVICE_CLAIMED>,
    consumer: string,
  ): Promise<void> {
    await this.once(consumer, event.eventId, (tx) =>
      tx.favorite.updateMany({
        where: { deviceId: event.deviceId },
        data: { userId: event.userId },
      }),
    );
  }

  /** `identity.device.forgotten`: the device's saved Places are deleted. */
  async forgetDevice(
    event: EventPayload<typeof IDENTITY_DEVICE_FORGOTTEN>,
    consumer: string,
  ): Promise<void> {
    await this.once(consumer, event.eventId, (tx) =>
      tx.favorite.deleteMany({ where: { deviceId: event.deviceId } }),
    );
  }

  /** `identity.user.erased`: the rows stay with their devices, no longer tied to anyone. */
  async eraseUser(event: EventPayload<typeof IDENTITY_USER_ERASED>): Promise<void> {
    await this.prisma.favorite.updateMany({
      where: { userId: event.userId },
      data: { userId: null },
    });
  }

  /**
   * Applies an event once per consumer: the change and its `processed_events` row commit together,
   * so a redelivered claim cannot tie a device to an account erased since.
   */
  private async once(
    consumer: string,
    eventId: string,
    apply: (tx: CatalogTx) => Promise<unknown>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const recorded = await tx.processedEvent.createMany({
        data: [{ consumer, eventId }],
        skipDuplicates: true,
      });
      if (recorded.count === 0) return;
      await apply(tx);
    });
  }
}
