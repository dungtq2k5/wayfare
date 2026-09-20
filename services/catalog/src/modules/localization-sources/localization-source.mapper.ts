import type {
  AudioStatus,
  LocalizationTargetType,
  PlaceKind,
  PlaceStatus,
  TranslationSource,
} from '@wayfare/contracts';
import {
  audioStatusProto,
  localizationTargetTypeProto,
  placeKindProto,
  placeStatusProto,
  translationSourceProto,
} from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import type { Prisma } from '../../../generated/prisma/client';

/** A Place and every localization's version state (rdm-spec C-1, C-4). */
export const SOURCE_PLACE_SELECT = {
  kind: true,
  status: true,
  deletedAt: true,
  contentHash: true,
  nameVi: true,
  descriptionVi: true,
  ownerUserId: true,
  localizations: {
    select: {
      lang: true,
      name: true,
      description: true,
      sourceContentHash: true,
      translationSource: true,
      audioStatus: true,
      audioSourceContentHash: true,
      audioObjectPath: true,
      audioSha256: true,
      audioBytes: true,
      audioDurationMs: true,
    },
    orderBy: { lang: 'asc' },
  },
} as const satisfies Prisma.PlaceSelect;

/** A row as `SOURCE_PLACE_SELECT` loads it. */
export type SourcePlaceRow = Prisma.PlaceGetPayload<{ select: typeof SOURCE_PLACE_SELECT }>;

/** A menu line's source text (rdm-spec C-6). */
export const SOURCE_MENU_ITEM_SELECT = {
  placeId: true,
  contentHash: true,
  nameVi: true,
  descriptionVi: true,
} as const satisfies Prisma.MenuItemSelect;

/** A row as `SOURCE_MENU_ITEM_SELECT` loads it. */
export type SourceMenuItemRow = Prisma.MenuItemGetPayload<{
  select: typeof SOURCE_MENU_ITEM_SELECT;
}>;

/** A Place's source; a deleted one is returned too, flagged. Audio as an object path. */
export function toLocalizationSourcePlace(
  row: SourcePlaceRow,
): catalogGrpc.LocalizationSourcePlace {
  return {
    kind: placeKindProto.toProto(row.kind as PlaceKind),
    status: placeStatusProto.toProto(row.status as PlaceStatus),
    deleted: row.deletedAt !== null,
    contentHash: row.contentHash,
    nameVi: row.nameVi,
    descriptionVi: row.descriptionVi,
    ...(row.ownerUserId === null ? {} : { ownerUserId: row.ownerUserId }),
    localizations: row.localizations.map((localization) => ({
      lang: localization.lang,
      name: localization.name,
      description: localization.description,
      sourceContentHash: localization.sourceContentHash,
      translationSource: translationSourceProto.toProto(
        localization.translationSource as TranslationSource,
      ),
      audioStatus: audioStatusProto.toProto(localization.audioStatus as AudioStatus),
      ...(localization.audioSourceContentHash === null
        ? {}
        : { audioSourceContentHash: localization.audioSourceContentHash }),
      ...(localization.audioObjectPath === null
        ? {}
        : { audioObjectPath: localization.audioObjectPath }),
      ...(localization.audioSha256 === null ? {} : { audioSha256: localization.audioSha256 }),
      ...(localization.audioBytes === null ? {} : { audioBytes: localization.audioBytes }),
      ...(localization.audioDurationMs === null
        ? {}
        : { audioDurationMs: localization.audioDurationMs }),
    })),
  };
}

/** A menu line's source. */
export function toLocalizationSourceMenuItem(
  row: SourceMenuItemRow,
): catalogGrpc.LocalizationSourceMenuItem {
  return {
    placeId: row.placeId,
    contentHash: row.contentHash,
    nameVi: row.nameVi,
    ...(row.descriptionVi === null ? {} : { descriptionVi: row.descriptionVi }),
  };
}

/** One localization row whose text holds the term (api-endpoints-plan §12.2). */
export function toLocalizedTextMatch(row: {
  readonly targetType: string;
  readonly targetId: string;
  readonly lang: string;
  readonly sourceContentHash: string;
}): catalogGrpc.LocalizedTextMatch {
  return {
    targetType: localizationTargetTypeProto.toProto(row.targetType as LocalizationTargetType),
    targetId: row.targetId,
    lang: row.lang,
    sourceContentHash: row.sourceContentHash,
  };
}
