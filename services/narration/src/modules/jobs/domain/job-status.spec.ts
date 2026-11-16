import { SynthesisJobStatus as Job, SynthesisTaskStatus as Task } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { jobStatusFrom } from './job-status';

describe('jobStatusFrom', () => {
  it.each([
    ['queued tasks, nothing started', Job.QUEUED, { [Task.QUEUED]: 2 }, Job.QUEUED],
    ['a task running', Job.QUEUED, { [Task.RUNNING]: 1, [Task.QUEUED]: 1 }, Job.RUNNING],
    ['every task following another job', Job.QUEUED, { [Task.COALESCED]: 2 }, Job.RUNNING],
    [
      'running, one left queued',
      Job.RUNNING,
      { [Task.QUEUED]: 1, [Task.SUCCEEDED]: 1 },
      Job.RUNNING,
    ],
    ['paused with work left', Job.PAUSED, { [Task.QUEUED]: 1, [Task.RUNNING]: 1 }, Job.PAUSED],
    ['all succeeded', Job.RUNNING, { [Task.SUCCEEDED]: 3 }, Job.COMPLETED],
    ['some failed', Job.RUNNING, { [Task.SUCCEEDED]: 2, [Task.FAILED]: 1 }, Job.PARTIALLY_FAILED],
    ['all failed', Job.RUNNING, { [Task.FAILED]: 2 }, Job.FAILED],
    [
      'succeeded besides a cancelled one',
      Job.RUNNING,
      { [Task.SUCCEEDED]: 1, [Task.CANCELLED]: 1 },
      Job.COMPLETED,
    ],
    ['everything cancelled', Job.RUNNING, { [Task.CANCELLED]: 2 }, Job.CANCELLED],
    ['paused, then everything finished', Job.PAUSED, { [Task.SUCCEEDED]: 1 }, Job.COMPLETED],
    ['cancelled stays', Job.CANCELLED, { [Task.QUEUED]: 1 }, Job.CANCELLED],
    ['superseded stays', Job.SUPERSEDED, { [Task.SUCCEEDED]: 1 }, Job.SUPERSEDED],
    ['completed stays', Job.COMPLETED, { [Task.SUCCEEDED]: 1 }, Job.COMPLETED],
  ] as const)('%s', (_name, current, counts, expected) => {
    expect(jobStatusFrom(current, counts)).toBe(expected);
  });
});
