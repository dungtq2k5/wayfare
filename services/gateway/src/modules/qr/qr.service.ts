import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { canonicalPublicCode } from '@wayfare/contracts';
import type { RequestContext } from '@wayfare/nest-common';
import type { Env } from '../../config/env.schema';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';

/**
 * `/q/:publicCode` — the URL printed on stickers (api-endpoints-plan §2.1). Counts the scan and
 * answers the universal link, whatever the code: the landing page explains an unavailable Place,
 * so a sticker never dead-ends in an error page — not even while catalog is down.
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
    if (canonical !== null) {
      try {
        await this.catalog.placeQueries.call(
          'resolvePublicCode',
          { publicCode: canonical },
          context,
        );
      } catch (error) {
        this.logger.warn(
          { err: error instanceof Error ? error.message : 'unknown' },
          'a QR scan went uncounted',
        );
      }
    }
    return `${this.linkBase}/p/${encodeURIComponent(canonical ?? code)}`;
  }
}
