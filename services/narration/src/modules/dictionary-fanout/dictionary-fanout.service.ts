import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import {
  DICTIONARY_FANOUT_BATCH,
  LocalizationTargetType,
  MAX_DICTIONARY_FANOUT_TARGETS,
  SynthesisTrigger,
} from '@wayfare/contracts';
import { localizationTargetTypeProto } from '@wayfare/contracts/grpc';
import { Counter } from 'prom-client';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { JobsService } from '../jobs/jobs.service';
import { TasksService } from '../tasks/tasks.service';
import { FanoutQueue } from './dictionary-fanout.module';
import type { FanoutItem, FanoutQueuePort } from './domain/fanout-queue';

/** Fan-outs that stopped at `MAX_DICTIONARY_FANOUT_TARGETS` (rdm-spec N-5). */
const fanoutTruncatedTotal = new Counter({
  name: 'narration_dictionary_fanout_truncated_total',
  help: 'Dictionary fan-outs that hit the target cap and stopped.',
});

/** A target of the fan-out: what a job is made for. */
interface TargetKey {
  readonly targetType: LocalizationTargetType.PLACE | LocalizationTargetType.MENU_ITEM;
  readonly targetId: string;
  readonly sourceContentHash: string;
}

/** A page's matches by target, each with the languages that matched. */
function groupByTarget(
  items: readonly {
    readonly targetType: number;
    readonly targetId: string;
    readonly lang: string;
    readonly sourceContentHash: string;
  }[],
): Map<TargetKey, string[]> {
  const byId = new Map<string, { key: TargetKey; langs: string[] }>();
  for (const item of items) {
    const targetType = localizationTargetTypeProto.fromProto(item.targetType);
    if (
      targetType !== LocalizationTargetType.PLACE &&
      targetType !== LocalizationTargetType.MENU_ITEM
    ) {
      continue;
    }
    const id = `${item.targetId}:${item.sourceContentHash}`;
    const found = byId.get(id);
    if (found === undefined) {
      byId.set(id, {
        key: { targetType, targetId: item.targetId, sourceContentHash: item.sourceContentHash },
        langs: [item.lang],
      });
    } else if (!found.langs.includes(item.lang)) {
      found.langs.push(item.lang);
    }
  }
  return new Map([...byId.values()].map(({ key, langs }) => [key, langs]));
}

/** How often a page that failed is tried again, by attempt; the last entry repeats. */
const FANOUT_RETRY_BACKOFF_MS = [5_000, 30_000, 120_000] as const;

/** Attempts one fan-out gets before it is reported and dropped. */
const FANOUT_ATTEMPTS = 4;

/**
 * The `DICTIONARY_CHANGED` fan-out (rdm-spec N-5). A dictionary write names a term; every live
 * localization whose text holds that term is re-voiced. It runs here rather than in the request:
 * "Sài Gòn" can touch every Place in every language, and those jobs take the lowest priority so a
 * tourist's on-demand narration always goes first.
 */
@Injectable()
export class DictionaryFanoutService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DictionaryFanoutService.name);

  constructor(
    // The queue lives in this module's file, which imports this one: it is named by its port so
    // the class is read when Nest resolves the provider, not while this file is being defined.
    @Inject(forwardRef(() => FanoutQueue)) private readonly queue: FanoutQueuePort,
    private readonly catalog: CatalogServiceGrpcClient,
    private readonly jobs: JobsService,
    private readonly tasks: TasksService,
  ) {}

  onApplicationBootstrap(): void {
    this.queue.start((item) => this.run(item.data));
  }

  /** Queues a term whose sound has changed — a create, an edit, a deactivation or a delete. */
  async enqueue(term: string, targetLang: string | null): Promise<void> {
    await this.queue.add({
      term,
      langs: targetLang === null ? [] : [targetLang],
      done: 0,
      attempt: 1,
    });
  }

  /**
   * One fan-out: pages the search and turns each match into a job, in batches. A page that fails
   * is tried again from the same cursor, so no work is repeated; after the last attempt the term
   * is reported and left — the entry stays saved, and saving it again fans out afresh.
   */
  async run(item: FanoutItem): Promise<void> {
    let cursor = item.cursor;
    let done = item.done;
    try {
      for (;;) {
        const page = await this.catalog.searchLocalizedText({
          term: item.term,
          langs: item.langs,
          cursor,
          limit: DICTIONARY_FANOUT_BATCH,
        });
        // One job per target, with every language of it this page found: a Place whose `en` and
        // `ja` texts both hold the term is one job of two tasks, not two jobs.
        for (const [key, langs] of groupByTarget(page.items)) {
          if (done >= MAX_DICTIONARY_FANOUT_TARGETS) {
            fanoutTruncatedTotal.inc();
            this.logger.warn(
              { term: item.term, cap: MAX_DICTIONARY_FANOUT_TARGETS },
              'dictionary fan-out stopped at the target cap; re-save the entry to continue',
            );
            return;
          }
          await this.queueJob(key, langs);
          done += 1;
        }
        cursor = page.page?.nextCursor;
        if (cursor === undefined) break;
      }
      this.logger.log({ term: item.term, targets: done }, 'dictionary fan-out finished');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      if (item.attempt >= FANOUT_ATTEMPTS) {
        this.logger.error(
          { term: item.term, targets: done, err: message },
          'dictionary fan-out gave up; the entry is saved, save it again to retry',
        );
        return;
      }
      const delayMs =
        FANOUT_RETRY_BACKOFF_MS[Math.min(item.attempt - 1, FANOUT_RETRY_BACKOFF_MS.length - 1)]!;
      this.logger.warn(
        { term: item.term, err: message },
        'dictionary fan-out page failed; retrying',
      );
      await this.queue.add({ ...item, cursor, done, attempt: item.attempt + 1 }, delayMs);
    }
  }

  /** One target, at the lowest priority; a repeat coalesces into the tasks already queued. */
  private async queueJob(key: TargetKey, langs: readonly string[]): Promise<void> {
    await this.tasks.transact(async (tx, fx) => {
      await this.jobs.createJob(tx, fx, {
        targetType: key.targetType,
        targetId: key.targetId,
        sourceContentHash: key.sourceContentHash,
        langs,
        includeAudio: key.targetType === LocalizationTargetType.PLACE,
        trigger: SynthesisTrigger.DICTIONARY_CHANGED,
      });
    });
  }
}
