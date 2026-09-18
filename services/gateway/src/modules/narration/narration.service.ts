import { Injectable } from '@nestjs/common';
import type { RequestedLanguage } from '@wayfare/contracts';
import type { RequestContext } from '@wayfare/nest-common';
import { NarrationServiceGrpcClient } from '../narration-client/narration-service-grpc.client';
import type { NarrationStatusResponseDto, OnDemandAnswer } from './dto/narration-response.dto';
import type { OnDemandDto } from './dto/narration.dto';
import { toNarrationStatusResponseDto, toOnDemandAnswer } from './narration.mapper';

/** `/narration/*` for tourist devices, backed by `narration.NarrationService`. */
@Injectable()
export class NarrationService {
  constructor(private readonly narration: NarrationServiceGrpcClient) {}

  async onDemand(context: RequestContext, body: OnDemandDto): Promise<OnDemandAnswer> {
    const response = await this.narration.narration.call(
      'requestOnDemand',
      { placeId: body.placeId, lang: body.lang.tag },
      context,
    );
    return toOnDemandAnswer(response);
  }

  async status(
    context: RequestContext,
    placeId: string,
    lang: RequestedLanguage,
  ): Promise<NarrationStatusResponseDto> {
    const response = await this.narration.narration.call(
      'getNarrationStatus',
      { placeId, lang: lang.tag },
      context,
    );
    return toNarrationStatusResponseDto(response);
  }
}
