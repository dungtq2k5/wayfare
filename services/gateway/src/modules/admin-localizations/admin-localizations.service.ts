import { Injectable } from '@nestjs/common';
import type { Correction, LocalizationOverview, LocalizationTargetType } from '@wayfare/contracts';
import { localizationTargetTypeProto } from '@wayfare/contracts/grpc';
import type { AccountContext } from '@wayfare/nest-common';
import { NarrationServiceGrpcClient } from '../narration-client/narration-service-grpc.client';
import { toCorrection, toLocalizationOverview } from './admin-localization.mapper';
import type { PutCorrectionDto } from './dto/admin-localization.dto';

/** `/admin/narration/localizations`, backed by `narration.CorrectionService`. */
@Injectable()
export class AdminLocalizationsService {
  constructor(private readonly narration: NarrationServiceGrpcClient) {}

  async overview(
    context: AccountContext,
    targetType: LocalizationTargetType,
    targetId: string,
  ): Promise<LocalizationOverview> {
    const response = await this.narration.corrections.call(
      'getLocalizationOverview',
      { targetType: localizationTargetTypeProto.toProto(targetType), targetId },
      context,
    );
    return toLocalizationOverview(response);
  }

  async put(
    context: AccountContext,
    target: { targetType: LocalizationTargetType; targetId: string; lang: string },
    body: PutCorrectionDto,
  ): Promise<{ correction: Correction }> {
    const response = await this.narration.corrections.call(
      'putCorrection',
      {
        targetType: localizationTargetTypeProto.toProto(target.targetType),
        targetId: target.targetId,
        lang: target.lang,
        sourceContentHash: body.sourceContentHash,
        name: body.name,
        ...(body.description == null ? {} : { description: body.description }),
      },
      context,
    );
    return { correction: toCorrection(response.correction) };
  }

  async revert(
    context: AccountContext,
    target: { targetType: LocalizationTargetType; targetId: string; lang: string },
  ): Promise<void> {
    await this.narration.corrections.call(
      'revertCorrection',
      {
        targetType: localizationTargetTypeProto.toProto(target.targetType),
        targetId: target.targetId,
        lang: target.lang,
      },
      context,
    );
  }
}
