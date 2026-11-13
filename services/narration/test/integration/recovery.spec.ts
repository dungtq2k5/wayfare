// The recovery sweep (rdm-spec N-1): crashed work is re-queued, never failed; paused work waits.
import { JOB_STALE_AFTER_MS, SynthesisJobStatus, SynthesisTaskStatus } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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

async function queuedJob(langs: string[], placeId = services.catalog.place().id) {
  const { job } = await services.jobs.createManualJob(manualRequest(placeId, langs), staff());
  return job!.id;
}

describe('synthesis-recover', () => {
  it('re-queues the running tasks of a job whose heartbeat went stale, and the job completes', async () => {
    const jobId = await queuedJob(['en', 'ja']);
    // A worker claimed both tasks, then the process died.
    services.queue.items.clear();
    const stale = new Date(Date.now() - JOB_STALE_AFTER_MS - 1_000);
    await prisma.synthesisTask.updateMany({
      where: { jobId },
      data: { status: SynthesisTaskStatus.RUNNING },
    });
    await prisma.synthesisJob.update({
      where: { id: jobId },
      data: { status: SynthesisJobStatus.RUNNING, heartbeatAt: stale },
    });

    const result = await services.recover.run(new Date());
    expect(result).toMatchObject({ requeued: 2 });
    expect(services.queue.items.size).toBe(2);
    await services.queue.drain();
    const job = await jobOf(prisma, jobId);
    expect(job.status).toBe(SynthesisJobStatus.COMPLETED);
    expect(job.tasks.every((task) => task.attempts === 0)).toBe(true);
  });

  it('closes a stale job whose tasks all ended', async () => {
    const jobId = await queuedJob(['en']);
    services.queue.items.clear();
    await prisma.synthesisTask.updateMany({
      where: { jobId },
      data: { status: SynthesisTaskStatus.SUCCEEDED },
    });
    await prisma.synthesisJob.update({
      where: { id: jobId },
      data: {
        status: SynthesisJobStatus.RUNNING,
        heartbeatAt: new Date(Date.now() - JOB_STALE_AFTER_MS - 1_000),
      },
    });
    await services.recover.run(new Date());
    expect((await jobOf(prisma, jobId)).status).toBe(SynthesisJobStatus.COMPLETED);
  });

  it('leaves a fresh heartbeat alone', async () => {
    const jobId = await queuedJob(['en']);
    services.queue.items.clear();
    await prisma.synthesisTask.updateMany({
      where: { jobId },
      data: { status: SynthesisTaskStatus.RUNNING },
    });
    await prisma.synthesisJob.update({
      where: { id: jobId },
      data: { status: SynthesisJobStatus.RUNNING, heartbeatAt: new Date() },
    });
    expect(await services.recover.run(new Date())).toMatchObject({ requeued: 0 });
  });

  it('adds a waiting task whose queue item was lost, but not a paused job’s', async () => {
    const lost = await queuedJob(['en']);
    const paused = await queuedJob(['ja']);
    await services.jobs.pauseJob({ jobId: paused }, staff());
    services.queue.items.clear();

    expect(await services.recover.run(new Date())).toMatchObject({ readded: 1 });
    const [item] = [...services.queue.items.values()];
    expect(item!.taskId).toBe((await jobOf(prisma, lost)).tasks[0]!.id);
  });

  it('makes active a follower whose task was cancelled', async () => {
    const place = services.catalog.place();
    const owner = await queuedJob(['en'], place.id);
    const follower = await queuedJob(['en'], place.id);
    expect((await jobOf(prisma, follower)).tasks[0]!.status).toBe(SynthesisTaskStatus.COALESCED);
    const ownerTask = (await jobOf(prisma, owner)).tasks[0]!;
    // Cancelled behind promotion's back.
    await prisma.synthesisTask.update({
      where: { id: ownerTask.id },
      data: { status: SynthesisTaskStatus.CANCELLED },
    });
    services.queue.items.clear();

    expect(await services.recover.run(new Date())).toMatchObject({ rehomed: 1 });
    expect((await jobOf(prisma, follower)).tasks[0]!.status).toBe(SynthesisTaskStatus.QUEUED);
    await services.queue.drain();
    expect((await jobOf(prisma, follower)).status).toBe(SynthesisJobStatus.COMPLETED);
  });
});
