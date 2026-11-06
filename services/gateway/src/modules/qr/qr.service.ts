import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { canonicalPublicCode, CodeTargetType } from '@wayfare/contracts';
import { codeTargetTypeProto } from '@wayfare/contracts/grpc';
import type { RequestContext } from '@wayfare/nest-common';
import type { Env } from '../../config/env.schema';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';

/**
 * `/q/:publicCode` — the URL printed on stickers (api-endpoints-plan §2.1). Counts a Place's scan
 * and answers its universal link, `/p/` or a tour's `/t/`, whatever the code: the landing page
 * explains an unavailable one, so a sticker never dead-ends — not even while catalog is down.
 */
@Injectable()
export class QrService {
  private readonly logger = new Logger(QrService.name);
  private readonly linkBase: string;

  constructor(
    private readonly catalog: CatalogServiceGrpcClient,
    config: ConfigService<Env, true>,
  ) {
    this.linkBase = config.get('PUBLIC_LINK_BASE_URL', { infer: true });
  }

  async resolve(context: RequestContext, code: string): Promise<string> {
    const canonical = canonicalPublicCode(code);
    let path = 'p';
    if (canonical !== null) {
      try {
        const target = await this.catalog.placeQueries.call(
          'resolvePublicCode',
          { publicCode: canonical, countScan: true },
          context,
        );
        // One code space (rdm-spec C-8): a tour's code goes to its page, any other to a Place's.
        if (codeTargetTypeProto.fromProto(target.targetType) === CodeTargetType.TOUR) path = 't';
      } catch (error) {
        // catalog down: `/p/` still answers, and the web's `/p/` sends a tour's code on to `/t/`.
        this.logger.warn(
          { err: error instanceof Error ? error.message : 'unknown' },
          'a QR scan went uncounted',
        );
      }
    }
    return `${this.linkBase}/${path}/${encodeURIComponent(canonical ?? code)}`;
  }
}
