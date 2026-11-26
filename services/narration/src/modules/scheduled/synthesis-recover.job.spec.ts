import { describe, expect, it, vi } from 'vitest';
import type { TaskQueue } from '../tasks/tasks.module';
import type { TasksService } from '../tasks/tasks.service';
import { SynthesisRecoverJob } from './synthesis-recover.job';

/** The job over a transaction whose advisory lock answers `locked`, or which fails outright. */
function recover(options: { runsWorker: boolean; locked?: boolean; fails?: boolean }) {
  const tx = { $queryRaw: vi.fn(() => Promise.resolve([{ locked: options.locked ?? true }])) };
  const tasks = {
    transact: vi.fn((work: (tx: unknown, fx: unknown) => Promise<unknown>) =>
      options.fails ? Promise.reject(new Error('database down')) : work(tx, {}),
    ),
  };
  const queue = { runsWorker: options.runsWorker };
  return {
    job: new SynthesisRecoverJob(tasks as unknown as TasksService, queue as unknown as TaskQueue),
    tasks,
  };
}

describe('the crash recovery sweep (rdm-spec N-1)', () => {
  it('does not sweep at boot in a process that runs no worker', async () => {
    const { job, tasks } = recover({ runsWorker: false });
    await job.onApplicationBootstrap();
    expect(tasks.transact).not.toHaveBeenCalled();
  });

  it('logs a boot sweep that fails rather than stopping the boot', async () => {
    const { job, tasks } = recover({ runsWorker: true, fails: true });
    await expect(job.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(tasks.transact).toHaveBeenCalledTimes(1);
  });

  it('does nothing while another replica holds the sweep', async () => {
    const { job } = recover({ runsWorker: true, locked: false });
    await expect(job.run()).resolves.toEqual({ requeued: 0, readded: 0, rehomed: 0 });
  });
});
