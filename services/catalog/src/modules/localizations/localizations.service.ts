import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AudioStatus,
  CATALOG_PLACE_STATUS_CHANGED,
  LocalizationTargetType,
  NOTIFICATION_CREATE,
  NotificationType,
  PlaceKind,
  PlaceStatus,
} from '@wayfare/contracts';
import type {
  EventPayload,
  NARRATION_LOCALIZATION_FAILED,
  NARRATION_LOCALIZATION_READY,
} from '@wayfare/contracts';
import { OutboxService, SYSTEM_ORIGIN } from '@wayfare/nest-common';
import { placeAuditRecord } from '../places/domain/place-audit';
import { netVisibilityChange } from '../places/domain/place-lifecycle';
import { PlacesService } from '../places/places.service';
import { PrismaService } from '../prisma/prisma.service';
import { bumpSyncVersion, withSyncWrite } from '../sync/sync.service';
import type { CatalogTx } from '../sync/sync.service';

/** The reason narration gives for a language it serves as text only — expected, never notified. */
const NO_VOICE = 'NO_VOICE';

// Widened: statuses are read from the database as plain strings.
const READY: string = AudioStatus.READY;

type Ready = EventPayload<typeof NARRATION_LOCALIZATION_READY>;
type Failed = EventPayload<typeof NARRATION_LOCALIZATION_FAILED>;

/** What a row holds, for the currency rule. */
interface StoredVersions {
  readonly sourceContentHash: string;
  readonly audioStatus: string;
  readonly audioSourceContentHash: string | null;
}

/**
 * The currency rule (rdm-spec §1.5): hashes have no order, so "newer" means "for the current
 * `content_hash`". Text is written when there is no row, when the row is stale (stale replaced by
 * stale or current — stale text beats no text), or when the event is for the row's own current
 * hash. Audio follows the same rule on its own column.
 */
export function localizationWrites(input: {
  readonly current: string;
  readonly row: StoredVersions | null;
  readonly textHash: string;
  readonly audioHash: string | null;
}): { text: boolean; audio: boolean } {
  const { current, row, textHash, audioHash } = input;
  const rowTextCurrent = row !== null && row.sourceContentHash === current;
  const text = row === null || !rowTextCurrent || textHash === current;
  const rowAudioCurrent =
    row !== null && row.audioStatus === READY && row.audioSourceContentHash === current;
  const audio = audioHash !== null && (!rowAudioCurrent || audioHash === current);
  return { text, audio };
}

/**
 * catalog's localization read model (ADR 0040): written only from narration's events, through
 * the two consumers. Idempotent through `processed_events` plus the currency rule.
 */
@Injectable()
export class LocalizationsService {
  private readonly logger = new Logger(LocalizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly places: PlacesService,
  ) {}

  /** `narration.localization.ready` — upserts the text (and audio), and may open the gate. */
  async applyReady(payload: Ready, consumer: string): Promise<void> {
    switch (payload.targetType) {
      case LocalizationTargetType.PLACE:
        return this.applyPlace(payload, consumer);
      case LocalizationTargetType.MENU_ITEM:
        return this.applyMenuItem(payload, consumer);
      default:
        // Tours and offers have no table here yet.
        this.logger.debug({ targetType: payload.targetType }, 'localization ignored');
    }
  }

  /**
   * `narration.localization.failed` — a final failure marks the current row's audio `FAILED`. One
   * that arrives before the row exists throws, so the runner redelivers it.
   */
  async applyFailed(payload: Failed): Promise<void> {
    if (payload.targetType !== LocalizationTargetType.PLACE || !payload.final) return;
    await withSyncWrite(this.prisma, async (tx) => {
      // A failure carries no hash: it is about the text the Place has now.
      const changed = await tx.$executeRaw`
        UPDATE place_localizations l
        SET audio_status = ${AudioStatus.FAILED}, audio_source_content_hash = NULL,
            audio_asset_id = NULL, audio_object_path = NULL, audio_sha256 = NULL,
            audio_bytes = NULL, audio_duration_ms = NULL, voice_id = NULL, updated_at = now()
        FROM places p
        WHERE l.place_id = p.id AND p.id = ${payload.targetId}::uuid AND l.lang = ${payload.lang}
          AND l.source_content_hash = p.content_hash
          AND l.audio_status <> ${AudioStatus.FAILED}
          AND NOT (l.audio_status = ${AudioStatus.READY}
                   AND l.audio_source_content_hash = p.content_hash)`;
      if (changed > 0) {
        // The first final failure for this text: a Venue's owner is told, once (api-endpoints-plan
        // §10). `NO_VOICE` is a text-only language working as intended, not a failure.
        if (payload.reason !== NO_VOICE) {
          const [venue] = await tx.$queryRaw<{ ownerUserId: string }[]>`
            SELECT owner_user_id AS "ownerUserId" FROM places
            WHERE id = ${payload.targetId}::uuid AND kind = ${PlaceKind.VENUE} AND owner_user_id IS NOT NULL`;
          if (venue !== undefined) {
            await this.outbox.add(tx, NOTIFICATION_CREATE, {
              occurredAt: new Date().toISOString(),
              recipientUserId: venue.ownerUserId,
              notification: {
                type: NotificationType.PLACE_NARRATION_FAILED,
                data: { placeId: payload.targetId, lang: payload.lang },
              },
            });
          }
        }
        await bumpSyncVersion(tx, payload.targetId);
        return;
      }
      // Its text's event may still be on its way (the relay's order is best-effort): redeliver
      // until the row exists, rather than lose the failure.
      const [state] = await tx.$queryRaw<{ place: boolean; row: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM places WHERE id = ${payload.targetId}::uuid) AS place,
               EXISTS (SELECT 1 FROM place_localizations
                       WHERE place_id = ${payload.targetId}::uuid AND lang = ${payload.lang}) AS row`;
      if (state?.place === true && !state.row) {
        throw new Error('the failure arrived before its localization; redelivering');
      }
    });
  }

  private async applyPlace(payload: Ready, consumer: string): Promise<void> {
    await withSyncWrite(this.prisma, async (tx) => {
      if (!(await this.firstDelivery(tx, consumer, payload.eventId))) return;
      const [place] = await tx.$queryRaw<
        {
          contentHash: string;
          status: PlaceStatus;
          activationRequestedAt: Date | null;
          publishedAt: Date | null;
          ownerUserId: string | null;
          deleted: boolean;
        }[]
      >`
        SELECT content_hash AS "contentHash", status,
               activation_requested_at AS "activationRequestedAt", published_at AS "publishedAt",
               owner_user_id AS "ownerUserId", deleted_at IS NOT NULL AS deleted
        FROM places WHERE id = ${payload.targetId}::uuid
        FOR UPDATE`;
      if (place === undefined) {
        // Places are never hard-deleted: this is a bug report, not a race.
        this.logger.warn({ placeId: payload.targetId }, 'localization for an unknown Place');
        return;
      }
      const key = { placeId: payload.targetId, lang: payload.lang };
      const row = await tx.placeLocalization.findUnique({
        where: { placeId_lang: key },
        select: { sourceContentHash: true, audioStatus: true, audioSourceContentHash: true },
      });
      const audio = payload.audio ?? null;
      const writes = localizationWrites({
        current: place.contentHash,
        row,
        textHash: payload.sourceContentHash,
        audioHash: audio?.sourceContentHash ?? null,
      });
      if (!writes.text && !writes.audio) return;

      const text = payload.text as { name: string; description: string };
      const textData = writes.text
        ? {
            name: text.name,
            description: text.description,
            sourceContentHash: payload.sourceContentHash,
            translationSource: payload.translationSource,
          }
        : {};
      const audioData =
        writes.audio && audio !== null
          ? {
              audioStatus: AudioStatus.READY,
              audioSourceContentHash: audio.sourceContentHash,
              audioAssetId: audio.assetId,
              audioObjectPath: audio.objectPath,
              audioSha256: audio.sha256,
              audioBytes: audio.bytes,
              audioDurationMs: audio.durationMs,
              voiceId: audio.voiceId,
            }
          : {};
      if (row === null) {
        await tx.placeLocalization.create({
          data: {
            ...key,
            name: text.name,
            description: text.description,
            sourceContentHash: payload.sourceContentHash,
            translationSource: payload.translationSource,
            audioStatus: AudioStatus.PENDING,
            ...audioData,
          },
          select: { lang: true },
        });
      } else {
        await tx.placeLocalization.update({
          where: { placeId_lang: key },
          data: { ...textData, ...audioData },
          select: { lang: true },
        });
      }

      if (place.status === PlaceStatus.PROCESSING && payload.lang === 'en') {
        const gate = await this.places.openGateIfReady(tx, payload.targetId, place);
        if (gate.open) {
          const now = new Date();
          await this.outbox.add(
            tx,
            AUDIT_RECORD,
            placeAuditRecord({
              actor: { type: AuditActorType.SYSTEM },
              action: AuditAction.PLACE_ACTIVATED,
              placeId: payload.targetId,
              origin: SYSTEM_ORIGIN,
              now,
            }),
          );
          const change = netVisibilityChange(
            { status: place.status, deleted: place.deleted },
            { status: PlaceStatus.ACTIVE, deleted: place.deleted },
          );
          if (change !== null) {
            await this.outbox.add(tx, CATALOG_PLACE_STATUS_CHANGED, {
              occurredAt: now.toISOString(),
              placeId: payload.targetId,
              ...change,
              reason: null,
              ...(place.ownerUserId === null ? {} : { ownerUserId: place.ownerUserId }),
              // The gate stamps `published_at` only when the Place had none.
              firstPublication: place.publishedAt === null,
            });
          }
        }
      }
      await bumpSyncVersion(tx, payload.targetId);
    });
  }

  private async applyMenuItem(payload: Ready, consumer: string): Promise<void> {
    await withSyncWrite(this.prisma, async (tx) => {
      if (!(await this.firstDelivery(tx, consumer, payload.eventId))) return;
      const item = await tx.menuItem.findUnique({
        where: { id: payload.targetId },
        select: { placeId: true, contentHash: true },
      });
      // Replaced since: the translation is for a line that no longer exists.
      if (item === null) return;
      const key = { menuItemId: payload.targetId, lang: payload.lang };
      const row = await tx.menuItemLocalization.findUnique({
        where: { menuItemId_lang: key },
        select: { sourceContentHash: true },
      });
      const writes = localizationWrites({
        current: item.contentHash,
        row:
          row === null
            ? null
            : { ...row, audioStatus: AudioStatus.PENDING, audioSourceContentHash: null },
        textHash: payload.sourceContentHash,
        audioHash: null,
      });
      if (!writes.text) return;
      const text = payload.text as { name: string; description?: string };
      const data = {
        name: text.name,
        description: text.description ?? null,
        sourceContentHash: payload.sourceContentHash,
        translationSource: payload.translationSource,
      };
      await tx.menuItemLocalization.upsert({
        where: { menuItemId_lang: key },
        create: { ...key, ...data },
        update: data,
        select: { lang: true },
      });
      await bumpSyncVersion(tx, item.placeId);
    });
  }

  /** Records the event for this consumer; false when it was already applied (rdm-spec §2.11). */
  private async firstDelivery(tx: CatalogTx, consumer: string, eventId: string): Promise<boolean> {
    const inserted = await tx.$executeRaw`
      INSERT INTO processed_events (consumer, event_id)
      VALUES (${consumer}, ${eventId}::uuid)
      ON CONFLICT DO NOTHING`;
    return inserted === 1;
  }
}
