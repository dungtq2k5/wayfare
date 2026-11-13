import { describe, expect, it } from 'vitest';
import { afterCommit, queueItemId } from './after-commit';

describe('afterCommit', () => {
  it('keeps the last word per task: a dequeue cancels an enqueue and the other way round', () => {
    const fx = afterCommit();
    fx.enqueue({ taskId: 't1', attempts: 0, priority: 5 });
    fx.dequeue({ id: 't1', attempts: 0 });
    fx.dequeue({ id: 't2', attempts: 1 });
    fx.enqueue({ taskId: 't2', attempts: 1, priority: 1 });
    expect([...fx.adds.keys()]).toEqual(['t2']);
    expect([...fx.removes.keys()]).toEqual(['t1']);
  });

  it('names each attempt apart', () => {
    expect(queueItemId('t', 0)).not.toBe(queueItemId('t', 1));
    expect(queueItemId('t', 2)).not.toContain(':');
  });
});
