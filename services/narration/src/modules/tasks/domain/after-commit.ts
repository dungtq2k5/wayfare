/** A task the queue should run, once the transaction that made it `QUEUED` has committed. */
export interface QueuedTask {
  readonly taskId: string;
  readonly attempts: number;
  readonly priority: number;
  readonly delayMs?: number;
}

/** A task stage change, for the monitor. */
export interface TaskChange {
  readonly jobId: string;
  readonly lang: string;
  readonly stage: string;
  readonly status: string;
}

/**
 * The queue item for a task's attempt. Each attempt has its own id: a failing task re-adds itself
 * while its current item is still running, and BullMQ ignores an add for an id it still holds.
 */
export function queueItemId(taskId: string, attempts: number): string {
  return `${taskId}-${attempts}`;
}

/**
 * What a transaction leaves for after its commit (conventions §7.3): queue items to add and remove,
 * jobs whose counts to settle and report, and task frames. The queue and the socket are never
 * touched inside a transaction that may still roll back.
 */
export interface AfterCommit {
  readonly adds: Map<string, QueuedTask>;
  readonly removes: Map<string, { taskId: string; attempts: number }>;
  readonly jobs: Set<string>;
  readonly tasks: TaskChange[];
  enqueue(task: QueuedTask): void;
  dequeue(task: { readonly id: string; readonly attempts: number }): void;
  jobChanged(jobId: string): void;
  taskChanged(change: TaskChange): void;
}

/** An empty collector for one transaction. A later enqueue or dequeue of a task wins. */
export function afterCommit(): AfterCommit {
  const collected: AfterCommit = {
    adds: new Map(),
    removes: new Map(),
    jobs: new Set(),
    tasks: [],
    enqueue(task) {
      collected.removes.delete(task.taskId);
      collected.adds.set(task.taskId, task);
    },
    dequeue(task) {
      collected.adds.delete(task.id);
      collected.removes.set(task.id, { taskId: task.id, attempts: task.attempts });
    },
    jobChanged(jobId) {
      collected.jobs.add(jobId);
    },
    taskChanged(change) {
      collected.tasks.push(change);
    },
  };
  return collected;
}
