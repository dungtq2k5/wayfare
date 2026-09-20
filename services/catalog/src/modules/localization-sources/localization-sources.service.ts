import { Injectable } from '@nestjs/common';
import {
  LocalizationTargetType,
  MAX_PRONUNCIATION_TERM_LENGTH,
  PLACE_LIMIT_STATUSES,
  PlaceKind,
  PlaceStatus,
  SUPPORTED_LANGUAGES,
  zCursorQuery,
  zLanguage,
  zUuidV7,
} from '@wayfare/contracts';
import { localizationTargetTypeProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import {
  decodeCursor,
  encodeCursor,
  parseRpcRequest,
  requireProtoEnum,
  rpcError,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import {
  SOURCE_MENU_ITEM_SELECT,
  SOURCE_PLACE_SELECT,
  toLocalizationSourceMenuItem,
  toLocalizationSourcePlace,
  toLocalizedTextMatch,
} from './localization-source.mapper';

const sourceFields = z.object({ targetType: z.number(), targetId: zUuidV7 });

/** `SearchLocalizedText`: the term as the dictionary holds it (rdm-spec N-5's `term` column). */
const searchFields = zCursorQuery.extend({
  term: z.string().trim().min(2).max(MAX_PRONUNCIATION_TERM_LENGTH),
  langs: z.array(zLanguage).max(SUPPORTED_LANGUAGES.length).optional(),
});

/** Where a word boundary can be asserted: `\m` and `\M` need a word character beside them. */
const WORD_EDGE = /[\p{L}\p{N}_]/u;

/**
 * A term inside Postgres word boundaries, with every regex character of its own escaped. A term
 * whose own edge is not a word character (`C++`) takes no boundary on that side — `\M` after `+`
 * would match nothing at all.
 */
const wholeWord = (term: string): string => {
  // FIXME `String.raw` should be used to avoid escaping `\`.
  const escaped = term.replaceAll(/[\\^$.|?*+()[\]{}]/g, '\\$&');
  // FIXME `String.raw` should be used to avoid escaping `\`.
  const left = WORD_EDGE.test(term.slice(0, 1)) ? '\\m' : '';
  // FIXME `String.raw` should be used to avoid escaping `\`.
  const right = WORD_EDGE.test(term.slice(-1)) ? '\\M' : '';
  return `${left}${escaped}${right}`;
};
const ownerField = z.object({ ownerUserId: zUuidV7 });

/**
 * What narration reads before localizing (api-endpoints-plan §12.2): the target's text as it is
 * now. Internal and read-only; its callers are consumers with a system context, so it asks for no
 * account. Tours and offers answer `not_found` until their tables exist.
 */
@Injectable()
export class LocalizationSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async getLocalizationSource(
    request: catalogGrpc.GetLocalizationSourceRequest,
    _context: RequestContext,
  ): Promise<catalogGrpc.GetLocalizationSourceResponse> {
    const fields = parseRpcRequest(sourceFields, request);
    const targetType = requireProtoEnum(
      localizationTargetTypeProto,
      fields.targetType,
      '/targetType',
    );
    if (targetType === LocalizationTargetType.PLACE) {
      const place = await this.prisma.place.findUnique({
        where: { id: fields.targetId },
        select: SOURCE_PLACE_SELECT,
      });
      return place === null ? { notFound: {} } : { place: toLocalizationSourcePlace(place) };
    }
    if (targetType === LocalizationTargetType.MENU_ITEM) {
      const item = await this.prisma.menuItem.findUnique({
        where: { id: fields.targetId },
        select: SOURCE_MENU_ITEM_SELECT,
      });
      return item === null ? { notFound: {} } : { menuItem: toLocalizationSourceMenuItem(item) };
    }
    return { notFound: {} };
  }

  /**
   * Live localizations whose text holds `term`, whole-word (api-endpoints-plan §12.2): what a
   * dictionary edit has to re-voice. Case-insensitive and diacritic-exact — `Bến Thành` and
   * `Ben Thanh` are different terms, as N-5 says — over both localization tables, for `ACTIVE`,
   * non-deleted targets. Ordered and paged by `(targetType, targetId, lang)`.
   */
  async searchLocalizedText(
    request: catalogGrpc.SearchLocalizedTextRequest,
    _context: RequestContext,
  ): Promise<catalogGrpc.SearchLocalizedTextResponse> {
    const query = parseRpcRequest(searchFields, {
      term: request.term,
      langs: request.langs.length === 0 ? undefined : request.langs,
      cursor: request.page?.cursor,
      limit: request.page?.limit === 0 ? undefined : request.page?.limit,
    });
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
    if (query.cursor !== undefined && (after === null || after.key === undefined)) {
      throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/cursor', code: 'invalid_value' }] });
    }
    const pattern = wholeWord(query.term);
    const langs = query.langs ?? null;
    const live: string = PlaceStatus.ACTIVE;
    // The cursor's position, as the order reads it: target type, then language, then id.
    const [cursorType, cursorLang] = after === null ? [null, null] : after.key!.split(':');
    const cursorId = after === null ? null : after.id;
    const rows = await this.prisma.$queryRaw<
      { targetType: string; targetId: string; lang: string; sourceContentHash: string }[]
    >`
      WITH matches AS (
        SELECT ${LocalizationTargetType.PLACE}::text AS "targetType", l.place_id AS "targetId",
               l.lang, l.source_content_hash AS "sourceContentHash"
        FROM place_localizations l JOIN places p ON p.id = l.place_id
        WHERE p.status = ${live} AND p.deleted_at IS NULL
          AND (l.name ~* ${pattern} OR l.description ~* ${pattern})
        UNION ALL
        SELECT ${LocalizationTargetType.MENU_ITEM}::text, m.menu_item_id, m.lang,
               m.source_content_hash
        FROM menu_item_localizations m
          JOIN menu_items i ON i.id = m.menu_item_id
          JOIN places p ON p.id = i.place_id
        WHERE p.status = ${live} AND p.deleted_at IS NULL
          AND (m.name ~* ${pattern} OR COALESCE(m.description, '') ~* ${pattern})
      )
      SELECT * FROM matches
      WHERE (${langs}::text[] IS NULL OR lang = ANY(${langs}::text[]))
        AND (
          ${cursorType}::text IS NULL
          OR ("targetType", lang, "targetId") >
             (${cursorType}::text, ${cursorLang}::text, ${cursorId}::uuid)
        )
      ORDER BY "targetType", lang, "targetId"
      LIMIT ${query.limit + 1}`;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toLocalizedTextMatch),
      page: {
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeCursor({ id: last.targetId, key: `${last.targetType}:${last.lang}` })
            : undefined,
      },
    };
  }

  /**
   * An owner's Venues that count against their place limit (rdm-spec C-1): live, and `DRAFT`,
   * `PROCESSING` or `ACTIVE`. billing's overview and plan dry run read it.
   */
  async countOwnerPlaces(
    request: catalogGrpc.CountOwnerPlacesRequest,
  ): Promise<catalogGrpc.CountOwnerPlacesResponse> {
    const { ownerUserId } = parseRpcRequest(ownerField, request);
    const count = await this.prisma.place.count({
      where: {
        ownerUserId,
        kind: PlaceKind.VENUE,
        deletedAt: null,
        status: { in: [...PLACE_LIMIT_STATUSES] },
      },
    });
    return { count };
  }
}
