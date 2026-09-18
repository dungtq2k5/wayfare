import { Injectable } from '@nestjs/common';
import { LocalizationTargetType, zUuidV7 } from '@wayfare/contracts';
import { localizationTargetTypeProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { parseRpcRequest, requireProtoEnum } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import {
  SOURCE_MENU_ITEM_SELECT,
  SOURCE_PLACE_SELECT,
  toLocalizationSourceMenuItem,
  toLocalizationSourcePlace,
} from './localization-source.mapper';

const sourceFields = z.object({ targetType: z.number(), targetId: zUuidV7 });

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
}
