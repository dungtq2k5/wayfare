import { Injectable } from '@nestjs/common';
import {
  MAX_LANGUAGE_CODE_LENGTH,
  normalizeLang,
  UI_BUNDLE_KEEP_VERSIONS,
  UiBundleNamespace,
  UiBundleOrigin,
  UiBundleStatus,
} from '@wayfare/contracts';
import type { UiBundleResponse } from '@wayfare/contracts';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { BUNDLE_LOCALES, bundleSourceHash, readUiBundle } from '@wayfare/i18n';
import type { BundleLocale } from '@wayfare/i18n';
import { parseRpcRequest } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { UiBundleJobsService } from '../ui-bundle-jobs/ui-bundle-jobs.service';
import { toGetBundleResponse } from './ui-bundle.mapper';

/** When a client should ask again for a bundle being translated (api-endpoints-plan §4.2). */
const BUNDLE_RETRY_AFTER_MS = 5_000;

const bundleFields = z
  .object({
    namespace: z.enum(UiBundleNamespace),
    locale: z.string().min(2).max(MAX_LANGUAGE_CODE_LENGTH),
  })
  .strict();

/**
 * The UI strings both apps read (api-endpoints-plan §4.2, rdm-spec N-6). A locale whose
 * translation is committed is served from the files — those rows are seeded, and written here too
 * if a deploy changed the source before the seeder ran. Any other locale is machine-translated
 * once per `(namespace, source hash)`: the first request stores a `PENDING` row, queues the work
 * and is answered in English, so the app renders immediately and converges a minute later.
 */
@Injectable()
export class UiBundlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: UiBundleJobsService,
  ) {}

  async getBundle(
    request: narrationGrpc.GetBundleRequest,
    _context: RequestContext,
  ): Promise<narrationGrpc.GetBundleResponse> {
    const fields = parseRpcRequest(bundleFields, request);
    const namespace = fields.namespace;
    // A tag narration does not serve reads English, as every other locale fallback does.
    const locale = normalizeLang(fields.locale) ?? 'en';
    const sourceHash = bundleSourceHash(namespace);
    const source = readUiBundle('en', namespace);

    if (isCommitted(locale)) {
      const messages = readUiBundle(locale, namespace);
      await this.record(namespace, locale, sourceHash, messages);
      return toGetBundleResponse(this.ready(namespace, locale, sourceHash, messages, []));
    }

    const row = await this.prisma.uiBundle.findUnique({
      where: {
        namespace_locale_sourceHash: { namespace, locale, sourceHash },
      },
      select: { status: true, messages: true, failedKeys: true },
    });
    if (row?.status === UiBundleStatus.READY && row.messages !== null) {
      return toGetBundleResponse(
        this.ready(
          namespace,
          locale,
          sourceHash,
          row.messages as Record<string, string>,
          row.failedKeys,
        ),
      );
    }
    if (row === null) await this.queue(namespace, locale, sourceHash);
    return toGetBundleResponse({
      namespace,
      locale,
      status: UiBundleStatus.PENDING,
      sourceHash,
      // English now, the translation on the next ask (rdm-spec N-6).
      messages: source,
      failedKeys: [],
      retryAfterMs: BUNDLE_RETRY_AFTER_MS,
    });
  }

  private ready(
    namespace: UiBundleNamespace,
    locale: string,
    sourceHash: string,
    messages: Record<string, string>,
    failedKeys: readonly string[],
  ): UiBundleResponse {
    return {
      namespace,
      locale,
      status: UiBundleStatus.READY,
      sourceHash,
      messages,
      failedKeys: [...failedKeys],
      retryAfterMs: null,
    };
  }

  /** A committed locale's row, written if this source version has none yet — the seeder
   * writes the same row (rdm-spec N-6). */
  private async record(
    namespace: string,
    locale: string,
    sourceHash: string,
    messages: Record<string, string>,
  ): Promise<void> {
    const existing = await this.prisma.uiBundle.findUnique({
      where: { namespace_locale_sourceHash: { namespace, locale, sourceHash } },
      select: { id: true },
    });
    if (existing !== null) return;
    await this.prisma.uiBundle.create({
      data: {
        namespace,
        locale,
        sourceHash,
        status: UiBundleStatus.READY,
        origin: UiBundleOrigin.STATIC,
        messages,
        failedKeys: [],
      },
      select: { id: true },
    });
    await this.prune(namespace, locale);
  }

  /** The `PENDING` row and its work item — one translation per namespace and source version. */
  private async queue(namespace: string, locale: string, sourceHash: string): Promise<void> {
    await this.prisma.uiBundle.create({
      data: {
        namespace,
        locale,
        sourceHash,
        status: UiBundleStatus.PENDING,
        origin: UiBundleOrigin.MACHINE,
        messages: undefined,
        failedKeys: [],
      },
      select: { id: true },
    });
    await this.prune(namespace, locale);
    await this.jobs.enqueue({ namespace, locale, sourceHash });
  }

  /** Only the newest `UI_BUNDLE_KEEP_VERSIONS` source versions are kept, pruned on write (N-6). */
  private async prune(namespace: string, locale: string): Promise<void> {
    const kept = await this.prisma.uiBundle.findMany({
      where: { namespace, locale },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
      take: UI_BUNDLE_KEEP_VERSIONS,
    });
    await this.prisma.uiBundle.deleteMany({
      where: { namespace, locale, id: { notIn: kept.map((row) => row.id) } },
    });
  }
}

/** Whether this locale's translation ships in `packages/i18n` (rdm-spec N-6). */
function isCommitted(locale: string): locale is BundleLocale {
  return (BUNDLE_LOCALES as readonly string[]).includes(locale);
}
