import type { WorkItem } from '@wayfare/nest-common';

/**
 * What a fan-out item carries (rdm-spec N-5): the term a write changed, the languages it covers,
 * and where the paging left off. The entry is not named: a term is what decides the texts, and the
 * entry may already be gone.
 */
export interface FanoutItem {
  readonly term: string;
  readonly langs: readonly string[];
  readonly cursor?: string;
  /** Targets turned into jobs so far, across this item's attempts. */
  readonly done: number;
  readonly attempt: number;
}

/**
 * The queue as the worker uses it. The queue class itself lives in the module file, which imports
 * the worker: naming the port here keeps that cycle out of the worker's decorator metadata, which
 * the compiler evaluates while the module file is still being defined.
 */
export interface FanoutQueuePort {
  add(item: FanoutItem, delayMs?: number): Promise<void>;
  start(handler: (item: WorkItem<FanoutItem>) => Promise<void>): void;
}
