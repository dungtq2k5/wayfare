import { Injectable } from '@nestjs/common';
import type { UiBundleResponse } from '@wayfare/contracts';
import type { RequestContext } from '@wayfare/nest-common';
import { NarrationServiceGrpcClient } from '../narration-client/narration-service-grpc.client';
import { toUiBundleResponse } from './i18n.mapper';
import type { BundleParamDto } from './dto/i18n.dto';

/** `/i18n/bundles`, backed by `narration.UiBundleService`. */
@Injectable()
export class I18nService {
  constructor(private readonly narration: NarrationServiceGrpcClient) {}

  async bundle(context: RequestContext, params: BundleParamDto): Promise<UiBundleResponse> {
    const response = await this.narration.uiBundles.call(
      'getBundle',
      { namespace: params.namespace, locale: params.locale },
      context,
    );
    return toUiBundleResponse(response);
  }
}
