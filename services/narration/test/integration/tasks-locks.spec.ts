// Jobs' row locks against tasks' updates: two tasks of one job finishing — or one finishing while
// a sibling is claimed — must not deadlock; and a transaction Postgres aborts is run again whole,
// never counted as a task's failed attempt.
import {
  LocalizationTargetType,
  SynthesisJobStatus,
  SynthesisTaskStatus,
  SynthesisTrigger,
} from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterCommit } from '../../src/modules/tasks/domain/after-commit';
import { CLAIM_REQUEUE_MS } from '../../src/modules/tasks/tasks.service';
import { testPrisma, truncateAll } from '../setup/database';
import { jobOf, manualRequest, staff } from '../setup/fixtures';
import { narrationServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof narrationServices>;

beforeEach(async () => {
  await truncateAll(prisma);
  services = narrationServices(prisma);
});
afterAll(() => prisma.$disconnect());

/** A text-only job of `langs`, its tasks queued and not run. */
async function textJob(langs: string[]) {
  const place = services.catalog.place();
  const { job } = await services.jobs.createManualJob(
    manualRequest(place.id, langs, false),
    staff(),
  );
  services.queue.items.clear();
  return jobOf(prisma, job!.id);
}

/** Lets `parties` callers on, together, once all have arrived. */
function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const all = new Promise<void>((resolve) => (open = resolve));
  return () => {
    arrived += 1;
    if (arrived === parties) open();
    return all;
  };
}

/** Postgres's deadlock, as Prisma reports it from a query it built. */
const deadlock = () => Object.assign(new Error('write conflict or deadlock'), { code: 'P2034' });

describe("a job's row lock", () => {
  it('two tasks of one job, each updated twice, finish together and both commit', async () => {
    const job = await textJob(['en', 'ja']);
    const both = barrier(2);
    const finish = (taskId: string) =>
      prisma.$transaction(async (tx) => {
        const fx = afterCommit();
        // Updated twice: the second update re-checks the job's foreign key — `KEY SHARE` on it.
        await tx.synthesisTask.update({
          where: { id: taskId },
          data: { translationProvider: 'fake' },
        });
        await tx.synthesisTask.update({
          where: { id: taskId },
          data: { status: SynthesisTaskStatus.SUCCEEDED, finishedAt: new Date() },
        });
        fx.jobChanged(job.id);
        await both();
        await services.tasks.settle(tx, fx);
      });

    await Promise.all(job.tasks.map((task) => finish(task.id)));
    const after = await jobOf(prisma, job.id);
    expect(after.completedTasks).toBe(2);
    expect(after.status).toBe(SynthesisJobStatus.COMPLETED);
  });

  it('a task finishing while its sibling is claimed: both commit', async () => {
    const job = await textJob(['en', 'ja']);
    const [done, claimed] = job.tasks;
    const both = barrier(2);
    const finishing = prisma.$transaction(async (tx) => {
      const fx = afterCommit();
      await tx.synthesisTask.update({
        where: { id: done!.id },
        data: { translationProvider: 'fake' },
      });
      await tx.synthesisTask.update({
        where: { id: done!.id },
        data: { status: SynthesisTaskStatus.SUCCEEDED, finishedAt: new Date() },
      });
      fx.jobChanged(job.id);
      await both();
      await services.tasks.settle(tx, fx);
    });
    const claiming = prisma.$transaction(async (tx) => {
      const fx = afterCommit();
      await tx.$executeRaw`UPDATE synthesis_tasks SET status = 'RUNNING' WHERE id = ${claimed!.id}::uuid`;
      await tx.synthesisJob.update({ where: { id: job.id }, data: { heartbeatAt: new Date() } });
      fx.jobChanged(job.id);
      await both();
      await services.tasks.settle(tx, fx);
    });

    await Promise.all([finishing, claiming]);
    const after = await jobOf(prisma, job.id);
    expect(after.completedTasks).toBe(1);
    expect(after.status).toBe(SynthesisJobStatus.RUNNING);
  });
});

describe("a text-only task's run", () => {
  it('updates its task row once per transaction', async () => {
    const job = await textJob(['ja']);
    const taskId = job.tasks[0]!.id;
    const perTransaction: number[] = [];
    const original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, '$transaction').mockImplementation(((fn: (tx: unknown) => unknown) =>
      original(async (tx) => {
        let updates = 0;
        const counted = new Proxy(tx, {
          get(target, key, receiver) {
            const value: unknown = Reflect.get(target, key, receiver);
            if (key !== 'synthesisTask') return value;
            return new Proxy(value as object, {
              get(model, method) {
                const call: unknown = Reflect.get(model, method);
                if (typeof call !== 'function') return call;
                return (args: { where?: { id?: unknown } }) => {
                  if ((method === 'update' || method === 'updateMany') && args.where?.id === taskId)
                    updates += 1;
                  return (call as (a: unknown) => unknown).call(model, args);
                };
              },
            });
          },
        });
        const result = await fn(counted);
        perTransaction.push(updates);
        return result;
      })) as typeof prisma.$transaction);

    await services.tasks.run(taskId);
    vi.restoreAllMocks();
    const task = (await jobOf(prisma, job.id)).tasks[0]!;
    expect(task.status).toBe(SynthesisTaskStatus.SUCCEEDED);
    expect(task.translationProvider).not.toBeNull();
    expect(Math.max(...perTransaction)).toBe(1);
  });
});

describe('a transaction Postgres aborted', () => {
  it('runs again whole, and commits', async () => {
    const job = await textJob(['en']);
    let tries = 0;
    const result = await services.tasks.transact(async (tx, fx) => {
      tries += 1;
      await tx.synthesisJob.update({
        where: { id: job.id },
        data: { errorSummary: `try ${tries}` },
      });
      fx.jobChanged(job.id);
      if (tries === 1) throw deadlock();
      return 'done';
    });
    expect(result).toBe('done');
    expect(tries).toBe(2);
    expect((await jobOf(prisma, job.id)).errorSummary).toBe('try 2');
  });

  it('surfaces after three tries', async () => {
    let tries = 0;
    await expect(
      services.tasks.transact(() => {
        tries += 1;
        return Promise.reject(deadlock());
      }),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect(tries).toBe(3);
  });

  it('a claim aborted once is claimed on the retry, and the task runs with no attempt spent', async () => {
    const job = await textJob(['en']);
    const taskId = job.tasks[0]!.id;
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(deadlock());
    await services.tasks.run(taskId);
    vi.restoreAllMocks();
    const task = (await jobOf(prisma, job.id)).tasks[0]!;
    expect(task.status).toBe(SynthesisTaskStatus.SUCCEEDED);
    expect(task.attempts).toBe(0);
  });

  it('a claim aborted every try puts its task back on the queue, its attempts unchanged', async () => {
    const job = await textJob(['en']);
    const taskId = job.tasks[0]!.id;
    const spy = vi.spyOn(prisma, '$transaction');
    for (let i = 0; i < 3; i++) spy.mockRejectedValueOnce(deadlock());
    await services.tasks.run(taskId);
    spy.mockRestore();

    const task = (await jobOf(prisma, job.id)).tasks[0]!;
    expect(task.status).toBe(SynthesisTaskStatus.QUEUED);
    expect(task.attempts).toBe(0);
    // Not dropped for the recovery sweep: added again once the item it ran in has ended.
    await expect
      .poll(() => services.queue.has(taskId, 0), { timeout: CLAIM_REQUEUE_MS * 8 })
      .toBe(true);
  });
});

describe('a change following a task that had started', () => {
  /** A human edit's job for the same key as `job`, made now. */
  async function humanEdit(job: Awaited<ReturnType<typeof textJob>>) {
    const id = await services.tasks.transact((tx, fx) =>
      services.jobs.createJob(tx, fx, {
        targetType: LocalizationTargetType.PLACE,
        targetId: job.targetId!,
        sourceContentHash: job.sourceContentHash,
        langs: ['ja'],
        includeAudio: false,
        trigger: SynthesisTrigger.HUMAN_EDIT,
        requestedByUserId: staff().userId,
      }),
    );
    return jobOf(prisma, id);
  }

  it('runs again once the started task ends, rather than ending with its result', async () => {
    const leader = await textJob(['ja']);
    const leaderTask = leader.tasks[0]!;
    // The leader has started: it read the old text already.
    await prisma.synthesisTask.update({
      where: { id: leaderTask.id },
      data: { status: SynthesisTaskStatus.RUNNING, startedAt: new Date() },
    });
    const edit = await humanEdit(leader);
    expect(edit.tasks[0]).toMatchObject({
      status: SynthesisTaskStatus.COALESCED,
      coalescedIntoTaskId: leaderTask.id,
      rerunAfterLeader: true,
    });

    // The leader runs to its end; the edit is then the key's active task, queued for its own run.
    await prisma.synthesisTask.update({
      where: { id: leaderTask.id },
      data: { status: SynthesisTaskStatus.QUEUED },
    });
    await services.queue.run(leaderTask.id);
    const after = await jobOf(prisma, edit.id);
    expect(after.tasks[0]).toMatchObject({
      status: SynthesisTaskStatus.QUEUED,
      coalescedIntoTaskId: null,
      rerunAfterLeader: false,
    });
    await services.queue.drain();
    expect((await jobOf(prisma, edit.id)).tasks[0]!.status).toBe(SynthesisTaskStatus.SUCCEEDED);
    expect((await jobOf(prisma, edit.id)).tasks[0]!.startedAt).not.toBeNull();
  });

  it('follows a task that has not started: its run will read the change', async () => {
    const leader = await textJob(['ja']);
    const edit = await humanEdit(leader);
    expect(edit.tasks[0]).toMatchObject({
      status: SynthesisTaskStatus.COALESCED,
      rerunAfterLeader: false,
    });
  });
});
