import { describe, expect, it } from 'vitest';
import { controlsFor, taskTone } from './jobs';

describe('a job’s controls (J3)', () => {
  it('shows each only when the job’s state allows it', () => {
    expect(controlsFor('RUNNING', 0)).toEqual(['pause', 'cancel']);
    expect(controlsFor('QUEUED', 0)).toEqual(['pause', 'cancel']);
    expect(controlsFor('PAUSED', 1)).toEqual(['resume', 'retry', 'cancel']);
    expect(controlsFor('PARTIALLY_FAILED', 2)).toEqual(['retry']);
    expect(controlsFor('COMPLETED', 0)).toEqual([]);
    expect(controlsFor('CANCELLED', 0)).toEqual([]);
  });
});

describe('a task’s tone (J2)', () => {
  it('says a task waiting for a provider is waiting, not queued', () => {
    expect(taskTone('QUEUED', true)).toBe('waiting');
    expect(taskTone('QUEUED', false)).toBe('queued');
    expect(taskTone('SUCCEEDED', false)).toBe('done');
    expect(taskTone('FAILED', false)).toBe('failed');
    expect(taskTone('COALESCED', false)).toBe('superseded');
  });
});
