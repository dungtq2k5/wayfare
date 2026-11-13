import type { WorkItem } from '@wayfare/nest-common';

/**
 * One bundle to translate (rdm-spec N-6): a namespace, the locale asked for, and the English
 * version it is made from. The row is already `PENDING` when this is queued.
 */
export interface BundleItem {
  readonly namespace: string;
  readonly locale: string;
  readonly sourceHash: string;
  readonly attempt: number;
}

/**
 * The queue as the worker uses it. The queue class lives in the module file, which imports the
 * worker: naming the port here keeps that cycle out of the worker's decorator metadata, which the
 * compiler evaluates while the module file is still being defined.
 */
export interface BundleQueuePort {
  add(item: BundleItem, delayMs?: number): Promise<void>;
  start(handler: (item: WorkItem<BundleItem>) => Promise<void>): void;
}
