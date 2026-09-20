import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { UiBundleStatus } from '@wayfare/contracts';
import { readUiBundle } from '@wayfare/i18n';
import { PrismaService } from '../prisma/prisma.service';
import { SynthesisService } from '../synthesis/synthesis.service';
import { checkedKey, failedKeysOf, messagesOf } from '../ui-bundles/domain/icu-parity';
import type { CheckedKey } from '../ui-bundles/domain/icu-parity';
import { BundleQueue } from './ui-bundle-jobs.module';
import type { BundleItem, BundleQueuePort } from './domain/bundle-queue';

/** How often a bundle that failed is tried again, by attempt; the last entry repeats. */
const BUNDLE_RETRY_BACKOFF_MS = [5_000, 30_000, 120_000] as const;

/** Attempts one bundle gets before it is reported and left for the next request to re-queue. */
const BUNDLE_ATTEMPTS = 4;

/**
 * Translating a UI bundle (rdm-spec N-6, D12). It runs on its own queue rather than as a synthesis
 * job: a bundle has no catalog row, no audio and hundreds of keys, and `UI_BUNDLE` is a target
 * type, not a trigger. Each key goes through the translation cache, so a key two namespaces share
 * — or a locale asked for twice — is translated once.
 */
@Injectable()
export class UiBundleJobsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UiBundleJobsService.name);

  constructor(
    // The queue lives in this module's file, which imports this one: it is named by its port so
    // the class is read when Nest resolves the provider, not while this file is being defined.
    @Inject(forwardRef(() => BundleQueue)) private readonly queue: BundleQueuePort,
    private readonly prisma: PrismaService,
    private readonly synthesis: SynthesisService,
  ) {}

  onApplicationBootstrap(): void {
    this.queue.start((item) => this.run(item.data));
  }

  /** Queues a locale's bundle; the `PENDING` row is already written. */
  async enqueue(input: {
    readonly namespace: string;
    readonly locale: string;
    readonly sourceHash: string;
  }): Promise<void> {
    await this.queue.add({ ...input, attempt: 1 });
  }

  /**
   * One bundle: every key through the provider, each checked against its English source. A key
   * whose translation broke a placeholder keeps English and is reported in `failed_keys` — the
   * bundle is still served, because one bad key must not cost the locale its whole UI.
   */
  async run(item: BundleItem): Promise<void> {
    const source = readUiBundle('en', item.namespace as 'tourist' | 'console');
    try {
      const checked: CheckedKey[] = [];
      for (const [key, message] of Object.entries(source)) {
        const { text } = await this.synthesis.translateField(item.locale, message);
        checked.push(checkedKey(key, message, text));
      }
      const failed = failedKeysOf(checked);
      await this.prisma.uiBundle.updateMany({
        where: {
          namespace: item.namespace,
          locale: item.locale,
          sourceHash: item.sourceHash,
          status: UiBundleStatus.PENDING,
        },
        data: {
          status: UiBundleStatus.READY,
          messages: messagesOf(checked),
          failedKeys: failed,
        },
      });
      this.logger.log(
        {
          namespace: item.namespace,
          locale: item.locale,
          keys: checked.length,
          failed: failed.length,
        },
        'ui bundle translated',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      if (item.attempt >= BUNDLE_ATTEMPTS) {
        // The row stays `PENDING`: the locale keeps reading English, and the next request after a
        // prune queues it afresh rather than this failing for ever.
        this.logger.error(
          { namespace: item.namespace, locale: item.locale, err: message },
          'ui bundle translation gave up; the locale is served English',
        );
        return;
      }
      const delayMs =
        BUNDLE_RETRY_BACKOFF_MS[Math.min(item.attempt - 1, BUNDLE_RETRY_BACKOFF_MS.length - 1)]!;
      this.logger.warn(
        { namespace: item.namespace, locale: item.locale, err: message },
        'ui bundle translation failed; retrying',
      );
      await this.queue.add({ ...item, attempt: item.attempt + 1 }, delayMs);
    }
  }
}
