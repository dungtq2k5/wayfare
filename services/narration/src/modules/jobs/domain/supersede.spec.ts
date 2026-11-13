import { SynthesisJobStatus } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { jobsToSupersede } from './supersede';

const job = (id: string, status: SynthesisJobStatus, hash: string) => ({
  id,
  status,
  sourceContentHash: hash,
});

describe('jobsToSupersede', () => {
  it('takes live jobs of another text, and leaves the same text and finished jobs alone', () => {
    const existing = [
      job('a', SynthesisJobStatus.RUNNING, 'old'),
      job('b', SynthesisJobStatus.PAUSED, 'old'),
      job('c', SynthesisJobStatus.QUEUED, 'new'),
      job('d', SynthesisJobStatus.COMPLETED, 'old'),
      job('e', SynthesisJobStatus.CANCELLED, 'old'),
    ];
    expect(jobsToSupersede(existing, 'new')).toEqual(['a', 'b']);
  });
});
